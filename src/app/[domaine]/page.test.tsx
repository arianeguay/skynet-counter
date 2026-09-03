import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.SKYNET_DB = join(mkdtempSync(join(tmpdir(), 'skynet-page-')), 'skynet.db');

const { default: DomainPage, dynamic, generateMetadata } = await import('./page');
const { openDb } = await import('@/lib/db');
const { DOMAINS, DEFAULT_DOMAIN } = await import('@/lib/domains');

function seed(domain: string, url: string, score: number, title: string): void {
  const db = openDb();
  db.query(
    'INSERT OR REPLACE INTO articles (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(domain, url, title, 'A Feed', '2026-09-01T00:00:00.000Z', '', score, '[]', '', '2026-09-01T01:00:00.000Z');
  db.query(
    'INSERT OR REPLACE INTO counter (domain, value, updated_at) VALUES (?, ?, ?)'
  ).run(domain, score, '2026-09-01T01:00:00.000Z');
  db.close();
}

const render = async (domaine: string) =>
  renderToStaticMarkup(await DomainPage({ params: Promise.resolve({ domaine }) }));

// An unknown slug must not render an empty gauge: 0 is what "a quiet week" looks
// like, so a typo would publish "no risk" rather than "no such counter".
test('a slug no domain module defines is a 404, not an empty counter', async () => {
  await expect(render('domotique')).rejects.toThrow();
});

test('a domain renders its own counter and its own articles', async () => {
  seed(DEFAULT_DOMAIN, 'https://example.com/a', 41.3, 'A scored cybersecurity story');

  const markup = await render(DEFAULT_DOMAIN);

  expect(markup).toContain('41.3');
  expect(markup).toContain('A scored cybersecurity story');
});

// The partition has to survive all the way to the page, not just to `readSnapshot`.
test('a domain does not render another domain’s articles', async () => {
  seed(DEFAULT_DOMAIN, 'https://example.com/own', 12, 'Belongs to this domain');
  seed('environment', 'https://example.com/other', 99, 'Belongs to another domain');

  const markup = await render(DEFAULT_DOMAIN);

  expect(markup).toContain('Belongs to this domain');
  expect(markup).not.toContain('Belongs to another domain');
});

test('the page is titled and described by the domain it serves', async () => {
  const domain = DOMAINS[0]!;
  const meta = await generateMetadata({ params: Promise.resolve({ domaine: domain.slug }) });

  expect(meta.title).toContain(domain.label);
  expect(meta.description).toBe(domain.tagline);
});

// A prerendered counter is a counter frozen at build time, and it looks exactly
// like a working one until someone checks the timestamp.
test('the route is rendered per request, never prerendered', () => {
  expect(dynamic).toBe('force-dynamic');
});

// The accent is remapped on the wrapper, not passed down, so this is where a
// progress domain stops looking like an alarm (STU-1279).
test('a progress domain renders its own bands, question and accent', async () => {
  seed('frontend', 'https://example.com/baseline', 41, 'Anchor positioning is newly available');

  const markup = await render('frontend');

  expect(markup).toContain('polarity-progress');
  expect(markup).toContain('STEADY ADVANCE');
  expect(markup).toContain('The Convergence');
  expect(markup).not.toContain('The Singularity');
  expect(markup).not.toContain('ELEVATED ACTIVITY');
});

// The risk domains must read exactly as they did before the mechanism existed.
test('a risk domain keeps the Singularity question and no polarity class', async () => {
  seed(DEFAULT_DOMAIN, 'https://example.com/risk', 41, 'A scored security story');

  const markup = await render(DEFAULT_DOMAIN);

  expect(markup).toContain('The Singularity');
  expect(markup).toContain('ELEVATED ACTIVITY');
  expect(markup).not.toContain('polarity-progress');
});
