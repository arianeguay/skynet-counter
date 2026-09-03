import { Database } from 'bun:sqlite';

// Read per call, not once at module load: capturing it at import time meant
// whichever test file pulled this module in first decided the path for the whole
// process, so adding an unrelated import moved another suite's database.
export function dbPath(): string {
  return process.env.SKYNET_DB ?? 'data/skynet.db';
}

export interface ArticleRow {
  domain: string;
  url: string;
  title: string;
  source: string;
  published_at: string;
  summary: string;
  score: number | null;
  matched_keywords: string | null;
  evidence: string | null;
  scored_at: string | null;
}

export interface Article {
  title: string;
  url: string;
  source: string;
  date: string;
  score: number;
  keywords: string[];
  evidence: string;
}

// A source that is contributing less than it should, in the two shapes that
// happen. `since` dates the current unbroken run of failures and is null when the
// feed answered the last sweep — a flapping feed is up half the time, so it is
// reported on its record rather than on its current state (STU-1207).
export interface FeedError {
  source: string;
  error: string;
  since: string | null;
  failedSweeps: number;
  totalSweeps: number;
  pagesUnread: number;
}

// How far back `failedSweeps` / `totalSweeps` look. Wide enough that an hourly
// schedule gives a usable denominator, narrow enough that yesterday's outage
// stops counting once a feed is healthy again.
export const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Sweeps older than this are pruned. Only the window above is read; the rest is
// kept so a failure can be looked at after the fact rather than only while the
// container log still holds it (STU-1205).
export const SWEEP_RETENTION_DAYS = 7;

// What makes a feed that is answering right now still a fault: it failed at least
// this share of its recent sweeps. The ratio needs a denominator to mean anything,
// hence the floor — a fresh database must not raise a fault off its first failure.
export const FLAP_MIN_SWEEPS = 3;
export const FLAP_RATIO = 0.5;

export function isFlapping(feed: Pick<FeedError, 'failedSweeps' | 'totalSweeps'>): boolean {
  return feed.totalSweeps >= FLAP_MIN_SWEEPS && feed.failedSweeps / feed.totalSweeps >= FLAP_RATIO;
}

// After this many sweeps refusing the same page, it is not a page having a bad
// minute. `dedupe` stops asking for it, which caps what a permanently dead link
// costs while its item sits in the publisher's window (STU-1271).
export const UNREADABLE_AFTER_ATTEMPTS = 3;

export interface CounterSnapshot {
  counter: number;
  updatedAt: string;
  articles: Article[];
  feedErrors: FeedError[];
}

function columnsOf(db: Database, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

// The one migration this schema has. Every other state change in this repo went
// into a new table precisely to avoid needing one, but partitioning by domain is
// not new state: it labels rows that already exist, and the only copy of that
// history is the live volume behind the published counter. A new table would
// leave the old rows unlabelled and every read joining two shapes.
//
// `url` alone can no longer be the key. Two domains can legitimately pull the
// same article, and under a global key the second one's `INSERT OR IGNORE` drops
// it while its own `score IS NOT NULL` index never sees it — so `dedupe` would
// re-offer and re-hydrate that URL every sweep, forever.
//
// Guarded on `articles.domain`, so it runs once and is a no-op on a database
// created fresh from the definitions above.
function migrateToDomains(db: Database): void {
  if (columnsOf(db, 'articles').includes('domain')) return;

  // The slug below is written out rather than taken from DEFAULT_DOMAIN: it
  // states what the stored rows already are, and must keep saying so if the
  // default ever moves to another domain.
  db.transaction(() => {
    db.exec(`
      CREATE TABLE articles_migrating (
        domain           TEXT NOT NULL,
        url              TEXT NOT NULL,
        title            TEXT NOT NULL,
        source           TEXT NOT NULL,
        published_at     TEXT NOT NULL,
        summary          TEXT NOT NULL DEFAULT '',
        score            INTEGER,
        matched_keywords TEXT,
        evidence         TEXT,
        scored_at        TEXT,
        PRIMARY KEY (domain, url)
      );
      INSERT INTO articles_migrating
        SELECT 'cybersecurite', url, title, source, published_at, summary,
               score, matched_keywords, evidence, scored_at
        FROM articles;
      DROP TABLE articles;
      ALTER TABLE articles_migrating RENAME TO articles;

      CREATE TABLE feed_sweeps_migrating (
        domain       TEXT NOT NULL,
        source       TEXT NOT NULL,
        swept_at     TEXT NOT NULL,
        error        TEXT,
        pages_unread INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (domain, source, swept_at)
      );
      INSERT INTO feed_sweeps_migrating
        SELECT 'cybersecurite', source, swept_at, error, pages_unread FROM feed_sweeps;
      DROP TABLE feed_sweeps;
      ALTER TABLE feed_sweeps_migrating RENAME TO feed_sweeps;

      CREATE TABLE unread_pages_migrating (
        domain   TEXT NOT NULL,
        url      TEXT NOT NULL,
        source   TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        first_at TEXT NOT NULL,
        last_at  TEXT NOT NULL,
        PRIMARY KEY (domain, url)
      );
      INSERT INTO unread_pages_migrating
        SELECT 'cybersecurite', url, source, attempts, first_at, last_at FROM unread_pages;
      DROP TABLE unread_pages;
      ALTER TABLE unread_pages_migrating RENAME TO unread_pages;

      -- The counter's old shape is a single row pinned by CHECK (id = 1), which
      -- no ALTER can widen. Its value is recomputed every sweep, so only the
      -- deploy-to-first-sweep gap needs it carried over; without that the site
      -- reads 0 rather than its real number until the next sweep lands.
      CREATE TABLE counter_migrating (
        domain     TEXT PRIMARY KEY,
        value      REAL NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO counter_migrating
        SELECT 'cybersecurite', value, updated_at FROM counter WHERE id = 1;
      DROP TABLE counter;
      ALTER TABLE counter_migrating RENAME TO counter;
    `);
  })();
}

// A slug is the `domain` column's value as well as a URL, so renaming one renames
// the rows with it — and every read filters on the new slug, which makes the old
// rows invisible rather than wrong. `ecologie` had already swept 24 times on the
// live volume when it became `environment`, carrying 25 scored articles and a
// counter reading 17.1.
//
// Guarded on the old slug still being present, so it is one write once rather
// than a write lock taken on every page render.
const RENAMED_DOMAINS: readonly (readonly [from: string, to: string])[] = [
  ['ecologie', 'environment'],
] as const;

const DOMAIN_TABLES = ['articles', 'feed_sweeps', 'unread_pages', 'counter'] as const;

function renameRetiredDomains(db: Database): void {
  for (const [from, to] of RENAMED_DOMAINS) {
    const stale = db
      .query<{ n: number }, [string, string, string]>(
        `SELECT (SELECT COUNT(*) FROM articles WHERE domain = ?)
              + (SELECT COUNT(*) FROM feed_sweeps WHERE domain = ?)
              + (SELECT COUNT(*) FROM counter WHERE domain = ?) AS n`
      )
      .get(from, from, from);
    if (!stale?.n) continue;

    // A plain UPDATE, so a row already sitting under the new slug raises the
    // primary-key conflict instead of one side being dropped silently.
    db.transaction(() => {
      for (const table of DOMAIN_TABLES) {
        db.query(`UPDATE ${table} SET domain = ? WHERE domain = ?`).run(to, from);
      }
    })();
  }
}

export function openDb(): Database {
  const db = new Database(dbPath(), { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      domain           TEXT NOT NULL,
      url              TEXT NOT NULL,
      title            TEXT NOT NULL,
      source           TEXT NOT NULL,
      published_at     TEXT NOT NULL,
      summary          TEXT NOT NULL DEFAULT '',
      score            INTEGER,
      matched_keywords TEXT,
      evidence         TEXT,
      scored_at        TEXT,
      PRIMARY KEY (domain, url)
    );
    CREATE TABLE IF NOT EXISTS counter (
      domain     TEXT PRIMARY KEY,
      value      REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feed_sweeps (
      domain       TEXT NOT NULL,
      source       TEXT NOT NULL,
      swept_at     TEXT NOT NULL,
      error        TEXT,
      pages_unread INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (domain, source, swept_at)
    );
    CREATE TABLE IF NOT EXISTS unread_pages (
      domain   TEXT NOT NULL,
      url      TEXT NOT NULL,
      source   TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      first_at TEXT NOT NULL,
      last_at  TEXT NOT NULL,
      PRIMARY KEY (domain, url)
    );
  `);
  migrateToDomains(db);
  renameRetiredDomains(db);
  // Created after the migration, which drops and renames the tables they index.
  db.exec(`
    CREATE INDEX IF NOT EXISTS articles_scored_at ON articles(domain, scored_at DESC);
    CREATE INDEX IF NOT EXISTS feed_sweeps_swept_at ON feed_sweeps(domain, swept_at DESC);
  `);
  // `feed_health` held one row per source with the current error and the start of
  // the failure run. Every fact in it is the newest `feed_sweeps` row for that
  // source, and keeping both left two tables that had to agree. Dropping it here
  // is the migration-less way to retire a table: it costs nothing, because
  // `aggregate` rewrote every row of it on every sweep anyway (STU-1207).
  db.exec('DROP TABLE IF EXISTS feed_health');
  return db;
}

function toArticle(row: ArticleRow): Article {
  return {
    title: row.title,
    url: row.url,
    source: row.source,
    date: row.published_at,
    score: row.score ?? 0,
    keywords: row.matched_keywords ? (JSON.parse(row.matched_keywords) as string[]) : [],
    evidence: row.evidence ?? '',
  };
}

interface SweepRow {
  source: string;
  swept_at: string;
  error: string | null;
  pages_unread: number;
}

// One row per source that failed at all recently. The whole retained history is
// read rather than just the window, because `since` has to reach past it — a feed
// down for a fortnight has no successful sweep inside 24 hours to date the run
// from.
export function readFeedErrors(db: Database, domain: string, now = Date.now()): FeedError[] {
  const rows = db
    .query<SweepRow, [string]>(
      'SELECT source, swept_at, error, pages_unread FROM feed_sweeps WHERE domain = ? ORDER BY source, swept_at'
    )
    .all(domain);

  const bySource = new Map<string, SweepRow[]>();
  for (const row of rows) {
    const group = bySource.get(row.source);
    if (group) group.push(row);
    else bySource.set(row.source, [row]);
  }

  const windowStart = new Date(now - SWEEP_WINDOW_MS).toISOString();
  const errors: FeedError[] = [];
  for (const [source, sweeps] of bySource) {
    const recent = sweeps.filter((s) => s.swept_at >= windowStart);
    const failed = recent.filter((s) => s.error !== null);
    const pagesUnread = recent.reduce((total, s) => total + s.pages_unread, 0);

    // The trailing run of failures, walked back from the newest sweep. It stops
    // at the first sweep that answered, which is what makes a recovered feed
    // clear itself without a separate reset.
    let since: string | null = null;
    let lastError: string | null = null;
    for (let i = sweeps.length - 1; i >= 0 && sweeps[i]!.error !== null; i--) {
      since = sweeps[i]!.swept_at;
      lastError ??= sweeps[i]!.error;
    }
    const feed: FeedError = {
      source,
      error: lastError ?? failed.at(-1)?.error ?? '',
      since,
      failedSweeps: failed.length,
      totalSweeps: recent.length,
      pagesUnread,
    };
    // A feed that failed once and recovered is not a fault, and listing it here
    // with its last error would tell an `/api/skynet` reader it is broken when it
    // is answering. Either it is in a failure run, or its record is bad enough to
    // count.
    if (since !== null || isFlapping(feed)) errors.push(feed);
  }
  return errors.sort(
    (a, b) => (a.since ?? '9').localeCompare(b.since ?? '9') || a.source.localeCompare(b.source)
  );
}

export function readSnapshot(domain: string, limit = 40): CounterSnapshot {
  const db = openDb();
  try {
    const counter = db
      .query<{ value: number; updated_at: string }, [string]>(
        'SELECT value, updated_at FROM counter WHERE domain = ?'
      )
      .get(domain);
    const rows = db
      .query<ArticleRow, [string, number]>(
        'SELECT * FROM articles WHERE domain = ? AND score IS NOT NULL ORDER BY published_at DESC LIMIT ?'
      )
      .all(domain, limit);
    const feedErrors = readFeedErrors(db, domain);
    return {
      counter: counter?.value ?? 0,
      updatedAt: counter?.updated_at ?? new Date(0).toISOString(),
      articles: rows.map(toArticle),
      feedErrors,
    };
  } finally {
    db.close();
  }
}

// The counter row on its own. `readSnapshot` is the wrong shape for a caller
// that wants the number: it reads 40 articles, parses each one's keyword JSON
// and derives the feed faults to answer it. The desktop widget polls every 15
// minutes and draws two fields, so it gets its own query.
export function readCounter(domain: string): Pick<CounterSnapshot, 'counter' | 'updatedAt'> {
  const db = openDb();
  try {
    const counter = db
      .query<{ value: number; updated_at: string }, [string]>(
        'SELECT value, updated_at FROM counter WHERE domain = ?'
      )
      .get(domain);
    return {
      counter: counter?.value ?? 0,
      updatedAt: counter?.updated_at ?? new Date(0).toISOString(),
    };
  } finally {
    db.close();
  }
}
