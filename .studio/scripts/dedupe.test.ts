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

async function runDedupe(
  dbPath: string,
  previousOutputs: Record<string, { articles: typeof ARTICLE[] }> = {
    fetch: { articles: [ARTICLE] },
  }
) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    env: { ...process.env, SKYNET_DB: dbPath },
    stdin: new TextEncoder().encode(JSON.stringify({ previous_outputs: previousOutputs })),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out) as { new_count: number; articles: typeof ARTICLE[] };
}

// Newest first, so a global newest-first cut would take the busy feed's 40 and
// nothing else. Minute-apart timestamps keep every article's rank unambiguous.
function batch(source: string, count: number, startedAt: string) {
  const start = Date.parse(startedAt);
  return Array.from({ length: count }, (_, i) => ({
    title: `${source} story ${i}`,
    url: `https://example.com/${source.replace(/\W+/g, '-').toLowerCase()}/${i}`,
    source,
    publishedAt: new Date(start - i * 60_000).toISOString(),
    summary: `${source} summary ${i}`,
  }));
}

function withTempDb(run: (dbPath: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skynet-dedupe-'));
    try {
      await run(join(dir, 'skynet.db'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
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

test(
  'a burst on one feed does not push an older feed out of the batch',
  withTempDb(async (dbPath) => {
    const out = await runDedupe(dbPath, {
      'fetch-techcrunch': { articles: batch('TechCrunch AI', 40, '2026-09-01T12:00:00.000Z') },
      'fetch-arstechnica': { articles: batch('Ars Technica', 20, '2026-08-20T12:00:00.000Z') },
    });

    expect(out.new_count).toBe(25);
    const bySource = (source: string) => out.articles.filter((a) => a.source === source).length;
    expect(bySource('Ars Technica')).toBe(12);
    expect(bySource('TechCrunch AI')).toBe(13);
  })
);

test(
  'the cap is still filled when only one feed has anything to offer',
  withTempDb(async (dbPath) => {
    const out = await runDedupe(dbPath, {
      'fetch-techcrunch': { articles: batch('TechCrunch AI', 40, '2026-09-01T12:00:00.000Z') },
      'fetch-arstechnica': { articles: [] },
    });

    expect(out.new_count).toBe(25);
    expect(out.articles[0]?.title).toBe('TechCrunch AI story 0');
  })
);
