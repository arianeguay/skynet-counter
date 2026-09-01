import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { counterFrom, decayedSignal } from '@/lib/counter';

const SCRIPT = new URL('../../scripts/calibrate.ts', import.meta.url).pathname;

function dbWith(rows: { score: number | null; published_at: string; source?: string }[]) {
  const path = join(mkdtempSync(join(tmpdir(), 'skynet-cal-')), 'x.db');
  const db = new Database(path);
  db.run('CREATE TABLE articles (url TEXT PRIMARY KEY, source TEXT NOT NULL, published_at TEXT NOT NULL, score INTEGER)');
  rows.forEach((r, i) =>
    db.run('INSERT INTO articles VALUES (?, ?, ?, ?)', [`u${i}`, r.source ?? 'A Feed', r.published_at, r.score])
  );
  db.close();
  return path;
}

async function calibrate(path: string) {
  const proc = Bun.spawn(['bun', SCRIPT], { env: { ...process.env, SKYNET_DB: path }, stdout: 'pipe' });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

test('the grid reproduces the counter the formula would publish', async () => {
  const rows = [
    { score: 20, published_at: daysAgo(0) },
    { score: 10, published_at: daysAgo(7) },
  ];
  const { code, out } = await calibrate(dbWith(rows));
  expect(code).toBe(0);
  // 20 at age 0 plus 10 at one half-life = 20 + 5 = 25 signal, so BASE + 25/32.
  const expected = counterFrom(decayedSignal(rows.map((r) => ({ ...r, score: r.score })), Date.now()));
  expect(expected).toBeCloseTo(12.8, 1);
  expect(out).toContain(expected.toFixed(1));
  expect(out).toContain('2 scored articles');
});

// An unscored row is the scorer's backlog, not a zero — counting it would drag
// the measured scoring rate down and mis-set DIVISOR.
test('unscored rows are left out of the corpus', async () => {
  const { out } = await calibrate(
    dbWith([
      { score: 20, published_at: daysAgo(0) },
      { score: null, published_at: daysAgo(0) },
    ])
  );
  expect(out).toContain('1 scored articles');
});

// Beyond the horizon the formula ignores an article entirely; the harness has to
// agree, or it calibrates against input the pipeline never sees.
test('articles older than the horizon are outside the corpus', async () => {
  const { code, out } = await calibrate(dbWith([{ score: 20, published_at: daysAgo(45) }]));
  expect(code).toBe(1);
  expect(out).toContain('nothing to calibrate against');
});

// Each feed's RSS window is a different length — Krebs reaches back two months,
// hnrss two days — so dividing every feed's output by the corpus span lands the
// rate several times low, and DIVISOR with it.
test('each feed rate is measured over its own window, not the corpus span', async () => {
  const { out } = await calibrate(
    dbWith([
      { score: 10, published_at: daysAgo(20), source: 'Slow Feed' },
      { score: 10, published_at: daysAgo(1), source: 'Fast Feed' },
      { score: 10, published_at: daysAgo(2), source: 'Fast Feed' },
    ])
  );
  const window = (source: string) => Number(out.match(new RegExp(`${source}\\s+\\d+ articles over\\s+([\\d.]+)d`))![1]);
  expect(window('Slow Feed')).toBeGreaterThan(15);
  expect(window('Fast Feed')).toBeLessThan(3);
});

// Today is still filling, so counting it would report a partial day as a whole
// one and understate the rate.
test('today is excluded from the per-feed rate', async () => {
  const { out } = await calibrate(
    dbWith([
      { score: 10, published_at: daysAgo(3), source: 'A Feed' },
      { score: 99, published_at: new Date().toISOString(), source: 'A Feed' },
    ])
  );
  expect(out).toContain('2 scored articles');
  expect(out).toMatch(/A Feed\s+1 articles/);
});
