import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'dedupe.ts');

interface Fetched {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
}

const ARTICLE: Fetched = {
  title: 'Vulnerability giving attackers full control of Macs is under active exploitation',
  url: 'https://example.com/macs-exploit',
  source: 'arstechnica',
  publishedAt: '2026-09-01T00:00:00.000Z',
  summary: 'Screen-sharing bug lets remote hackers log in without a password.',
};

async function runDedupe(dbPath: string, articles: Fetched[] = [ARTICLE]) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    env: { ...process.env, SKYNET_DB: dbPath },
    stdin: new TextEncoder().encode(JSON.stringify({ previous_outputs: { fetch: { articles } } })),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out) as {
    new_count: number;
    seen_count: number;
    stranded_count: number;
    articles: Fetched[];
  };
}

function withDb(body: (dbPath: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skynet-dedupe-'));
    try {
      await body(join(dir, 'skynet.db'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function strand(dbPath: string, articles: Fetched[]): void {
  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      url TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL,
      published_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      score INTEGER, matched_keywords TEXT, evidence TEXT, scored_at TEXT
    );
  `);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO articles (url, title, source, published_at, summary) VALUES (?, ?, ?, ?, ?)'
  );
  for (const a of articles) insert.run(a.url, a.title, a.source, a.publishedAt, a.summary);
  db.close();
}

test(
  'an article inserted but never scored is offered again on the next run',
  withDb(async (dbPath) => {
    expect((await runDedupe(dbPath)).new_count).toBe(1);
    expect((await runDedupe(dbPath)).articles[0]?.url).toBe(ARTICLE.url);
  })
);

test(
  'a scored article is filtered out on the next run',
  withDb(async (dbPath) => {
    await runDedupe(dbPath);
    const db = new Database(dbPath);
    db.query('UPDATE articles SET score = 5, scored_at = ? WHERE url = ?').run(
      new Date().toISOString(),
      ARTICLE.url
    );
    db.close();
    expect((await runDedupe(dbPath)).new_count).toBe(0);
  })
);

test(
  'a stranded row whose feed item has rolled off is still handed to the scorer',
  withDb(async (dbPath) => {
    strand(dbPath, [ARTICLE]);

    // The feed no longer carries it, so nothing but the table can re-present it.
    const out = await runDedupe(dbPath, []);

    expect(out.stranded_count).toBe(1);
    expect(out.new_count).toBe(1);
    expect(out.articles).toEqual([ARTICLE]);
  })
);

test(
  'a stranded row still in the feed is one candidate, not two',
  withDb(async (dbPath) => {
    strand(dbPath, [ARTICLE]);

    const out = await runDedupe(dbPath, [ARTICLE]);

    expect(out.articles.map((a) => a.url)).toEqual([ARTICLE.url]);
    expect(out.new_count).toBe(1);
  })
);

test(
  'the backlog is carried oldest-first and drains within a bounded number of runs',
  withDb(async (dbPath) => {
    const backlog = Array.from({ length: 30 }, (_, i) => ({
      ...ARTICLE,
      title: `Stranded article ${i}`,
      url: `https://example.com/stranded-${i}`,
    }));
    strand(dbPath, backlog);

    // A run full of fresh news must not push the backlog's tail out of the batch.
    const first = await runDedupe(dbPath, [ARTICLE]);
    expect(first.articles.map((a) => a.url)).toEqual(backlog.slice(0, 25).map((a) => a.url));

    const db = new Database(dbPath);
    db.query('UPDATE articles SET score = 0, scored_at = ? WHERE score IS NULL AND url IN (SELECT url FROM articles WHERE score IS NULL ORDER BY rowid LIMIT 25)').run(
      new Date().toISOString()
    );
    db.close();

    const second = await runDedupe(dbPath, []);
    expect(second.articles.map((a) => a.url)).toEqual(backlog.slice(25).map((a) => a.url));
  })
);
