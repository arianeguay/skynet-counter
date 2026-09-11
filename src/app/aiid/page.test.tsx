import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.SKYNET_DB = join(mkdtempSync(join(tmpdir(), 'skynet-aiid-page-')), 'skynet.db');

const { default: AiidTrendPage, dynamic } = await import('./page');
const { openDb } = await import('@/lib/db');

function seed(incidentId: number, date: string, title: string): void {
  const db = openDb();
  db.query(
    'INSERT OR REPLACE INTO aiid_incidents (incident_id, date, title, ingested_at) VALUES (?, ?, ?, ?)'
  ).run(incidentId, date, title, new Date().toISOString());
  db.close();
}

test('the route is rendered per request, never prerendered', () => {
  expect(dynamic).toBe('force-dynamic');
});

test('with no rows loaded, the page renders the empty state', () => {
  const markup = renderToStaticMarkup(<AiidTrendPage />);
  expect(markup).toContain('No incidents loaded yet');
});

test('a loaded incident outside the holdback window shows up on the chart', () => {
  const oldEnough = new Date(Date.now() - 400 * 864e5).toISOString();
  seed(1, oldEnough, 'A historical incident');

  const markup = renderToStaticMarkup(<AiidTrendPage />);
  expect(markup).toContain(String(new Date(oldEnough).getUTCFullYear()));
});

test('this page is not a domain: no balance band, no polarity wrapper', () => {
  const markup = renderToStaticMarkup(<AiidTrendPage />);
  expect(markup).not.toContain('polarity-progress');
});
