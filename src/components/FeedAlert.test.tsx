import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FeedError } from '@/lib/db';
import { FLAP_MIN_SWEEPS } from '@/lib/db';
import { FeedAlert, STALE_AFTER_MS } from './FeedAlert';

// A feed in an unbroken run of failures since `since`, answering none of them.
const failing = (since: number, source = 'Hacker News'): FeedError => ({
  source,
  error: 'HTTP 404',
  since: new Date(since).toISOString(),
  failedSweeps: 24,
  totalSweeps: 24,
  pagesUnread: 0,
});

// A feed that answered the newest sweep — so no run to date — but failed
// `failed` of its last `total`.
const flapping = (failed: number, total: number, source = 'Hacker News'): FeedError => ({
  source,
  error: 'HTTP 503',
  since: null,
  failedSweeps: failed,
  totalSweeps: total,
  pagesUnread: 0,
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
  expect(html).toContain('1 source unreliable');
});

// The gap this closes: failing 23 hours out of 24 never accumulates a day-old
// run, so the threshold above never fires and the feed stayed invisible while
// losing almost everything it should have carried.
test('a feed that fails most of its sweeps is reported even though it is up now', () => {
  const html = renderToStaticMarkup(<FeedAlert feedErrors={[flapping(18, 24)]} />);
  expect(html).toContain('Hacker News');
  expect(html).toContain('FLAPPING 18/24');
});

// The grace that STU-1197 added has to survive: one 502 in a healthy day is a
// publisher hiccup, not a fault worth putting on a public page.
test('a feed that failed once and recovered still renders nothing', () => {
  expect(renderToStaticMarkup(<FeedAlert feedErrors={[flapping(1, 24)]} />)).toBe('');
});

// A ratio over one or two sweeps is noise; a fresh database hits this on its
// first failure and must not raise a fault from it.
test('a bad ratio over too few sweeps is not enough to report', () => {
  const tooFew = flapping(FLAP_MIN_SWEEPS - 1, FLAP_MIN_SWEEPS - 1);
  expect(renderToStaticMarkup(<FeedAlert feedErrors={[tooFew]} />)).toBe('');
});
