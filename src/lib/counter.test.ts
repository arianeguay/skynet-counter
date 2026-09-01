import { expect, test } from 'bun:test';
import { BASE, DIVISOR, HALF_LIFE_DAYS, HORIZON_DAYS, counterFrom, decayedSignal, steadySignal } from '@/lib/counter';

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
  expect(counterFrom(decayedSignal([], NOW))).toBe(BASE);
});

test('the counter is BASE plus the signal over DIVISOR, to one decimal', () => {
  expect(counterFrom(80)).toBe(BASE + 80 / DIVISOR);
  expect(counterFrom(5)).toBe(12.2);
});

// Enough simultaneous risk must peg the gauge rather than run off the end of it.
test('the counter saturates at 100', () => {
  expect(counterFrom(100_000)).toBe(100);
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
  expect(counterFrom(0)).toBe(BASE);
  expect(counterFrom(0.4 * steady)).toBeLessThan(30);
  expect(counterFrom(steady)).toBeGreaterThan(35);
  expect(counterFrom(steady)).toBeLessThan(55);
  expect(counterFrom(3 * steady)).toBeLessThan(100);
});

// A half-life close to the horizon turns HORIZON_DAYS into a second decay
// constant: the cutoff, not the half-life, decides what an article is worth.
test('the horizon clips less than a tenth of the decay weight', () => {
  expect(0.5 ** (HORIZON_DAYS / HALF_LIFE_DAYS)).toBeLessThan(0.1);
});
