import { Database } from 'bun:sqlite';

export const DB_PATH = process.env.SKYNET_DB ?? 'data/skynet.db';

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

export interface CounterSnapshot {
  counter: number;
  updatedAt: string;
  articles: Article[];
}

export function openDb(): Database {
  const db = new Database(DB_PATH, { create: true });
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
  `);
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
    return {
      counter: counter?.value ?? 0,
      updatedAt: counter?.updated_at ?? new Date(0).toISOString(),
      articles: rows.map(toArticle),
    };
  } finally {
    db.close();
  }
}
