import { expect, test } from 'bun:test';
import { balanceOf, balanceVerdict, normalizedDeviation, type DomainDeviation } from '@/lib/balance';

test('a domain sitting exactly at its own recent average deviates by nothing', () => {
  expect(normalizedDeviation([12, 12, 12, 12, 12])).toBe(0);
});

test('an empty history deviates by nothing rather than throwing', () => {
  expect(normalizedDeviation([])).toBe(0);
});

// The whole point: `counterHistory` is `BASE + signal/divisor`, and a smaller
// divisor is an affine transform of the same underlying trajectory — a scale
// and a shift. A z-score is invariant to both, so a domain reading loud purely
// because its divisor is small must land on the same deviation as a quiet
// domain having an equally unusual day (STU-1280).
test('scaling and shifting a history — what a different divisor does — leaves the deviation unchanged', () => {
  const base = [10, 11, 9, 10, 12, 30]; // an unusual last day against a quiet run
  const original = normalizedDeviation(base);
  for (const [scale, shift] of [
    [3, 0],
    [0.2, 0],
    [1, 40],
    [5, -20],
  ] as const) {
    const transformed = base.map((v) => shift + scale * v);
    expect(normalizedDeviation(transformed)).toBeCloseTo(original, 6);
  }
});

test('a day distinctly above the recent run deviates positive, and the reverse deviates negative', () => {
  expect(normalizedDeviation([10, 10, 10, 10, 30])).toBeGreaterThan(0);
  expect(normalizedDeviation([30, 30, 30, 30, 10])).toBeLessThan(0);
});

// A domain that has barely moved must not read as wildly deviant off a single
// point of noise — the spread floor exists for exactly this history shape.
test('a domain with almost no day-to-day movement does not spike off one small wobble', () => {
  expect(normalizedDeviation([12, 12, 12, 12, 12.3])).toBeLessThan(1);
});

test('deviation is clamped to [-1, 1] however extreme the last day is', () => {
  expect(normalizedDeviation([10, 10, 10, 10, 10000])).toBe(1);
  expect(normalizedDeviation([10000, 10, 10, 10, 10])).toBeGreaterThanOrEqual(-1);
});

const dev = (slug: string, polarity: 'risk' | 'progress', deviation: number): DomainDeviation => ({
  slug,
  polarity,
  deviation,
});

// `null`, not 0 — a balance needs a domain on each side to mean anything, and
// zero would silently claim "evenly matched" about a state that has no such
// evidence. This is the case with no progress domains registered.
test('no progress domain registered means no balance to show', () => {
  expect(balanceOf([dev('cybersecurite', 'risk', 0.5)])).toBeNull();
});

test('no risk domain registered means no balance to show', () => {
  expect(balanceOf([dev('frontend', 'progress', 0.5)])).toBeNull();
});

test('an empty registry has no balance to show', () => {
  expect(balanceOf([])).toBeNull();
});

// Both sides reading equally unusual in the direction their own polarity wants
// is "evenly matched" — a risk domain having a loud week is bad, a progress
// domain having a loud week is good, and the two should cancel.
test('risk and progress equally elevated cancel to an even balance', () => {
  expect(balanceOf([dev('cybersecurite', 'risk', 0.6), dev('frontend', 'progress', 0.6)])).toBeCloseTo(0, 6);
});

// A quiet progress domain is bad news for that side too — it reads the same
// direction as a loud risk domain, not the opposite.
test('a risk domain up and a progress domain down both push the same way', () => {
  const balance = balanceOf([dev('cybersecurite', 'risk', 0.5), dev('frontend', 'progress', -0.5)]);
  expect(balance).toBeCloseTo(1, 6);
});

test('multiple domains per side average rather than sum', () => {
  const balance = balanceOf([
    dev('cybersecurite', 'risk', 1),
    dev('environment', 'risk', 0),
    dev('frontend', 'progress', 0),
  ]);
  expect(balance).toBeCloseTo(0.5, 6);
});

test('with no comparison to make, there is no verdict either', () => {
  expect(balanceVerdict(null)).toBeNull();
});

test('a small lean either way reads as evenly matched, not a side pulling ahead', () => {
  expect(balanceVerdict(0.05)).toBe('EVENLY MATCHED');
  expect(balanceVerdict(-0.05)).toBe('EVENLY MATCHED');
  expect(balanceVerdict(0)).toBe('EVENLY MATCHED');
});

test('a clear risk-side lean names the dark side, a clear progress-side lean the light side', () => {
  expect(balanceVerdict(0.5)).toBe('THE DARK SIDE IS AHEAD');
  expect(balanceVerdict(-0.5)).toBe('THE LIGHT SIDE IS AHEAD');
});
