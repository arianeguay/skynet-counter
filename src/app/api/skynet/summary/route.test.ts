import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'skynet-summary-'));
process.env.SKYNET_DB = join(dir, 'skynet.db');

const { GET } = await import('./route');
const { openDb } = await import('@/lib/db');
const { DEFAULT_DOMAIN } = await import('@/lib/domains');

function setCounter(value: number, updatedAt: string) {
  const db = openDb();
  try {
    db.query('INSERT OR REPLACE INTO counter (domain, value, updated_at) VALUES (?, ?, ?)').run(
      DEFAULT_DOMAIN,
      value,
      updatedAt
    );
  } finally {
    db.close();
  }
}

// Runs first, against the file `openDb` has just created: a database that has
// never held a sweep must answer, not throw.
test('reports the floor and the epoch when no sweep has ever run', async () => {
  const body = await GET().json();
  expect(body).toEqual({
    counter: 0,
    updatedAt: new Date(0).toISOString(),
    status: 'NOMINAL',
  });
});

test('serves the stored counter and its timestamp', async () => {
  setCounter(41.3, '2026-09-01T12:00:00.000Z');
  const body = await GET().json();
  expect(body.counter).toBe(41.3);
  expect(body.updatedAt).toBe('2026-09-01T12:00:00.000Z');
});

// The band is served rather than computed by the caller, so a widget cannot
// drift from `counter.ts`.
test('serves the band the counter falls in', async () => {
  for (const [value, status] of [
    [9, 'NOMINAL'],
    [18, 'BACKGROUND CHATTER'],
    [41.3, 'ELEVATED ACTIVITY'],
    [72, 'CONTAINMENT DEGRADED'],
  ] as const) {
    setCounter(value, '2026-09-01T12:00:00.000Z');
    expect((await GET().json()).status).toBe(status);
  }
});

// The whole point of the route: the widget polls it every 15 minutes and must
// not drag 40 articles of evidence text across the wire to draw one number.
test('carries none of the snapshot payload', async () => {
  const body = await GET().json();
  expect(Object.keys(body).sort()).toEqual(['counter', 'status', 'updatedAt']);
});

// An Übersicht widget fetches from a `file://` document, which sends
// `Origin: null` and is refused without this.
test('is readable cross-origin and never cached', () => {
  const res = GET();
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('cache-control')).toBe('no-store');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
