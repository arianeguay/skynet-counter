import { Database } from 'bun:sqlite';

// Read per call, not once at module load: capturing it at import time meant
// whichever test file pulled this module in first decided the path for the whole
// process, so adding an unrelated import moved another suite's database.
export function dbPath(): string {
  return process.env.SKYNET_DB ?? 'data/skynet.db';
}

export interface ArticleRow {
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

export interface CounterSnapshot {
  counter: number;
  updatedAt: string;
  articles: Article[];
  feedErrors: FeedError[];
}

export function openDb(): Database {
  const db = new Database(dbPath(), { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      url              TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      source           TEXT NOT NULL,
      published_at     TEXT NOT NULL,
      summary          TEXT NOT NULL DEFAULT '',
      score            INTEGER,
      matched_keywords TEXT,
      evidence         TEXT,
      scored_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS articles_scored_at ON articles(scored_at DESC);
    CREATE TABLE IF NOT EXISTS counter (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      value      REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feed_sweeps (
      source       TEXT NOT NULL,
      swept_at     TEXT NOT NULL,
      error        TEXT,
      pages_unread INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (source, swept_at)
    );
    CREATE INDEX IF NOT EXISTS feed_sweeps_swept_at ON feed_sweeps(swept_at DESC);
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
export function readFeedErrors(db: Database, now = Date.now()): FeedError[] {
  const rows = db
    .query<SweepRow, []>('SELECT source, swept_at, error, pages_unread FROM feed_sweeps ORDER BY source, swept_at')
    .all();

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

export function readSnapshot(limit = 40): CounterSnapshot {
  const db = openDb();
  try {
    const counter = db
      .query<{ value: number; updated_at: string }, []>('SELECT value, updated_at FROM counter WHERE id = 1')
      .get();
    const rows = db
      .query<ArticleRow, [number]>(
        'SELECT * FROM articles WHERE score IS NOT NULL ORDER BY published_at DESC LIMIT ?'
      )
      .all(limit);
    const feedErrors = readFeedErrors(db);
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
// and queries `feed_health` to answer it. The desktop widget polls every 15
// minutes and draws two fields, so it gets its own query.
export function readCounter(): Pick<CounterSnapshot, 'counter' | 'updatedAt'> {
  const db = openDb();
  try {
    const counter = db
      .query<{ value: number; updated_at: string }, []>('SELECT value, updated_at FROM counter WHERE id = 1')
      .get();
    return {
      counter: counter?.value ?? 0,
      updatedAt: counter?.updated_at ?? new Date(0).toISOString(),
    };
  } finally {
    db.close();
  }
}
