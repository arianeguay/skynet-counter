import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'dedupe.ts');

const ARTICLE = {
  title: 'Vulnerability giving attackers full control of Macs is under active exploitation',
  url: 'https://example.com/macs-exploit',
  source: 'arstechnica',
  publishedAt: '2026-09-01T00:00:00.000Z',
  summary: 'Screen-sharing bug lets remote hackers log in without a password.',
};

async function runDedupe(dbPath: string) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    env: { ...process.env, SKYNET_DB: dbPath },
    stdin: new TextEncoder().encode(
      JSON.stringify({ previous_outputs: { fetch: { articles: [ARTICLE] } } })
    ),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out) as { new_count: number; articles: typeof ARTICLE[] };
}

test('an article inserted but never scored is offered again on the next run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-dedupe-'));
  const dbPath = join(dir, 'skynet.db');
  try {
    expect((await runDedupe(dbPath)).new_count).toBe(1);
    expect((await runDedupe(dbPath)).articles[0]?.url).toBe(ARTICLE.url);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scored article is filtered out on the next run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-dedupe-'));
  const dbPath = join(dir, 'skynet.db');
  try {
    await runDedupe(dbPath);
    const db = new Database(dbPath);
    db.query('UPDATE articles SET score = 5, scored_at = ? WHERE url = ?').run(
      new Date().toISOString(),
      ARTICLE.url
    );
    db.close();
    expect((await runDedupe(dbPath)).new_count).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
