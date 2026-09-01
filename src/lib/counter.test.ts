import { expect, test } from 'bun:test';
import { BASE, DIVISOR, HALF_LIFE_DAYS, counterFrom, decayedSignal } from '@/lib/counter';

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
  expect(counterFrom(5)).toBe(12.6);
});

// Enough simultaneous risk must peg the gauge rather than run off the end of it.
test('the counter saturates at 100', () => {
  expect(counterFrom(100_000)).toBe(100);
});
