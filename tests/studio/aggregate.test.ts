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

async function runAggregate(dbPath: string, feeds: FeedOutput[], pagesUnread: Record<string, number> = {}) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    env: { ...process.env, SKYNET_DB: dbPath },
    stdin: new TextEncoder().encode(
      JSON.stringify({
        previous_outputs: {
          fetch: { outputs: feeds },
          dedupe: { pages_unread: pagesUnread },
          score: { articles: [] },
        },
      })
    ),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out) as {
    counter: number;
    updatedAt: string;
    feedErrors: {
      source: string;
      error: string;
      since: string | null;
      failedSweeps: number;
      totalSweeps: number;
      pagesUnread: number;
    }[];
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
        failedSweeps: 1,
        totalSweeps: 1,
        pagesUnread: 0,
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

// A sweep that answers ends the run, and the run is what dates the fault — so
// recovery needs no reset of its own.
test(
  'a feed that comes back stops being reported, and its history is kept',
  withDb(async (dbPath) => {
    await runAggregate(dbPath, [feed('Ars Technica Security', 'responded 404')]);
    const recovered = await runAggregate(dbPath, [feed('Ars Technica Security')]);

    expect(recovered.feedErrors).toEqual([]);

    const db = new Database(dbPath);
    const rows = db
      .query<{ error: string | null }, [string]>(
        'SELECT error FROM feed_sweeps WHERE source = ? ORDER BY swept_at'
      )
      .all('Ars Technica Security');
    db.close();
    // The failed sweep is still on record; only the newest one decides the state.
    expect(rows).toEqual([{ error: 'responded 404' }, { error: null }]);
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
      .query<{ source: string }, []>('SELECT DISTINCT source FROM feed_sweeps')
      .all()
      .map((r) => r.source);
    db.close();
    expect(sources).toEqual(['Krebs on Security']);
  })
);


// The gap STU-1207 closes: failing 23 hours out of 24 never accumulates a day-old
// run, so the staleness rule never fires. The record of the sweeps is the only
// thing that shows it, which is why there is a row per sweep rather than per feed.
test(
  'a feed that alternates failing and answering is reported on its record',
  withDb(async (dbPath) => {
    // Four failures alternating with four answers: 4 of 8, exactly the ratio, and
    // the newest sweep answered so there is no run for the staleness rule to date.
    for (let i = 0; i < 3; i++) {
      await runAggregate(dbPath, [feed('Hacker News', 'responded 503')]);
      await runAggregate(dbPath, [feed('Hacker News')]);
    }
    await runAggregate(dbPath, [feed('Hacker News', 'responded 503')]);
    const out = await runAggregate(dbPath, [feed('Hacker News')]);

    const hn = out.feedErrors.find((f) => f.source === 'Hacker News');
    expect(hn?.since).toBeNull();
    expect(hn?.failedSweeps).toBe(4);
    expect(hn?.totalSweeps).toBe(8);
  })
);

// A single failure in an otherwise healthy day is a publisher hiccup — it must
// not reach the payload at all, or `/api/skynet` names a feed that is answering.
test(
  'one failure among healthy sweeps is not reported',
  withDb(async (dbPath) => {
    await runAggregate(dbPath, [feed('Hacker News')]);
    await runAggregate(dbPath, [feed('Hacker News', 'responded 503')]);
    for (let i = 0; i < 4; i++) await runAggregate(dbPath, [feed('Hacker News')]);
    const out = await runAggregate(dbPath, [feed('Hacker News')]);

    expect(out.feedErrors).toEqual([]);
  })
);

// STU-1205: the count reached no table, so a steady partial loss lived only in
// the container log and vanished when it rolled.
test(
  'the linked pages a sweep could not read are persisted per feed',
  withDb(async (dbPath) => {
    await runAggregate(dbPath, [feed('Hacker News', 'responded 503')], { 'Hacker News': 2 });
    const out = await runAggregate(dbPath, [feed('Hacker News', 'responded 503')], { 'Hacker News': 3 });

    expect(out.feedErrors[0]?.pagesUnread).toBe(5);

    const db = new Database(dbPath);
    const rows = db
      .query<{ pages_unread: number }, []>('SELECT pages_unread FROM feed_sweeps ORDER BY swept_at')
      .all();
    db.close();
    expect(rows).toEqual([{ pages_unread: 2 }, { pages_unread: 3 }]);
  })
);
