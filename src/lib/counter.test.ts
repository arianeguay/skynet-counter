import { expect, test } from 'bun:test';
import {
  BASE,
  HALF_LIFE_DAYS,
  HORIZON_DAYS,
  counterFrom,
  decayedSignal,
  normalizedSignal,
  statusLine,
  steadySignal,
  type Sourced,
} from '@/lib/counter';
import { cybersecurite } from '@/lib/domains/cybersecurite';

// The divisor is a domain's, not the formula's. These cases were written against
// the cybersecurity feed set and its measured rate, so they keep reading its own.
const DIVISOR = cybersecurite.divisor;
const counterAt = (signal: number) => counterFrom(signal, BASE, DIVISOR);

const NOW = Date.parse('2026-09-01T00:00:00.000Z');
const agedDays = (days: number, score: number) => ({
  score,
  published_at: new Date(NOW - days * 864e5).toISOString(),
});

test('an article published now contributes its whole score', () => {
  expect(decayedSignal([agedDays(0, 20)], NOW)).toBeCloseTo(20, 6);
});

// The constant is named for a half-life, so one half-life old must be half.
// `Math.exp(-age / 7)` — what this used to be — gives 0.368 here, not 0.5.
test('an article one half-life old contributes half its score', () => {
  expect(decayedSignal([agedDays(HALF_LIFE_DAYS, 20)], NOW)).toBeCloseTo(10, 6);
});

test('an article two half-lives old contributes a quarter', () => {
  expect(decayedSignal([agedDays(2 * HALF_LIFE_DAYS, 20)], NOW)).toBeCloseTo(5, 6);
});

// A feed's clock can run ahead of ours; a future article must not be worth more
// than a fresh one.
test('an article dated in the future is clamped to its full score, not amplified', () => {
  expect(decayedSignal([agedDays(-30, 20)], NOW)).toBeCloseTo(20, 6);
});

test('the half-life is a parameter, so the harness can sweep it', () => {
  expect(decayedSignal([agedDays(3, 20)], NOW, 3)).toBeCloseTo(10, 6);
});

test('an empty history leaves the counter at BASE', () => {
  expect(counterAt(decayedSignal([], NOW))).toBe(BASE);
});

test('the counter is BASE plus the signal over DIVISOR, to one decimal', () => {
  expect(counterAt(80)).toBe(BASE + 80 / DIVISOR);
  expect(counterAt(5)).toBe(12.2);
});

// Enough simultaneous risk must peg the gauge rather than run off the end of it.
test('the counter saturates at 100', () => {
  expect(counterAt(100_000)).toBe(100);
});

// The measured rate the constants were calibrated against on 2026-09-01: the
// five feeds publish this much score a day between them.
const MEASURED_DAILY_SCORE = 97.2;

test('a steady feed settles at its daily score times the area under the decay', () => {
  // Articles arrive through the day, so the closed form integrates the decay
  // rather than stacking each day's output at midnight — checked hourly.
  const steps = HORIZON_DAYS * 24;
  let area = 0;
  for (let i = 0; i < steps; i++) area += (100 / 24) * 0.5 ** (i / 24 / HALF_LIFE_DAYS);
  expect(steadySignal(100)).toBeCloseTo(area, -1);
});

// DIVISOR exists to make the gauge usable across the range the feeds actually
// produce. These are the four points it was picked on (STU-1171); a smaller one
// pegs the gauge on an ordinary week and it never comes back down.
test('the calibrated divisor keeps silence, an ordinary week and a crisis on the gauge', () => {
  const steady = steadySignal(MEASURED_DAILY_SCORE);
  expect(counterAt(0)).toBe(BASE);
  expect(counterAt(0.4 * steady)).toBeLessThan(30);
  expect(counterAt(steady)).toBeGreaterThan(35);
  expect(counterAt(steady)).toBeLessThan(55);
  expect(counterAt(3 * steady)).toBeLessThan(100);
});

// `days` of history at MEASURED_DAILY_SCORE points a day, arriving hourly and
// split across two sources. The oldest row lands exactly `days` back, so the
// observation window the normalisation reads is the depth being tested.
const corpusOf = (days: number, dailyScore = MEASURED_DAILY_SCORE): Sourced[] => {
  const rows: Sourced[] = [];
  const perArticle = dailyScore / 24 / 2;
  for (let hour = 0; hour < days * 24; hour++) {
    for (const source of ['fast feed', 'slow feed']) {
      rows.push({ score: perArticle, source, published_at: new Date(NOW - (hour + 1) * 36e5).toISOString() });
    }
  }
  return rows;
};

const counterOf = (rows: Sourced[]) => counterAt(normalizedSignal(rows, NOW));

// The bug: the raw sum reads "how many days of history do we hold", not "how
// much risk is there". A database seeded yesterday published 26 against a
// steady state of 41 for the three weeks it took to fill (STU-1222).
test('a young corpus and a full one read the same on the same daily rate', () => {
  const [day, week, full] = [counterOf(corpusOf(1)), counterOf(corpusOf(7)), counterOf(corpusOf(30))];
  expect(Math.abs(day - full)).toBeLessThan(1);
  expect(Math.abs(week - full)).toBeLessThan(1);
});

// The regression this replaces, kept as the contrast: on the raw sum the same
// two depths are more than ten points apart on the gauge, all of it history.
test('the raw sum is what made corpus depth look like risk', () => {
  const raw = (days: number) => counterAt(decayedSignal(corpusOf(days), NOW));
  expect(raw(30) - raw(1)).toBeGreaterThan(10);
});

// Normalisation scales, so it cannot manufacture signal out of silence.
test('a full horizon of zero-scoring articles still reads BASE', () => {
  expect(counterOf(corpusOf(30, 0))).toBe(BASE);
});

// A source seen for one hour is not a rate. Without the floor its window covers
// almost none of the horizon's weight, and dividing by that scales one article
// into a crisis.
test('a source observed for under a day is not extrapolated from its first hour', () => {
  const oneArticle: Sourced[] = [
    { score: 45, source: 'brand new feed', published_at: new Date(NOW - 36e5).toISOString() },
  ];
  expect(normalizedSignal(oneArticle, NOW)).toBeLessThan(11 * 45);
});

// A half-life close to the horizon turns HORIZON_DAYS into a second decay
// constant: the cutoff, not the half-life, decides what an article is worth.
test('the horizon clips less than a tenth of the decay weight', () => {
  expect(0.5 ** (HORIZON_DAYS / HALF_LIFE_DAYS)).toBeLessThan(0.1);
});

// Each band is inclusive at its lower edge, and the floor the counter returns to
// after silence — BASE, 12 — has to land in NOMINAL rather than one band up.
test('the bands are inclusive at their lower edge', () => {
  expect(statusLine(0)).toBe('NOMINAL');
  expect(statusLine(BASE)).toBe('NOMINAL');
  expect(statusLine(17.9)).toBe('NOMINAL');
  expect(statusLine(18)).toBe('BACKGROUND CHATTER');
  expect(statusLine(34.9)).toBe('BACKGROUND CHATTER');
  expect(statusLine(35)).toBe('ELEVATED ACTIVITY');
  expect(statusLine(59.9)).toBe('ELEVATED ACTIVITY');
  expect(statusLine(60)).toBe('CONTAINMENT DEGRADED');
  expect(statusLine(100)).toBe('CONTAINMENT DEGRADED');
});
