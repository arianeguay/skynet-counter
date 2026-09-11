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

// A bare polyline with nothing to read it against was tried first, and looked
// like a floating squiggle rather than a chart — there was no way to tell where
// in its own range any point sat. Ruled the way the gauge's own dial already is:
// a hairline top and bottom bounding the range, two hairline ticks marking it
// into thirds — all in the recessive `--color-hairline` token, never the signal
// color, so the polyline stays the only thing that reads as data (STU-1290).
test('is ruled with a top line, a bottom line, and two ticks between them', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 41]} />);

  const lines = markup.match(/<line[^>]*>/g) ?? [];
  expect(lines).toHaveLength(4);
  // --color-ash, not --color-hairline: hairline is #1c1c20 against a near-black
  // background with nothing beside a thin line for contrast to borrow, and
  // rendered as good as invisible when actually checked (STU-1290).
  for (const line of lines) expect(line).toContain('var(--color-ash)');
});

// No axis numbers and no tooltip chrome — the ticks give scale without adding
// text the small strip has no room for.
test('carries no text or grouping chrome', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 41]} />);

  expect(markup).not.toContain('<text');
  expect(markup).not.toContain('<g ');
});

// Fixed to the gauge's own 0-100, not the series' own range (STU-1290 reopened
// after shipping autoscaled): a flat run near the ceiling must draw near the
// top of the strip rather than centering, because "near the top" is the fact
// this sparkline exists to show — the ticks now mean the same 0/33/67/100 on
// every domain's page.
test('a flat history near the ceiling hugs the top of the strip, not the middle', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[94, 95, 94]} />);
  const points = markup.match(/points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const ys = points.map((p) => Number(p.split(',')[1]));

  const top = 6; // PAD_Y
  for (const y of ys) expect(y).toBeLessThan(top + 4);
});

// The counter's own floor and ceiling must land exactly on the ruled top and
// bottom lines — that is what makes the ruling meaningful across domains.
test('0 and 100 land exactly on the bottom and top ruling lines', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[0, 100]} />);
  const points = markup.match(/points="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const ys = points.map((p) => Number(p.split(',')[1]));

  expect(Math.min(...ys)).toBeCloseTo(6, 1); // PAD_Y, the top: 100
  expect(Math.max(...ys)).toBeCloseTo(30, 1); // HEIGHT - PAD_Y, the bottom: 0
});

test('names how many days the trend covers, for anyone not reading the line', () => {
  const markup = renderToStaticMarkup(<TrendSparkline history={[12, 20, 41]} />);

  expect(markup).toContain('aria-label="Counter over the last 2 days"');
});
