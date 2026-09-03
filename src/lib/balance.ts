import type { Polarity } from './counter';

// Below this many counter points of day-to-day spread, movement is noise, and
// dividing by it would turn a domain that has barely moved into a wild reading
// off the smallest wobble.
const MIN_SPREAD = 0.5;

// Two standard deviations already covers a domain having a distinctly unusual
// day. Past that, one domain must not be able to swing the shared line further
// just by having a louder week than everyone else.
const CLAMP_STD_DEVS = 2;

// How far today's counter sits from a domain's own recent normal, in units of
// that domain's own day-to-day movement — never in counter points, which the
// divisor would let one domain inflate relative to another (STU-1280).
//
// Scale-invariant by construction: `counterHistory` is `BASE + signal/divisor`,
// so multiplying every point by a constant — what a smaller divisor does —
// scales both the mean-deviation and the spread by that same constant, and it
// cancels out of the ratio exactly. A domain reading loud only because its
// divisor is small does not read as more deviant than a quiet one having an
// equally unusual day.
export function normalizedDeviation(history: number[]): number {
  if (history.length === 0) return 0;
  const now = history.at(-1)!;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
  const spread = Math.max(Math.sqrt(variance), MIN_SPREAD);
  const z = (now - mean) / spread;
  return Math.max(-1, Math.min(1, z / CLAMP_STD_DEVS));
}

export interface DomainDeviation {
  slug: string;
  polarity: Polarity;
  deviation: number;
}

// -1 (the progress side is clearly ahead of its own normal) to +1 (the risk
// side is). `null` — not 0 — when either side has no domain to average, because
// there is nothing to balance a reading against; 0 means "evenly matched",
// which is a claim about data this state does not have.
export function balanceOf(deviations: DomainDeviation[]): number | null {
  const risk = deviations.filter((d) => d.polarity === 'risk').map((d) => d.deviation);
  const progress = deviations.filter((d) => d.polarity === 'progress').map((d) => d.deviation);
  if (risk.length === 0 || progress.length === 0) return null;
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return avg(risk) - avg(progress);
}

// Below this a lean is noise from `balanceOf`'s own averaging, not a claim the
// bar should stand behind. Half of `MIN_SPREAD`-scale movement, chosen to be
// small enough that a genuine one-sided week still clears it.
const EVEN_THRESHOLD = 0.1;

// The verdict line under the balance bar. `null` alongside `balanceOf`'s own
// `null` — with no side to compare, there is no side to call ahead.
export function balanceVerdict(balance: number | null): string | null {
  if (balance === null) return null;
  if (Math.abs(balance) < EVEN_THRESHOLD) return 'EVENLY MATCHED';
  return balance > 0 ? 'THE DARK SIDE IS AHEAD' : 'THE LIGHT SIDE IS AHEAD';
}
