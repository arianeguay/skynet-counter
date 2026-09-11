import { expect, test } from 'bun:test';
import { BASE, steadySignal, type Sourced } from './counter';
import {
  SATURATION_MULTIPLE,
  SOURCE_MATURITY_DAYS,
  divisorSaturation,
  sourceRates,
} from './calibration';

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
// Midnight-aligned, so a feed running from `spanDays` ago to yesterday measures
// over exactly that many days. `sourceRates` dates a window from today's
// midnight, the way `calibrate` does, so rows posted at noon would leave every
// rate half a day short of the round number the comments here quote.
const day = (daysAgo: number): string =>
  new Date(NOW - daysAgo * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z';

// One source publishing `perDay` points of score a day, every day, from
// `spanDays` ago until yesterday — the shape a mature feed's own RSS window
// leaves in the table.
function feed(source: string, perDay: number, spanDays: number): Sourced[] {
  const rows: Sourced[] = [];
  for (let daysAgo = spanDays; daysAgo >= 1; daysAgo--) {
    rows.push({ source, score: perDay, published_at: day(daysAgo) });
  }
  return rows;
}

// `cybersecurite` as it stood on 2026-09-11: three newsrooms added to a divisor
// calibrated against the three before them, measured output at 232 points of
// score a day against the 97 it was picked from. /32 projects to 81 on an
// ordinary week and the live gauge read 94.6 within a day.
const OUTGROWN = [
  ...feed('Ars Technica Security', 30, 20),
  ...feed('The Hacker News', 34, 20),
  ...feed('Krebs on Security', 33, 20),
  ...feed('BleepingComputer', 48, 20),
  ...feed('The Record', 45, 20),
  ...feed('Dark Reading', 42, 20),
];

test('a mature feed set whose ordinary week pegs the gauge is flagged', () => {
  const flag = divisorSaturation(OUTGROWN, NOW, 32);

  expect(flag).not.toBeNull();
  expect(flag!.divisor).toBe(32);
  expect(flag!.sources).toBe(6);
  expect(flag!.dailyScore).toBeCloseTo(232, 0);
  // Unclamped on purpose: the clamp is the complaint, so reporting 100 would say
  // nothing about how far past the ceiling the projection sits.
  expect(flag!.projected).toBeCloseTo(BASE + steadySignal(232) / 32, 0);
});

// The same feed set against the divisor it was actually given on 2026-09-11.
// /64 reads 47 on an ordinary week and 81 on a doubled one — provisional, and
// not the failure this check exists for.
test('the same feed set against a divisor that fits it is not flagged', () => {
  expect(divisorSaturation(OUTGROWN, NOW, 64)).toBeNull();
});

// One freshly added feed means the measured rate is not yet a rate. "Not enough
// data" is not "fine", and neither is something a page can usefully print, so
// both read as nothing to report.
test('one immature source holds the whole check back', () => {
  const withNewFeed = [...OUTGROWN, ...feed('Freshly Added', 60, SOURCE_MATURITY_DAYS - 1)];

  expect(divisorSaturation(withNewFeed, NOW, 32)).toBeNull();
  // And it is the maturity gate doing it, not the arithmetic: a louder feed
  // would push the projection further past the ceiling, never back under it.
  expect(divisorSaturation(OUTGROWN, NOW, 32)).not.toBeNull();
});

// The false positive this codebase has already documented and rejected. Two of
// the five domains are correctly quiet at BASE because their beats publish at
// the rate they publish, not because their divisors are wrong (STU-1217,
// STU-1219).
test('a mature domain reading near BASE is not flagged', () => {
  const quiet = [...feed('Home Assistant', 2, 30), ...feed('SmartHomeScene', 1, 30)];

  expect(divisorSaturation(quiet, NOW, 4)).toBeNull();
});

test('a domain with no scored history at all is not flagged', () => {
  expect(divisorSaturation([], NOW, 32)).toBeNull();
});

// A source whose every row landed today has no window to measure, so it is
// invisible rather than immature — and invisible is the safe direction: it
// contributes no score either, so it can only make the check quieter.
test('a source that has published nothing yet neither flags nor blocks', () => {
  const todayOnly: Sourced[] = [{ source: 'Freshly Added', score: 99, published_at: day(0) }];

  expect(sourceRates(todayOnly, NOW)).toHaveLength(0);
  expect(divisorSaturation([...OUTGROWN, ...todayOnly], NOW, 32)).not.toBeNull();
  expect(divisorSaturation([...OUTGROWN, ...todayOnly], NOW, 64)).toBeNull();
});

// The bar is the headroom, not a percentage of the gauge: the trip point is
// wherever a week `SATURATION_MULTIPLE` times an ordinary one stops fitting.
test('the flag turns on exactly where a busier week stops fitting on the gauge', () => {
  const rows = feed('One Feed', 50, 20);
  const steady = steadySignal(50);

  // The divisor at which a 1.5x week lands exactly on 100.
  const edge = (SATURATION_MULTIPLE * steady) / (100 - BASE);

  expect(divisorSaturation(rows, NOW, edge * 0.99)).not.toBeNull();
  expect(divisorSaturation(rows, NOW, edge * 1.01)).toBeNull();
});

test('each source is rated over its own window, and today is left out of it', () => {
  const rows = [
    ...feed('Slow', 10, 20),
    ...feed('Fast', 10, 4),
    { source: 'Fast', score: 999, published_at: day(0) },
  ];

  const rates = sourceRates(rows, NOW);

  expect(rates.map((r) => r.source)).toEqual(['Fast', 'Slow']);
  // Four days of rows, not five: today's 999 is in neither the score nor the
  // window. A partial day counted whole drags every rate down.
  expect(rates[0]).toMatchObject({ articles: 4, score: 40, windowDays: 4, mature: false });
  expect(rates[1]).toMatchObject({ articles: 20, score: 200, windowDays: 20, mature: true });
});
