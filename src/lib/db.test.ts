import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, readCounter, readFeedErrors, readSnapshot } from '@/lib/db';
import { DEFAULT_DOMAIN, currentDomain, domainBySlug } from '@/lib/domains';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.SKYNET_DB;
  delete process.env.SKYNET_DOMAIN;
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-db-'));
  dirs.push(dir);
  const path = join(dir, 'skynet.db');
  process.env.SKYNET_DB = path;
  return path;
}

// The schema exactly as it stood before domains existed, so the migration is
// tested against the shape the live volume actually holds rather than against a
// paraphrase of it.
function seedPreDomainDb(path: string): void {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE articles (
      url TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL,
      published_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      score INTEGER, matched_keywords TEXT, evidence TEXT, scored_at TEXT
    );
    CREATE INDEX articles_scored_at ON articles(scored_at DESC);
    CREATE TABLE counter (
      id INTEGER PRIMARY KEY CHECK (id = 1), value REAL NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE feed_sweeps (
      source TEXT NOT NULL, swept_at TEXT NOT NULL, error TEXT,
      pages_unread INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source, swept_at)
    );
    CREATE INDEX feed_sweeps_swept_at ON feed_sweeps(swept_at DESC);
    CREATE TABLE unread_pages (
      url TEXT PRIMARY KEY, source TEXT NOT NULL, attempts INTEGER NOT NULL,
      first_at TEXT NOT NULL, last_at TEXT NOT NULL
    );
  `);
  db.query(
    'INSERT INTO articles (url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'https://example.com/rce',
    'Remote code execution in a build server',
    'Krebs on Security',
    '2026-08-30T00:00:00.000Z',
    'A maintainer pushed a backdoored release.',
    18,
    JSON.stringify(['remote code execution', 'backdoor']),
    'a backdoored release',
    '2026-08-30T01:00:00.000Z'
  );
  db.query('INSERT INTO counter (id, value, updated_at) VALUES (1, ?, ?)').run(
    41.3,
    '2026-08-30T01:00:00.000Z'
  );
  db.query('INSERT INTO feed_sweeps (source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?)').run(
    'Hacker News',
    new Date().toISOString(),
    'responded 503',
    2
  );
  db.query(
    'INSERT INTO unread_pages (url, source, attempts, first_at, last_at) VALUES (?, ?, ?, ?, ?)'
  ).run('https://example.com/dead.pdf', 'Hacker News', 2, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
  db.close();
}

// `openDb()` has no migration framework, and the only copy of the history behind
// the published counter is the live volume — so opening it must relabel that
// history in place rather than start an empty second shape beside it.
test('opening a pre-domain database keeps its history and files it under cybersecurite', () => {
  const path = tempDbPath();
  seedPreDomainDb(path);

  openDb().close();

  const snapshot = readSnapshot('cybersecurite');
  expect(snapshot.articles).toHaveLength(1);
  expect(snapshot.articles[0]).toMatchObject({
    url: 'https://example.com/rce',
    score: 18,
    keywords: ['remote code execution', 'backdoor'],
  });
  expect(snapshot.counter).toBe(41.3);
  expect(snapshot.updatedAt).toBe('2026-08-30T01:00:00.000Z');
});

// Without the value carried over, the site publishes 0 rather than its real
// number for the whole gap between the deploy and the next sweep.
test('the migration carries the counter over rather than waiting for a sweep', () => {
  const path = tempDbPath();
  seedPreDomainDb(path);

  openDb().close();

  expect(readCounter('cybersecurite')).toEqual({
    counter: 41.3,
    updatedAt: '2026-08-30T01:00:00.000Z',
  });
});

test('the migration carries the sweep record and the unreadable pages over', () => {
  const path = tempDbPath();
  seedPreDomainDb(path);

  const db = openDb();
  const errors = readFeedErrors(db, 'cybersecurite');
  const unread = db
    .query<{ domain: string; url: string; attempts: number }, []>(
      'SELECT domain, url, attempts FROM unread_pages'
    )
    .all();
  db.close();

  expect(errors.map((e) => e.source)).toEqual(['Hacker News']);
  expect(unread).toEqual([
    { domain: 'cybersecurite', url: 'https://example.com/dead.pdf', attempts: 2 },
  ]);
});

test('opening an already-migrated database a second time changes nothing', () => {
  const path = tempDbPath();
  seedPreDomainDb(path);

  openDb().close();
  openDb().close();

  expect(readSnapshot('cybersecurite').articles).toHaveLength(1);
  expect(readCounter('cybersecurite').counter).toBe(41.3);
});

function insertScored(domain: string, url: string, score: number): void {
  const db = openDb();
  db.query(
    'INSERT INTO articles (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    domain,
    url,
    `${domain} story`,
    `${domain} feed`,
    '2026-09-01T00:00:00.000Z',
    'summary',
    score,
    '[]',
    '',
    '2026-09-01T01:00:00.000Z'
  );
  db.close();
}

// The whole point of the partition: a domain's counter must be a statement about
// that domain's feeds and nothing else.
test('a domain reads only its own articles', () => {
  tempDbPath();
  insertScored('cybersecurite', 'https://example.com/a', 20);
  insertScored('environment', 'https://example.com/b', 5);

  expect(readSnapshot('cybersecurite').articles.map((a) => a.url)).toEqual([
    'https://example.com/a',
  ]);
  expect(readSnapshot('environment').articles.map((a) => a.url)).toEqual(['https://example.com/b']);
});

// A URL both domains legitimately pull. Under the old global `url` key only one
// row could exist, so the second domain's `INSERT OR IGNORE` was dropped while
// its own seen-index never saw it — re-offering and re-hydrating that page every
// sweep, forever.
test('two domains can hold the same article without colliding', () => {
  tempDbPath();
  insertScored('cybersecurite', 'https://example.com/shared', 20);
  insertScored('environment', 'https://example.com/shared', 5);

  expect(readSnapshot('cybersecurite').articles[0]?.score).toBe(20);
  expect(readSnapshot('environment').articles[0]?.score).toBe(5);
});

test('a domain reads only its own counter, and zero when it has never swept', () => {
  tempDbPath();
  const db = openDb();
  db.query('INSERT INTO counter (domain, value, updated_at) VALUES (?, ?, ?)').run(
    'cybersecurite',
    41.3,
    '2026-09-01T00:00:00.000Z'
  );
  db.close();

  expect(readCounter('cybersecurite').counter).toBe(41.3);
  expect(readCounter('environment').counter).toBe(0);
});

test('a domain reads only its own feed faults', () => {
  tempDbPath();
  const db = openDb();
  const insert = db.prepare(
    'INSERT INTO feed_sweeps (domain, source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?, 0)'
  );
  insert.run('cybersecurite', 'Krebs on Security', new Date().toISOString(), 'responded 404');
  insert.run('environment', 'Carbon Brief', new Date().toISOString(), 'responded 500');

  expect(readFeedErrors(db, 'cybersecurite').map((e) => e.source)).toEqual(['Krebs on Security']);
  expect(readFeedErrors(db, 'environment').map((e) => e.source)).toEqual(['Carbon Brief']);
  db.close();
});

// A typo in a compose file or a Makefile would otherwise sweep into a domain
// nothing reads, and the only symptom would be a counter that stops moving.
test('an unknown SKYNET_DOMAIN fails loudly rather than falling back', () => {
  process.env.SKYNET_DOMAIN = 'domotique';
  expect(() => currentDomain()).toThrow('domotique');
});

test('an unset SKYNET_DOMAIN is the default domain', () => {
  expect(currentDomain().slug).toBe(DEFAULT_DOMAIN);
  expect(domainBySlug(DEFAULT_DOMAIN)).toBeDefined();
});
