import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FeedError } from '@/lib/db';
import { FeedAlert, STALE_AFTER_MS } from './FeedAlert';

const failing = (since: number, source = 'Hacker News'): FeedError => ({
  source,
  error: 'HTTP 404',
  since: new Date(since).toISOString(),
});

test('renders nothing when no feed is failing', () => {
  expect(renderToStaticMarkup(<FeedAlert feedErrors={[]} />)).toBe('');
});

test('renders nothing while a failure is younger than the threshold', () => {
  const fresh = failing(Date.now() - STALE_AFTER_MS / 2);
  expect(renderToStaticMarkup(<FeedAlert feedErrors={[fresh]} />)).toBe('');
});

test('names the source and its age once the failure outlives the threshold', () => {
  const dead = failing(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const html = renderToStaticMarkup(<FeedAlert feedErrors={[dead]} />);
  expect(html).toContain('Hacker News');
  expect(html).toContain('DOWN 14D');
  expect(html).toContain('HTTP 404');
});

test('reports hours under two days and counts only the stale failures', () => {
  const dead = failing(Date.now() - 30 * 60 * 60 * 1000);
  const html = renderToStaticMarkup(<FeedAlert feedErrors={[dead, failing(Date.now(), 'Ars Technica')]} />);
  expect(html).toContain('DOWN 30H');
  expect(html).toContain('1 source stopped answering');
});
