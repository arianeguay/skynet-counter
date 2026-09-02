import { readContext, emit, hydrateSummaries, type RawArticle } from './rss.ts';
import { openDb, SWEEP_RETENTION_DAYS, UNREADABLE_AFTER_ATTEMPTS } from '../../src/lib/db.ts';
import { matchedKeywords } from '../../src/lib/keywords.ts';
import { currentDomain } from '../../src/lib/domains/index.ts';

const HISTORY_WINDOW = 100;
const MAX_PER_RUN = 25;

const normalize = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const byNewest = (a: RawArticle, b: RawArticle): number =>
  b.publishedAt.localeCompare(a.publishedAt);

// A burst on one feed must not push another feed out of the batch. A global
// newest-first slice let the highest-volume feeds — which publish far more
// often than Krebs on Security — fill all 25 slots, so the items
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

// The `fetch` map stage collects its per-feed runs into one output; `outputs`
// holds the batch of every feed that succeeded, in list order.
const ctx = await readContext<{
  previous_outputs?: { fetch?: { outputs?: { articles?: RawArticle[] }[] } };
}>();
const fetched = (ctx.previous_outputs?.fetch?.outputs ?? []).flatMap((o) => o.articles ?? []);

// Every read and write below is scoped to this domain: a URL another domain has
// already scored must still be offered here, and its counter must not be moved by
// an article this one pulled (STU-1213).
const domain = currentDomain();

const db = openDb();
const knownUrls = new Set(
  db
    .query<{ url: string }, [string]>(
      'SELECT url FROM articles WHERE domain = ? AND score IS NOT NULL'
    )
    .all(domain.slug)
    .map((r) => r.url)
);
const knownTitles = new Set(
  db
    .query<{ title: string }, [string, number]>(
      'SELECT title FROM articles WHERE domain = ? AND score IS NOT NULL ORDER BY scored_at DESC LIMIT ?'
    )
    .all(domain.slug, HISTORY_WINDOW)
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
    [string, number]
  >(
    'SELECT url, title, source, published_at, summary FROM articles WHERE domain = ? AND score IS NULL ORDER BY rowid LIMIT ?'
  )
  .all(domain.slug, MAX_PER_RUN)
  .map<RawArticle>((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    publishedAt: r.published_at,
    summary: r.summary,
  }));

const insert = db.prepare(
  'INSERT OR IGNORE INTO articles (domain, url, title, source, published_at, summary) VALUES (?, ?, ?, ?, ?, ?)'
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

const added = shareBySource(fresh, Math.max(0, MAX_PER_RUN - stranded.length));

// The linked pages are read here rather than in `fetch` so each is fetched once
// instead of once an hour for as long as its item sits in the publisher's
// window: `fetch` pulls ~110 items a sweep and all but this handful are already
// scored. The backlog is not re-hydrated — a stranded row was stored with its
// page text on the run that inserted it (STU-1206).
//
// An article whose page did not load is held back rather than scored on its feed
// summary. Scoring it there is what made a one-minute outage permanent: the
// boilerplate scores 0, `aggregate` writes that 0, and the URL joins the
// `score IS NOT NULL` seen-index for good. Held back it is simply never seen, so
// the next sweep pulls it from the feed and tries the page again (STU-1204).
//
// Retrying forever is the other half of that bargain, and `unread_pages` is what
// bounds it: a page refused this many sweeps running is not having a bad minute.
// HN links PDFs regularly, and `pageText` refuses a non-HTML response by design,
// so without this the same dead link is fetched every hour until its item rolls
// off — and nothing ever said so (STU-1271).
const attempts = new Map(
  db
    .query<{ url: string; attempts: number }, [string]>(
      'SELECT url, attempts FROM unread_pages WHERE domain = ?'
    )
    .all(domain.slug)
    .map((r) => [r.url, r.attempts] as const)
);
const unreadable = added.filter((a) => (attempts.get(a.url) ?? 0) >= UNREADABLE_AFTER_ATTEMPTS);
const worthTrying = added.filter((a) => (attempts.get(a.url) ?? 0) < UNREADABLE_AFTER_ATTEMPTS);

const { articles: hydrated, failed: unread } = await hydrateSummaries(worthTrying);
if (unread.length) {
  process.stderr.write(`dedupe loaded ${hydrated.length} of ${worthTrying.length} linked pages\n`);
}
if (unreadable.length) {
  process.stderr.write(
    `dedupe skipped ${unreadable.length} pages refused ${UNREADABLE_AFTER_ATTEMPTS}+ sweeps running\n`
  );
}

// Attributed per feed, not counted per run: `aggregate` files it next to that
// feed's fetch outcome, so a publisher steadily refusing the user-agent reads as
// that publisher's problem rather than as a number that moves (STU-1205).
const countBySource = (articles: RawArticle[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const a of articles) counts[a.source] = (counts[a.source] ?? 0) + 1;
  return counts;
};
const pagesUnread = countBySource(unread);
const pagesUnreadable = countBySource(unreadable);

// Finding the literal matches is a substring scan over 4000 characters of hydrated
// page text per article, and the scorer used to be asked to do it from reading —
// then the validator ran the same scan with matchedKeywords() and rejected the
// batch over what the model had missed, on nearly every sweep (STU-1212). The scan
// is handed over already done; the judgement the scorer is there for, keep or drop,
// is not. The validator still recomputes from keywords.ts and never reads this
// field, so a batch cannot be approved by trusting it.
const articles = [...stranded, ...hydrated].map((a) => ({
  ...a,
  candidate_keywords: matchedKeywords(`${a.title} ${a.summary}`, domain.keywords),
}));

const noteUnread = db.prepare(
  `INSERT INTO unread_pages (domain, url, source, attempts, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)
   ON CONFLICT(domain, url) DO UPDATE SET attempts = unread_pages.attempts + 1, last_at = excluded.last_at`
);
const forgetUnread = db.prepare('DELETE FROM unread_pages WHERE domain = ? AND url = ?');
// A page that has not been offered for the whole retention window has rolled off
// its feed, so its row can never be cleared by a success and would sit forever.
const pruneUnread = db.prepare('DELETE FROM unread_pages WHERE domain = ? AND last_at < ?');

// The hydrated summary is what gets stored, so a row re-offered from the backlog
// carries its page text and needs no second fetch.
const now = new Date().toISOString();
db.transaction(() => {
  for (const a of hydrated) {
    insert.run(domain.slug, a.url, a.title, a.source, a.publishedAt, a.summary);
    // It answered this time, so the run of refusals ends here.
    forgetUnread.run(domain.slug, a.url);
  }
  for (const a of unread) noteUnread.run(domain.slug, a.url, a.source, now, now);
  pruneUnread.run(domain.slug, new Date(Date.parse(now) - SWEEP_RETENTION_DAYS * 864e5).toISOString());
})();
db.close();

// The weight table and the domain's judgement notes ride in the output rather
// than in the scorer's prompt. The prompt is one static file shared by every
// domain and cannot hold four tables; carrying a per-domain copy there would be
// the same hand-maintained duplicate that already had to be kept in step, times
// four. The validator still recomputes from the domain's own table and never
// reads these fields, so a batch cannot be approved by trusting them.
emit({
  domain: domain.slug,
  keyword_weights: domain.keywords,
  domain_guidance: domain.guidance,
  new_count: articles.length,
  seen_count: fetched.length,
  stranded_count: stranded.length,
  pages_unread: pagesUnread,
  pages_unreadable: pagesUnreadable,
  articles,
});
