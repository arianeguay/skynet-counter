import { readContext, emit, type RawArticle } from './rss.ts';
import { openDb } from '../../src/lib/db.ts';

const HISTORY_WINDOW = 100;
const MAX_PER_RUN = 25;

const normalize = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

fresh.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const articles = fresh.slice(0, MAX_PER_RUN);

db.transaction(() => {
  for (const a of articles) insert.run(a.url, a.title, a.source, a.publishedAt, a.summary);
})();
db.close();

emit({ new_count: articles.length, seen_count: fetched.length, articles });
