import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DomainDeviation } from '@/lib/balance';
import { BalanceBand } from './BalanceBand';

const dev = (slug: string, polarity: 'risk' | 'progress', deviation: number): DomainDeviation => ({
  slug,
  polarity,
  deviation,
});

// The verification criterion the ticket names explicitly: nothing on one side
// means nothing to show, not a bar pretending it has something to say.
test('renders nothing with no progress domain to compare against', () => {
  expect(renderToStaticMarkup(<BalanceBand deviations={[dev('cybersecurite', 'risk', 0.5)]} />)).toBe('');
});

test('renders nothing with no risk domain to compare against', () => {
  expect(renderToStaticMarkup(<BalanceBand deviations={[dev('frontend', 'progress', 0.5)]} />)).toBe('');
});

test('renders nothing with an empty registry', () => {
  expect(renderToStaticMarkup(<BalanceBand deviations={[]} />)).toBe('');
});

test('an even balance names neither side ahead', () => {
  const markup = renderToStaticMarkup(
    <BalanceBand deviations={[dev('cybersecurite', 'risk', 0), dev('frontend', 'progress', 0)]} />
  );
  expect(markup).toContain('EVENLY MATCHED');
  expect(markup).not.toContain('DARK SIDE IS AHEAD');
  expect(markup).not.toContain('LIGHT SIDE IS AHEAD');
});

test('a clear risk-side lean names the dark side ahead', () => {
  const markup = renderToStaticMarkup(
    <BalanceBand deviations={[dev('cybersecurite', 'risk', 0.8), dev('frontend', 'progress', 0)]} />
  );
  expect(markup).toContain('THE DARK SIDE IS AHEAD');
});

test('a clear progress-side lean names the light side ahead', () => {
  const markup = renderToStaticMarkup(
    <BalanceBand deviations={[dev('cybersecurite', 'risk', 0), dev('frontend', 'progress', 0.8)]} />
  );
  expect(markup).toContain('THE LIGHT SIDE IS AHEAD');
});

// Both ends are always printed, whichever side is ahead — the bar is a
// comparison, not a verdict alone.
test('both end labels are always present', () => {
  const markup = renderToStaticMarkup(
    <BalanceBand deviations={[dev('cybersecurite', 'risk', 1), dev('frontend', 'progress', -1)]} />
  );
  expect(markup).toContain('LIGHT SIDE');
  expect(markup).toContain('DARK SIDE');
});
