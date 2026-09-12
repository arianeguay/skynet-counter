import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiidTrendChart } from './AiidTrendChart';

test('no data renders the empty state with the backfill command', () => {
  const markup = renderToStaticMarkup(<AiidTrendChart data={[]} />);

  expect(markup).toContain('No incidents loaded yet');
  expect(markup).toContain('make backfill-aiid');
});

test('one row per year, each printing its own count', () => {
  const markup = renderToStaticMarkup(
    <AiidTrendChart
      data={[
        { year: 2020, count: 10 },
        { year: 2021, count: 40 },
      ]}
    />
  );

  expect(markup).toContain('2020');
  expect(markup).toContain('2021');
  expect((markup.match(/<li/g) ?? []).length).toBe(2);
});

test('bar widths are proportional to the loudest year', () => {
  const markup = renderToStaticMarkup(
    <AiidTrendChart
      data={[
        { year: 2020, count: 25 },
        { year: 2021, count: 100 },
      ]}
    />
  );

  const widths = [...markup.matchAll(/width:(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  expect(widths).toEqual([25, 100]);
});

test('names the holdback window so the missing months read as expected, not broken', () => {
  const markup = renderToStaticMarkup(<AiidTrendChart data={[{ year: 2020, count: 1 }]} />);

  expect(markup).toContain('held back');
});
