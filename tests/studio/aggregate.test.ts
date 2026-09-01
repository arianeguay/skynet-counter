import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '../../.studio/scripts/aggregate.ts');

interface FeedOutput {
  source: string;
  count: number;
  error: string | null;
  articles: unknown[];
}

const feed = (source: string, error: string | null = null): FeedOutput => ({
  source,
  count: error ? 0 : 1,
  error,
  articles: [],
});

async function runAggregate(dbPath: string, feeds: FeedOutput[]) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    env: { ...process.env, SKYNET_DB: dbPath },
    stdin: new TextEncoder().encode(
      JSON.stringify({ previous_outputs: { fetch: { outputs: feeds }, score: { articles: [] } } })
    ),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out) as {
    counter: number;
    updatedAt: string;
    feedErrors: { source: string; error: string; since: string }[];
  };
}

function withDb(body: (dbPath: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skynet-aggregate-'));
    try {
      await body(join(dir, 'skynet.db'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  'a feed that 404s is named in the counter output',
  withDb(async (dbPath) => {
    const out = await runAggregate(dbPath, [
      feed('Ars Technica Security', 'Ars Technica Security responded 404'),
      feed('Krebs on Security'),
    ]);

    expect(out.feedErrors).toEqual([
      {
        source: 'Ars Technica Security',
        error: 'Ars Technica Security responded 404',
        since: out.updatedAt,
      },
    ]);
  })
);

test(
  'a healthy feed reports nothing',
  withDb(async (dbPath) => {
    const out = await runAggregate(dbPath, [feed('Krebs on Security'), feed('Hacker News')]);

    expect(out.feedErrors).toEqual([]);
  })
);

// The whole point of the row: a 502 that clears next hour must not read the same
// as a URL that has been dead since last month.
test(
  'a feed still failing keeps the timestamp of its first failure',
  withDb(async (dbPath) => {
    const first = await runAggregate(dbPath, [feed('Ars Technica Security', 'responded 404')]);
    const second = await runAggregate(dbPath, [feed('Ars Technica Security', 'responded 500')]);

    expect(second.feedErrors[0]?.since).toBe(first.updatedAt);
    expect(second.feedErrors[0]?.error).toBe('responded 500');
    expect(second.updatedAt).not.toBe(first.updatedAt);
  })
);

test(
  'a feed that comes back clears its error and its failing_since',
  withDb(async (dbPath) => {
    await runAggregate(dbPath, [feed('Ars Technica Security', 'responded 404')]);
    const recovered = await runAggregate(dbPath, [feed('Ars Technica Security')]);

    expect(recovered.feedErrors).toEqual([]);

    const db = new Database(dbPath);
    const row = db
      .query<{ error: string | null; failing_since: string | null }, [string]>(
        'SELECT error, failing_since FROM feed_health WHERE source = ?'
      )
      .get('Ars Technica Security');
    db.close();
    expect(row).toEqual({ error: null, failing_since: null });
  })
);

test(
  'the longest-dead feed is reported first',
  withDb(async (dbPath) => {
    await runAggregate(dbPath, [feed('Ars Technica Security', 'responded 404')]);
    const out = await runAggregate(dbPath, [
      feed('Hacker News', 'responded 503'),
      feed('Ars Technica Security', 'responded 404'),
    ]);

    expect(out.feedErrors.map((f) => f.source)).toEqual(['Ars Technica Security', 'Hacker News']);
  })
);

// Deleting a feed from the input list is what you do when it stays dead, so its
// row must not outlive the list and keep naming a source nothing fetches.
test(
  'a feed dropped from the input list stops being reported',
  withDb(async (dbPath) => {
    await runAggregate(dbPath, [
      feed('Ars Technica Security', 'responded 404'),
      feed('Krebs on Security'),
    ]);
    const out = await runAggregate(dbPath, [feed('Krebs on Security')]);

    expect(out.feedErrors).toEqual([]);

    const db = new Database(dbPath);
    const sources = db
      .query<{ source: string }, []>('SELECT source FROM feed_health')
      .all()
      .map((r) => r.source);
    db.close();
    expect(sources).toEqual(['Krebs on Security']);
  })
);
