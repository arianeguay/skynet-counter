import { readContext, emit, type RawArticle } from './rss.ts';
import { openDb } from '../../src/lib/db.ts';

const HISTORY_WINDOW = 100;
const MAX_PER_RUN = 25;

const normalize = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const byNewest = (a: RawArticle, b: RawArticle): number =>
  b.publishedAt.localeCompare(a.publishedAt);

// A burst on one feed must not push another feed out of the batch. A global
// newest-first slice let TechCrunch AI and Hacker News — which publish far more
// often than the Ars Technica security feed — fill all 25 slots, so the items
// that reliably carry scoring vocabulary fell off the bottom and only reached
// the scorer sweeps later. Each source contributes in turn instead, newest
// first, until its own supply runs out; the room a quiet feed leaves is still
// taken by the busy ones, so the cap is filled whenever the pool can fill it.
function shareBySource(pool: RawArticle[], cap: number): RawArticle[] {
  const queues = new Map<string, RawArticle[]>();
  for (const a of pool) {
    const queue = queues.get(a.source);
    if (queue) queue.push(a);
    else queues.set(a.source, [a]);
  }
  for (const queue of queues.values()) queue.sort(byNewest);

  const picked: RawArticle[] = [];
  const rounds = Math.max(0, ...[...queues.values()].map((q) => q.length));
  for (let round = 0; round < rounds && picked.length < cap; round++) {
    for (const queue of queues.values()) {
      const article = queue[round];
      if (!article) continue;
      picked.push(article);
      if (picked.length === cap) break;
    }
  }
  return picked.sort(byNewest);
}

const ctx = await readContext<{ previous_outputs?: Record<string, { articles?: RawArticle[] }> }>();
const fetched = Object.values(ctx.previous_outputs ?? {}).flatMap((o) => o.articles ?? []);

const db = openDb();
const knownUrls = new Set(
  db
    .query<{ url: string }, []>('SELECT url FROM articles WHERE score IS NOT NULL')
    .all()
    .map((r) => r.url)
);
const knownTitles = new Set(
  db
    .query<{ title: string }, [number]>(
      'SELECT title FROM articles WHERE score IS NOT NULL ORDER BY scored_at DESC LIMIT ?'
    )
    .all(HISTORY_WINDOW)
    .map((r) => normalize(r.title))
);

const insert = db.prepare(
  'INSERT OR IGNORE INTO articles (url, title, source, published_at, summary) VALUES (?, ?, ?, ?, ?)'
);

const fresh: RawArticle[] = [];
const seenThisRun = new Set<string>();
for (const a of fetched) {
  const key = normalize(a.title);
  if (knownUrls.has(a.url) || knownTitles.has(key) || seenThisRun.has(key)) continue;
  seenThisRun.add(key);
  fresh.push(a);
}

const articles = shareBySource(fresh, MAX_PER_RUN);

db.transaction(() => {
  for (const a of articles) insert.run(a.url, a.title, a.source, a.publishedAt, a.summary);
})();
db.close();

emit({ new_count: articles.length, seen_count: fetched.length, articles });
