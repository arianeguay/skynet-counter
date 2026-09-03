import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BALANCE_MATURITY_DAYS, openDb, readBalance, readCounter, readFeedErrors, readHostOutage, readSnapshot } from '@/lib/db';
import { DEFAULT_DOMAIN, DOMAINS, currentDomain, domainBySlug } from '@/lib/domains';

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

// STU-1218's domain shipped as `ecologie` and was renamed to `environment` when the
// tabs went English. It had already swept on the live volume by then, so the rename
// had to carry its rows: every read filters on the new slug, which makes rows left
// under the old one invisible rather than wrong.
test('a domain renamed after it had already swept keeps its history', () => {
  tempDbPath();
  const seed = openDb();
  seed
    .query(
      'INSERT INTO articles (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      'ecologie',
      'https://example.com/water',
      'Data centres tripled their water draw',
      'Data Center Dynamics',
      '2026-08-20T15:56:40.000Z',
      '',
      13,
      '["water usage"]',
      'tripled',
      '2026-08-20T16:00:00.000Z'
    );
  seed
    .query('INSERT INTO counter (domain, value, updated_at) VALUES (?, ?, ?)')
    .run('ecologie', 17.1, '2026-09-03T11:13:37.956Z');
  seed
    .query('INSERT INTO feed_sweeps (domain, source, swept_at, error, pages_unread) VALUES (?, ?, ?, NULL, 0)')
    .run('ecologie', 'Carbon Brief', '2026-09-03T11:13:37.956Z');
  seed.close();

  openDb().close();

  const moved = readSnapshot('environment');
  expect(moved.articles.map((a) => a.url)).toEqual(['https://example.com/water']);
  expect(moved.counter).toBe(17.1);
  expect(readCounter('ecologie').counter).toBe(0);

  const db = openDb();
  const sweeps = db
    .query<{ domain: string }, []>('SELECT DISTINCT domain FROM feed_sweeps')
    .all()
    .map((r) => r.domain);
  db.close();
  expect(sweeps).toEqual(['environment']);
});

// It runs on the rows it finds and then never again, so it must not disturb a
// database that has already been through it.
test('reopening after the rename leaves the renamed rows alone', () => {
  tempDbPath();
  insertScored('environment', 'https://example.com/already', 9);

  openDb().close();
  openDb().close();

  expect(readSnapshot('environment').articles.map((a) => a.url)).toEqual([
    'https://example.com/already',
  ]);
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

// Seeds `sweeps` sweeps an hour apart, most recent last. Each entry names the
// sources that FAILED that sweep; the rest of `sources` answered it.
function seedSweeps(db: Database, domain: string, sources: string[], failures: string[][]): void {
  const insert = db.prepare(
    'INSERT INTO feed_sweeps (domain, source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?, 0)'
  );
  failures.forEach((failed, i) => {
    const sweptAt = new Date(Date.now() - (failures.length - 1 - i) * 3_600_000).toISOString();
    for (const source of sources) {
      insert.run(domain, source, sweptAt, failed.includes(source) ? 'getaddrinfo ETIMEOUT' : null);
    }
  });
}

// The bug this closes: the host lost its resolver, every feed failed together,
// and each one independently accumulated the ratio that named it on a public
// page. Four innocent publishers were listed that way on 2026-09-03.
test('a sweep that lost every source is struck from each feed record', () => {
  tempDbPath();
  const db = openDb();
  const sources = ['Ars Technica', 'Krebs on Security', 'The Hacker News'];
  seedSweeps(db, 'cybersecurite', sources, [sources, sources, sources, ['Ars Technica']]);

  const errors = readFeedErrors(db, 'cybersecurite');
  db.close();

  // Only the sweep the other two survived counts, so only the feed that failed
  // it is left — and on that one sweep, not on four.
  expect(errors.map((e) => e.source)).toEqual(['Ars Technica']);
  expect(errors[0]).toMatchObject({ failedSweeps: 1, totalSweeps: 1 });
});

test('the outage is reported rather than silently discarded', () => {
  tempDbPath();
  const db = openDb();
  const sources = ['Ars Technica', 'Krebs on Security'];
  seedSweeps(db, 'cybersecurite', sources, [sources, [], sources]);

  const outage = readHostOutage(db, 'cybersecurite');
  db.close();

  expect(outage).toMatchObject({ sweeps: 2, error: 'getaddrinfo ETIMEOUT' });
});

// With one feed, "every feed failed" is only "the feed failed" — and charging
// that to the host would erase the one fault the domain can actually have.
test('a single-source domain never charges its own outage to the host', () => {
  tempDbPath();
  const db = openDb();
  seedSweeps(db, 'environment', ['Grist'], [['Grist'], ['Grist'], ['Grist']]);

  const errors = readFeedErrors(db, 'environment');
  const outage = readHostOutage(db, 'environment');
  db.close();

  expect(errors.map((e) => e.source)).toEqual(['Grist']);
  expect(outage).toBeNull();
});

// The distinction that keeps the rule honest: a status line means the host
// resolved the name and completed the connection, so however many feeds carry
// one, the fault is theirs and stays on their record.
test('feeds that answered with an HTTP status are never charged to the host', () => {
  tempDbPath();
  const db = openDb();
  const insert = db.prepare(
    'INSERT INTO feed_sweeps (domain, source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?, 0)'
  );
  const sweptAt = new Date().toISOString();
  insert.run('cybersecurite', 'Krebs on Security', sweptAt, 'Krebs on Security responded 503');
  insert.run('cybersecurite', 'Ars Technica', sweptAt, 'Ars Technica responded 404');

  const errors = readFeedErrors(db, 'cybersecurite');
  const outage = readHostOutage(db, 'cybersecurite');
  db.close();

  expect(errors.map((e) => e.source)).toEqual(['Ars Technica', 'Krebs on Security']);
  expect(outage).toBeNull();
});

test('an outage older than the window is struck from records but not reported', () => {
  tempDbPath();
  const db = openDb();
  const insert = db.prepare(
    'INSERT INTO feed_sweeps (domain, source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?, 0)'
  );
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  for (const source of ['Grist', 'Carbon Brief']) insert.run('environment', source, old, 'getaddrinfo ETIMEOUT');

  const errors = readFeedErrors(db, 'environment');
  const outage = readHostOutage(db, 'environment');
  db.close();

  expect(errors).toEqual([]);
  expect(outage).toBeNull();
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

// STU-1280: the balance reads the whole registry from real rows, scoped per
// domain exactly like every other read here — a burst in one domain must not
// move another's deviation.
function seedArticle(domain: string, daysAgo: number, score: number, i = 0): void {
  const db = openDb();
  const at = new Date(Date.now() - daysAgo * 864e5).toISOString();
  db.query(
    'INSERT INTO articles (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(domain, `https://example.com/${domain}-${daysAgo}-${i}`, `${domain} story`, 'A Feed', at, '', score, '[]', '', at);
  db.close();
}

// A domain past the maturity bar, with a quiet run and a burst today — the
// shape `normalizedDeviation`'s own unit tests already exercise, reused here
// to prove `readBalance` wires a real, old-enough domain through correctly.
function seedMatureDomain(domain: string, burstScore: number): void {
  seedArticle(domain, BALANCE_MATURITY_DAYS + 10, 3);
  seedArticle(domain, 5, 3);
  seedArticle(domain, 0, burstScore);
}

test('the balance reads every mature domain, scoped to its own articles', () => {
  tempDbPath();
  const risk = DOMAINS.find((d) => d.polarity === 'risk')!;
  const progress = DOMAINS.find((d) => d.polarity === 'progress')!;

  seedMatureDomain(risk.slug, 80);
  seedMatureDomain(progress.slug, 3); // same quiet score as its own baseline — no real burst

  const balance = readBalance();
  expect(balance.map((d) => d.slug).sort()).toEqual([progress.slug, risk.slug].sort());

  const riskDeviation = balance.find((d) => d.slug === risk.slug)!;
  expect(riskDeviation.polarity).toBe('risk');
  expect(riskDeviation.deviation).toBeGreaterThan(0);

  // Domain isolation, the same property `readSnapshot` already guarantees: a
  // real burst in one domain reads far more elevated than a quiet day in another.
  const progressDeviation = balance.find((d) => d.slug === progress.slug)!;
  expect(progressDeviation.polarity).toBe('progress');
  expect(progressDeviation.deviation).toBeLessThan(riskDeviation.deviation);
});

// STU-1283: a domain whose oldest article predates `BALANCE_MATURITY_DAYS` has
// `counterHistory` sample points that read BASE only because the domain did not
// exist yet — not because it was quiet. Included, that reads as a wild swing;
// excluded, there is honestly nothing to compare yet.
test('a domain younger than the maturity window is left out of the balance entirely', () => {
  tempDbPath();
  const risk = DOMAINS.find((d) => d.polarity === 'risk')!;

  // Oldest article is one day short of the maturity bar.
  seedArticle(risk.slug, BALANCE_MATURITY_DAYS - 1, 3);
  seedArticle(risk.slug, 0, 90);

  expect(readBalance().map((d) => d.slug)).not.toContain(risk.slug);
});

test('a domain right at the maturity bar is included', () => {
  tempDbPath();
  const risk = DOMAINS.find((d) => d.polarity === 'risk')!;

  seedArticle(risk.slug, BALANCE_MATURITY_DAYS, 3);
  seedArticle(risk.slug, 0, 3);

  expect(readBalance().map((d) => d.slug)).toContain(risk.slug);
});

test('a domain with no scored articles at all is left out, not read as perfectly calm', () => {
  tempDbPath();
  expect(readBalance()).toEqual([]);
});

// The regression this guards: the first version of this gate checked
// `published_at`, and a domain's first sweep can carry in months-old backlog
// items (STU-1206's stranded-row carry). That made every domain here read as
// "mature" by publish date while none of them had a single real day of
// observation — checked directly on the live site (STU-1283).
test('an old published_at from a first-sweep backlog does not count as maturity', () => {
  tempDbPath();
  const risk = DOMAINS.find((d) => d.polarity === 'risk')!;

  const db = openDb();
  const scoredNow = new Date().toISOString();
  const publishedLongAgo = new Date(Date.now() - (BALANCE_MATURITY_DAYS + 30) * 864e5).toISOString();
  db.query(
    'INSERT INTO articles (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(risk.slug, 'https://example.com/backlog', 'An old story, just scored', 'A Feed', publishedLongAgo, '', 40, '[]', '', scoredNow);
  db.close();

  expect(readBalance().map((d) => d.slug)).not.toContain(risk.slug);
});
