import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrendChart } from './TrendChart';

const endsAt = Date.parse('2026-09-29T12:00:00Z');

test('fewer than two points renders nothing', () => {
  expect(renderToStaticMarkup(<TrendChart history={[41]} endsAt={endsAt} polarity="risk" />)).toBe('');
});

test('draws one point per day and reads out the latest day by default', () => {
  const markup = renderToStaticMarkup(<TrendChart history={[12, 30, 55, 41]} endsAt={endsAt} polarity="risk" />);

  const points = markup.match(/<polyline[^>]*points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  expect(points).toHaveLength(4);
  expect(markup).toContain('2026-09-29');
  expect(markup).toContain('ELEVATED ACTIVITY');
});

test('summarises the window: min, max, average and change', () => {
  const markup = renderToStaticMarkup(<TrendChart history={[12, 30, 55, 41]} endsAt={endsAt} polarity="risk" />);

  expect(markup).toContain('>12.0<');
  expect(markup).toContain('>55.0<');
  expect(markup).toContain('>34.5<');
  expect(markup).toContain('>+29.0<');
});

// The band lines are the gauge's own thresholds, worded for the domain's polarity.
test('labels the bands in the vocabulary of the domain’s polarity', () => {
  const risk = renderToStaticMarkup(<TrendChart history={[12, 41]} endsAt={endsAt} polarity="risk" />);
  const progress = renderToStaticMarkup(<TrendChart history={[12, 41]} endsAt={endsAt} polarity="progress" />);

  expect(risk).toContain('CONTAINMENT DEGRADED');
  expect(progress).toContain('GROUND GAINED');
  expect(progress).not.toContain('CONTAINMENT DEGRADED');
});
