import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'skynet-domain-api-'));
process.env.SKYNET_DB = join(dir, 'skynet.db');

const { GET: snapshot } = await import('./route');
const { GET: summary } = await import('./summary/route');
const { GET: defaultSnapshot } = await import('../route');
const { GET: defaultSummary } = await import('../summary/route');
const { openDb } = await import('@/lib/db');
const { DOMAINS, DEFAULT_DOMAIN } = await import('@/lib/domains');

// Two registered domains pointing opposite ways: the default one, which the
// unchanged paths must keep serving, and a progress domain, whose band comes out
// of a different vocabulary. Anything that pooled the two would read one
// counter, one log, or the wrong band.
const RISK = DEFAULT_DOMAIN;
const PROGRESS = DOMAINS.find((d) => d.polarity === 'progress')!.slug;

function seed(domain: string, counter: number, title: string) {
  const db = openDb();
  try {
    db.query('INSERT OR REPLACE INTO counter (domain, value, updated_at) VALUES (?, ?, ?)').run(
      domain,
      counter,
      `2026-09-0${counter === 41.3 ? 1 : 2}T12:00:00.000Z`
    );
    db.query(
      `INSERT OR REPLACE INTO articles
         (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      domain,
      `https://example.test/${domain}`,
      title,
      'Example',
      '2026-09-01T00:00:00.000Z',
      '',
      12,
      '["keyword"]',
      'evidence',
      '2026-09-01T01:00:00.000Z'
    );
  } finally {
    db.close();
  }
}

function req(domaine: string) {
  return [new Request('http://localhost/'), { params: Promise.resolve({ domaine }) }] as const;
}

seed(RISK, 41.3, 'A risk story');
seed(PROGRESS, 8, 'A progress story');

test('serves each domain its own counter and its own articles', async () => {
  const risk = await (await snapshot(...req(RISK))).json();
  expect(risk.counter).toBe(41.3);
  expect(risk.articles.map((a: { title: string }) => a.title)).toEqual(['A risk story']);

  const progress = await (await snapshot(...req(PROGRESS))).json();
  expect(progress.counter).toBe(8);
  expect(progress.articles.map((a: { title: string }) => a.title)).toEqual(['A progress story']);
});

// The band is the asked-for domain's, not the default one's. A progress counter
// reading 8 is STALLED; NOMINAL would be the risk vocabulary leaking across.
test('serves each domain its own band', async () => {
  expect(await (await summary(...req(RISK))).json()).toEqual({
    counter: 41.3,
    updatedAt: '2026-09-01T12:00:00.000Z',
    status: 'ELEVATED ACTIVITY',
  });
  expect(await (await summary(...req(PROGRESS))).json()).toEqual({
    counter: 8,
    updatedAt: '2026-09-02T12:00:00.000Z',
    status: 'STALLED',
  });
});

// An unregistered slug reads as a domain having a quiet week — counter 0, no
// articles — which is exactly the thing a counter must never publish about a
// domain that does not exist. `/[domaine]` 404s for the same reason.
test('404s an unknown slug on both shapes rather than serving an empty snapshot', async () => {
  for (const handler of [snapshot, summary]) {
    const res = await handler(...req('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('nope');
  }
});

// The paths that existed before this route did. A widget config and a bookmark
// point at them, so they answer as they always did.
test('leaves the default-serving paths unchanged', async () => {
  const snap = await defaultSnapshot().json();
  expect(snap.counter).toBe(41.3);
  expect(snap.articles.map((a: { title: string }) => a.title)).toEqual(['A risk story']);

  const res = defaultSummary();
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toEqual({
    counter: 41.3,
    updatedAt: '2026-09-01T12:00:00.000Z',
    status: 'ELEVATED ACTIVITY',
  });
});

// The per-domain summary has the same caller as the default one: an Übersicht
// widget fetching from a `file://` document, which sends `Origin: null`.
test('is readable cross-origin per domain and never cached', async () => {
  const res = await summary(...req(PROGRESS));
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('cache-control')).toBe('no-store');
});

// A static segment beats a dynamic sibling in Next's router, so `/api/skynet/summary`
// resolves to the widget's default-serving route and never to `/api/skynet/<slug>`.
// A domain registered under that slug would be unreachable over the API while its
// page rendered fine — the same shadow `next.config.test.ts` guards for retired slugs.
test('no domain takes a slug the static API segments already own', () => {
  const reserved = ['summary'];
  expect(DOMAINS.map((d) => d.slug).filter((s) => reserved.includes(s))).toEqual([]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
