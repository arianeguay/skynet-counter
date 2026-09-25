import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'skynet-summary-all-'));
process.env.SKYNET_DB = join(dir, 'skynet.db');

const { GET } = await import('./route');
const { openDb } = await import('@/lib/db');
const { DOMAINS } = await import('@/lib/domains');

test('serves every registered domain, in registry order', async () => {
  const body = await GET().json();
  expect(body.map((d: { slug: string }) => d.slug)).toEqual(DOMAINS.map((d) => d.slug));
});

// Each entry is the single-domain summary plus what the widget needs to draw it
// without a copy of the registry.
test('carries the label, the polarity and that domain\'s own counter and band', async () => {
  const progress = DOMAINS.find((d) => d.polarity === 'progress')!;
  const db = openDb();
  try {
    db.query('INSERT OR REPLACE INTO counter (domain, value, updated_at) VALUES (?, ?, ?)').run(
      progress.slug,
      8,
      '2026-09-01T12:00:00.000Z'
    );
  } finally {
    db.close();
  }
  const body = await GET().json();
  const entry = body.find((d: { slug: string }) => d.slug === progress.slug);
  expect(Object.keys(entry).sort()).toEqual(['counter', 'label', 'polarity', 'slug', 'status', 'updatedAt']);
  expect(entry).toMatchObject({ label: progress.label, polarity: 'progress', counter: 8, status: 'STALLED' });
});

test('is readable cross-origin and never cached', () => {
  const res = GET();
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('cache-control')).toBe('no-store');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
