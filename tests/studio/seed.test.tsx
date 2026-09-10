import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASE, HORIZON_DAYS, counterFrom, normalizedSignal } from '@/lib/counter';
import { balanceOf } from '@/lib/balance';
import { isFlapping, openDb, readBalance, readSnapshot, scoredHistory } from '@/lib/db';
import { DOMAINS, DEFAULT_DOMAIN, domainBySlug } from '@/lib/domains';
import { FeedAlert, STALE_AFTER_MS } from '@/components/FeedAlert';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/seed.ts');
const LIVE = join(ROOT, 'data/skynet.db');

const scratch = () => join(mkdtempSync(join(tmpdir(), 'skynet-seed-')), 'x.db');

// Spawned rather than imported: what is being asserted is largely what the script
// does with its environment before it writes anything, and a module-level
// `process.exit` cannot be caught in-process.
async function seed(scenario: string, env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn(['bun', SCRIPT, scenario], {
    cwd: ROOT,
    env: { ...process.env, SKYNET_DB: undefined, SKYNET_DOMAIN: undefined, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err };
}

const inherited = { db: process.env.SKYNET_DB, domain: process.env.SKYNET_DOMAIN };
afterEach(() => {
  process.env.SKYNET_DB = inherited.db;
  process.env.SKYNET_DOMAIN = inherited.domain;
});

// Read back through `readSnapshot` rather than a query written here: a fixture is
// worth something only if the page's own reader finds what it wrote.
function snapshotOf(path: string, domain = DEFAULT_DOMAIN) {
  process.env.SKYNET_DB = path;
  return readSnapshot(domain);
}

test('a seeded database drives the page reader it was written for', async () => {
  const path = scratch();
  const { code, out } = await seed('nominal', { SKYNET_DB: path });
  expect(code).toBe(0);
  expect(out).toContain(path);

  const snapshot = snapshotOf(path);
  expect(snapshot.articles.length).toBeGreaterThan(0);
  expect(snapshot.counter).toBeGreaterThan(35);
  expect(snapshot.counter).toBeLessThan(60);
  expect(snapshot.feedErrors).toEqual([]);
  expect(snapshot.hostOutage).toBeNull();
});

// The whole point of the fixture: the counter it writes and the log it writes have
// to be one state. A script asserting a counter of its own would draw a gauge its
// own article log does not explain — which is exactly the page bug it exists to
// make visible.
test('the counter written is the one the formula recomputes from the rows', async () => {
  const path = scratch();
  await seed('nominal', { SKYNET_DB: path });

  process.env.SKYNET_DB = path;
  const domain = domainBySlug(DEFAULT_DOMAIN)!;
  const db = openDb();
  const history = scoredHistory(db, domain, new Date(Date.now() - HORIZON_DAYS * 864e5).toISOString());
  db.close();

  // To a tenth, not exactly: the two readings are taken seconds apart and the
  // decay moves between them.
  expect(counterFrom(normalizedSignal(history, Date.now()), BASE, domain.divisor)).toBeCloseTo(
    snapshotOf(path).counter,
    0
  );
});

// STU-1197's panel, which shipped without anyone seeing it draw. The scenario is
// only useful if the source it fails has been failing long enough to outlive the
// panel's day of grace.
test('dead-feed puts a source past the fault panel’s grace period', async () => {
  const path = scratch();
  await seed('dead-feed', { SKYNET_DB: path });

  const { feedErrors, hostOutage } = snapshotOf(path);
  expect(feedErrors).toHaveLength(1);
  expect(Date.now() - Date.parse(feedErrors[0]!.since!)).toBeGreaterThan(STALE_AFTER_MS);
  expect(hostOutage).toBeNull();

  const markup = renderToStaticMarkup(<FeedAlert feedErrors={feedErrors} hostOutage={hostOutage} />);
  expect(markup).toContain('/// FEED FAULT');
  expect(markup).toContain('DOWN 30H');
});

// The other half of that panel, and the state a failure run can never produce: a
// feed answering right now is judged on its record instead.
test('flapping leaves the source answering and still faulty', async () => {
  const path = scratch();
  await seed('flapping', { SKYNET_DB: path });

  const { feedErrors } = snapshotOf(path);
  expect(feedErrors).toHaveLength(1);
  expect(feedErrors[0]!.since).toBeNull();
  expect(isFlapping(feedErrors[0]!)).toBe(true);
  expect(renderToStaticMarkup(<FeedAlert feedErrors={feedErrors} />)).toContain('FLAPPING');
});

// A sweep where nothing could be reached is the host's fault, and the panel names
// nobody for it. That is invisible unless the seeded sweeps carry no HTTP status,
// since a status is what tells `reachedPublisher` the host resolved the name
// (STU-1278).
test('host-outage reports the host and names no publisher', async () => {
  const path = scratch();
  await seed('host-outage', { SKYNET_DB: path });

  const { feedErrors, hostOutage } = snapshotOf(path);
  expect(hostOutage).not.toBeNull();
  expect(feedErrors).toEqual([]);

  const markup = renderToStaticMarkup(<FeedAlert feedErrors={feedErrors} hostOutage={hostOutage} />);
  expect(markup).toContain('/// HOST FAULT');
  expect(markup).not.toContain('/// FEED FAULT');
});

test('empty writes the schema and nothing else', async () => {
  const path = scratch();
  const { code } = await seed('empty', { SKYNET_DB: path });
  expect(code).toBe(0);

  const snapshot = snapshotOf(path);
  expect(snapshot.articles).toEqual([]);
  expect(snapshot.counter).toBe(0);
  expect(snapshot.feedErrors).toEqual([]);
});

// The balance band reads the whole registry and renders nothing with either side
// unpopulated, so it is the one page state a single domain cannot produce. It is
// gated on `scored_at`, which the fixture has to write far enough back.
test('balance matures every domain in the registry', async () => {
  const path = scratch();
  await seed('balance', { SKYNET_DB: path });

  process.env.SKYNET_DB = path;
  const deviations = readBalance();
  expect(deviations.map((d) => d.slug).sort()).toEqual(DOMAINS.map((d) => d.slug).sort());
  expect(balanceOf(deviations)).not.toBeNull();
});

// A domain whose feeds carry more than its own beat gates on a subject list, and a
// seeded row failing that gate is invisible to every read on the page — the
// fixture would show a blank page rather than the scenario asked for.
test('rows seeded for a gated domain survive its subject gate', async () => {
  const gated = DOMAINS.find((d) => d.subject)!;
  const path = scratch();
  const { code } = await seed('nominal', { SKYNET_DB: path, SKYNET_DOMAIN: gated.slug });
  expect(code).toBe(0);

  const snapshot = snapshotOf(path, gated.slug);
  expect(snapshot.articles.length).toBeGreaterThan(0);
  expect(snapshot.counter).toBeGreaterThan(BASE);
});

// A scenario is a whole page state, so a second run replaces the first rather than
// stacking another sixty days of history on top of it.
test('re-seeding replaces the file rather than adding to it', async () => {
  const path = scratch();
  await seed('nominal', { SKYNET_DB: path });
  const first = snapshotOf(path).articles.length;
  await seed('nominal', { SKYNET_DB: path });
  expect(snapshotOf(path).articles.length).toBe(first);
});

// The guard the issue is built around. The history behind a live counter exists
// only on the volume serving it — the file is gitignored and never backed up — so
// a fixture writer that can reach it is one keystroke from deleting a month of
// scored articles.
test('it refuses to write a live database', async () => {
  const before = existsSync(LIVE) ? statSync(LIVE).mtimeMs : null;

  const unset = await seed('nominal');
  expect(unset.code).toBe(1);
  expect(unset.err).toContain('SKYNET_DB is unset');

  const volume = await seed('nominal', { SKYNET_DB: '/data/skynet.db' });
  expect(volume.code).toBe(1);
  expect(volume.err).toContain('refusing to write');

  const checkout = await seed('nominal', { SKYNET_DB: 'data/skynet.db' });
  expect(checkout.code).toBe(1);
  expect(checkout.err).toContain('refusing to write');

  expect(existsSync(LIVE) ? statSync(LIVE).mtimeMs : null).toBe(before);
});

test('an unknown scenario lists the ones that exist', async () => {
  const { code, err } = await seed('nope', { SKYNET_DB: scratch() });
  expect(code).toBe(1);
  expect(err).toContain('no scenario called "nope"');
  expect(err).toContain('dead-feed');
  expect(err).toContain('empty');
});
