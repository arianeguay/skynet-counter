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

// A sweep that dies after dedupe leaves its batch inserted and unscored, and the feed
// window it came from rolls off within days — so re-offering only what `fetch` pulled
// leaves those rows stranded forever: invisible to readSnapshot(), absent from the
// counter's decayed sum. The table carries the title and summary the scorer needs, so
// the backlog is re-presented from there rather than re-fetched. Oldest debt first
// (rowid is insertion order), so a full-to-the-cap run drains the backlog instead of
// starving its tail behind whatever the publishers posted today.
const stranded = db
  .query<
    { url: string; title: string; source: string; published_at: string; summary: string },
    [number]
  >(
    'SELECT url, title, source, published_at, summary FROM articles WHERE score IS NULL ORDER BY rowid LIMIT ?'
  )
  .all(MAX_PER_RUN)
  .map<RawArticle>((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    publishedAt: r.published_at,
    summary: r.summary,
  }));

const insert = db.prepare(
  'INSERT OR IGNORE INTO articles (url, title, source, published_at, summary) VALUES (?, ?, ?, ?, ?)'
);

// A stranded row whose feed item has *not* rolled off yet is fetched again this run;
// seeding both sets with the backlog keeps it one candidate, not two the validator
// would count as a double-scored article.
const fresh: RawArticle[] = [];
const seenUrls = new Set(stranded.map((a) => a.url));
const seenThisRun = new Set(stranded.map((a) => normalize(a.title)));
for (const a of fetched) {
  const key = normalize(a.title);
  if (knownUrls.has(a.url) || seenUrls.has(a.url) || knownTitles.has(key) || seenThisRun.has(key)) continue;
  seenUrls.add(a.url);
  seenThisRun.add(key);
  fresh.push(a);
}

fresh.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const added = fresh.slice(0, Math.max(0, MAX_PER_RUN - stranded.length));
const articles = [...stranded, ...added];

db.transaction(() => {
  for (const a of added) insert.run(a.url, a.title, a.source, a.publishedAt, a.summary);
})();
db.close();

emit({
  new_count: articles.length,
  seen_count: fetched.length,
  stranded_count: stranded.length,
  articles,
});
