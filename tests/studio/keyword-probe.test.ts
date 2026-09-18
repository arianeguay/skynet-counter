import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { DEFAULT_DOMAIN } from '@/lib/domains';
import { environment } from '@/lib/domains/environment';

const SCRIPT = new URL('../../scripts/keyword-probe.ts', import.meta.url).pathname;

interface Row {
  summary: string;
  score: number | null;
  title?: string;
  domain?: string;
  published_at?: string;
}

function dbWith(rows: Row[]) {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-probe-'));
  const path = join(dir, 'x.db');
  const db = new Database(path);
  db.run(
    'CREATE TABLE articles (domain TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, published_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT \'\', score INTEGER, PRIMARY KEY (domain, url))'
  );
  rows.forEach((r, i) =>
    db.run('INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?, ?)', [
      r.domain ?? DEFAULT_DOMAIN,
      `u${i}`,
      r.title ?? 'A headline',
      'A Feed',
      r.published_at ?? new Date().toISOString(),
      r.summary,
      r.score,
    ])
  );
  db.close();
  return { path, dir };
}

async function probe(path: string, args: string[] = [], domain = DEFAULT_DOMAIN) {
  const proc = Bun.spawn(['bun', SCRIPT, ...args], {
    env: { ...process.env, SKYNET_DB: path, SKYNET_DOMAIN: domain },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

/** The probe's row for `term`, as columns. */
function row(out: string, term: string): string[] {
  const line = out.split('\n').find((l) => l.trimStart().startsWith(`${term} `) || l.trim() === term);
  if (!line) throw new Error(`no row for ${term} in:\n${out}`);
  return line.trim().split(/\s{2,}/);
}

test('every keyword in the live table gets a row, whether or not it fires', async () => {
  const { path } = dbWith([{ summary: 'a ransomware crew hit a hospital', score: 6 }]);
  const { code, out } = await probe(path);
  expect(code).toBe(0);
  expect(row(out, 'ransomware').slice(1, 3)).toEqual(['1', '100%']);
  // The point of the DEAD verdict is that a keyword firing on nothing is still
  // printed — a table of silent entries is a counter stuck at its floor.
  expect(row(out, 'self-replicating')).toEqual(['self-replicating', '0', '0%', '0.0', '0', 'DEAD']);
});

test('an unscored row is the backlog, not a zero, and is left out of the corpus', async () => {
  const { path } = dbWith([
    { summary: 'a breach', score: 5 },
    { summary: 'a breach', score: null },
  ]);
  const { out } = await probe(path);
  expect(out).toContain('1 scored articles');
  expect(row(out, 'breach').slice(1, 3)).toEqual(['1', '100%']);
});

test('candidates are measured beside the table and report what they collide with', async () => {
  const { path, dir } = dbWith([
    { summary: 'they weaponized it into a working exploit', score: 0 },
    { summary: 'a breach notification went out', score: 5 },
    { summary: 'a router firmware update shipped on time', score: 0 },
  ]);
  const file = join(dir, 'candidates.txt');
  writeFileSync(file, '# a comment\nweaponiz\nbreach notification\n\n');
  const { out } = await probe(path, ['--candidates', file]);
  // `rescues` is the column the decision turns on: this term reaches an article
  // the live table scores at zero, the other only adds weight to one it counts.
  expect(row(out, 'weaponiz')).toEqual(['weaponiz', '1', '33%', '0.0', '1']);
  expect(row(out, 'breach notification')).toEqual(['breach notification', '1', '33%', '5.0', '0', 'breach']);
  expect(out).toContain('2 terms not in the table');
});

test('a domain with a subject gate probes the rows its counter can actually count', async () => {
  // Both rows carry `aquifer`; only one is about AI. Counting the other would
  // make any candidate look like it rescues articles the table missed, when the
  // gate had already thrown them away (STU-1291).
  const { path } = dbWith([
    { summary: 'a data center is draining the aquifer', score: 9, domain: 'environment' },
    { summary: 'an oil spill reached the aquifer', score: 0, domain: 'environment' },
  ]);
  const { out } = await probe(path, [], 'environment');
  expect(environment.subject).toBeDefined();
  expect(out).toContain('the gate holds back 1 of 2 scored rows (50%)');
  expect(row(out, 'aquifer').slice(1, 3)).toEqual(['1', '100%']);
});

test('--days bounds the corpus by publication date', async () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
  const { path } = dbWith([
    { summary: 'a jailbreak today', score: 8, published_at: daysAgo(1) },
    { summary: 'a jailbreak last season', score: 8, published_at: daysAgo(90) },
  ]);
  expect(row((await probe(path, ['--days', '7'])).out, 'jailbreak').slice(1, 2)).toEqual(['1']);
  expect(row((await probe(path)).out, 'jailbreak').slice(1, 2)).toEqual(['2']);
});

test('an empty corpus exits non-zero rather than printing a table of zeroes', async () => {
  const { path } = dbWith([]);
  const { code, out } = await probe(path);
  expect(code).toBe(1);
  expect(out).toContain('no scored cybersecurite article to probe');
});
