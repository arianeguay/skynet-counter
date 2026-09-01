import { readContext, emit } from './rss.ts';
import { openDb, readSnapshot } from '../../src/lib/db.ts';

const BASE = 12;
const HALF_LIFE_DAYS = 7;
const DIVISOR = 8;
const HORIZON_DAYS = 30;

interface Scored {
  url: string;
  score: number;
  matched_keywords: string[];
  evidence: string;
}

const ctx = await readContext<{ previous_outputs?: { score?: { articles?: Scored[] } } }>();
const scored = ctx.previous_outputs?.score?.articles ?? [];
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
// back down to BASE without a separate silence rule.
const history = db
  .query<{ score: number; published_at: string }, [string]>(
    'SELECT score, published_at FROM articles WHERE score IS NOT NULL AND published_at >= ?'
  )
  .all(new Date(now - HORIZON_DAYS * 864e5).toISOString());

let signal = 0;
for (const row of history) {
  const ageDays = Math.max(0, (now - Date.parse(row.published_at)) / 864e5);
  signal += row.score * Math.exp(-ageDays / HALF_LIFE_DAYS);
}

const counter = Math.round(Math.min(100, Math.max(0, BASE + signal / DIVISOR)) * 10) / 10;

db.query('INSERT INTO counter (id, value, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
  .run(counter, scoredAt);
db.close();

const snapshot = readSnapshot();
emit({ counter, updatedAt: scoredAt, articles: snapshot.articles });
