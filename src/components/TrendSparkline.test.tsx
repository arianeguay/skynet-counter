import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrendSparkline } from './TrendSparkline';

// `readCounterTrend` already returns [] for a domain with no real history, and a
// single point cannot show a trend either — nothing renders rather than a lone
// dot standing in for "we don't know yet" (STU-1290).
test('fewer than two points renders nothing', () => {
  expect(renderToStaticMarkup(<TrendSparkline history={[]} />)).toBe('');
  expect(renderToStaticMarkup(<TrendSparkline history={[41]} />)).toBe('');
});

test('two or more points render an svg with one polyline point per day', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 30, 55, 41]} />);

  expect(markup).toContain('<svg');
  expect(markup).toContain('<polyline');
  const points = markup.match(/points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  expect(points).toHaveLength(4);
});

// No axes, no gridlines, no tooltip chrome — just the line, per the issue's own
// spec. Asserted as an absence rather than a presence, since the whole point is
// what this component does *not* add to the page.
test('carries no axis, gridline or text chrome', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 41]} />);

  expect(markup).not.toContain('<text');
  expect(markup).not.toContain('<line ');
  expect(markup).not.toContain('<g ');
});

// Autoscaled to the series' own range, not the gauge's fixed 0-100: the gauge
// beside this already shows absolute position, so a real 10-70 swing must fill
// the strip the same way a real 40-45 swing does — the sparkline's only job is
// shape of change, and a fixed ceiling nothing gets near read every domain as
// a flat line (STU-1290).
test('a genuinely flat history centers in the strip rather than hugging an edge', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 12, 12]} />);
  const points = markup.match(/points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const ys = points.map((p) => Number(p.split(',')[1]));

  const mid = 28 / 2;
  for (const y of ys) expect(Math.abs(y - mid)).toBeLessThan(2);
});

// The two extremes of a real series must reach the top and bottom of the strip
// — that is the whole point of autoscaling, and the property a fixed domain lost.
test('the series’ own min and max reach the edges of the strip', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[10, 40, 70]} />);
  const points = markup.match(/points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const ys = points.map((p) => Number(p.split(',')[1]));

  expect(Math.min(...ys)).toBeCloseTo(3, 0); // PAD, the top
  expect(Math.max(...ys)).toBeCloseTo(25, 0); // HEIGHT - PAD, the bottom
});

test('an extreme outlier still draws within the strip’s own bounds', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[-2000, 9000]} />);

  expect(markup).toContain('<svg');
  const points = markup.match(/points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const ys = points.map((p) => Number(p.split(',')[1]));
  for (const y of ys) {
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(28);
  }
});

test('names how many days the trend covers, for anyone not reading the line', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 20, 41]} />);

  expect(markup).toContain('aria-label="Counter over the last 2 days"');
});
