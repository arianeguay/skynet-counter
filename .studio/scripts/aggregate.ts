import { readContext, emit } from './rss.ts';
import { openDb, readSnapshot, SWEEP_RETENTION_DAYS } from '../../src/lib/db.ts';
import { HORIZON_DAYS, normalizedSignal, counterFrom } from '../../src/lib/counter.ts';

interface Scored {
  url: string;
  score: number;
  matched_keywords: string[];
  evidence: string;
}

const ctx = await readContext<{
  previous_outputs?: {
    fetch?: { outputs?: { source?: string; error?: string | null }[] };
    dedupe?: { pages_unread?: Record<string, number> };
    score?: { articles?: Scored[] };
  };
}>();
const scored = ctx.previous_outputs?.score?.articles ?? [];
const feeds = ctx.previous_outputs?.fetch?.outputs ?? [];
const pagesUnread = ctx.previous_outputs?.dedupe?.pages_unread ?? {};
const now = Date.now();
const scoredAt = new Date(now).toISOString();

const db = openDb();
const update = db.prepare(
  'UPDATE articles SET score = ?, matched_keywords = ?, evidence = ?, scored_at = ? WHERE url = ?'
);
db.transaction(() => {
  for (const s of scored) {
    update.run(s.score, JSON.stringify(s.matched_keywords), s.evidence, scoredAt, s.url);
  }
})();

// Recent risk decays with a 7-day half-life, so radio silence walks the counter
// back down to BASE without a separate silence rule. `source` rides along because
// the signal is normalised per feed — each covers a different slice of the
// horizon, and the raw sum reads a young history as a safe world (STU-1222).
const history = db
  .query<{ score: number; published_at: string; source: string }, [string]>(
    'SELECT score, published_at, source FROM articles WHERE score IS NOT NULL AND published_at >= ?'
  )
  .all(new Date(now - HORIZON_DAYS * 864e5).toISOString());

const counter = counterFrom(normalizedSignal(history, now));

// A dead feed costs the counter its input without failing the sweep, so this row
// is the only trace it leaves. One row per source per sweep rather than one row
// per source: a feed that fails 23 hours out of 24 never holds a day-old failure,
// so its record is the only thing that shows it (STU-1207).
const sweep = db.prepare(
  'INSERT OR REPLACE INTO feed_sweeps (source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?)'
);
const prune = db.prepare('DELETE FROM feed_sweeps WHERE swept_at < ?');
// A feed deleted from the input list is never fetched again, so its rows would
// keep naming it in `feedErrors` forever — and deleting a feed while it fails is
// the likely reason to delete it.
const forget = db.prepare('DELETE FROM feed_sweeps WHERE source NOT IN (SELECT value FROM json_each(?))');
db.transaction(() => {
  for (const f of feeds) {
    if (!f.source) continue;
    sweep.run(f.source, scoredAt, f.error ?? null, pagesUnread[f.source] ?? 0);
  }
  prune.run(new Date(now - SWEEP_RETENTION_DAYS * 864e5).toISOString());
  forget.run(JSON.stringify(feeds.map((f) => f.source).filter(Boolean)));
})();

db.query('INSERT INTO counter (id, value, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
  .run(counter, scoredAt);
db.close();

const snapshot = readSnapshot();
emit({
  counter,
  updatedAt: scoredAt,
  articles: snapshot.articles,
  feedErrors: snapshot.feedErrors,
});
