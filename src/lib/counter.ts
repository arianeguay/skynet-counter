export const BASE = 12;
export const HALF_LIFE_DAYS = 7;
// Calibrated 2026-09-01 by `bun run calibrate` against the live corpus, whose
// feeds publish 97 points of score a day between them. At a 7-day
// half-life that settles at a steady signal of ~930, so /32 reads 41 on an
// ordinary week, 70 on a doubled one, and still stops short of 100 on a tripled
// one. The previous /8 was guessed while every article scored 0; it pegs the
// gauge at 100 on an ordinary week and never comes back down (STU-1171).
export const DIVISOR = 32;
// Must stay well above HALF_LIFE_DAYS or it becomes a second decay constant:
// at 30 days a 7-day half-life loses 5% of its weight to the cutoff, a 14-day
// one loses 23%.
export const HORIZON_DAYS = 30;

export interface Decayable {
  score: number;
  published_at: string;
}

export interface Sourced extends Decayable {
  source: string;
}

// A source observed for less than this is not extrapolated as though its first
// hour were a rate: the scale-up below divides by the weight the window covers,
// which approaches zero as the window does.
const MIN_COVERAGE_DAYS = 1;

// `0.5 ** (age / HALF_LIFE_DAYS)`, not `Math.exp(-age / HALF_LIFE_DAYS)`: the
// latter is an e-folding time and halves at 4.85 days, so the constant decayed
// risk 44% faster than its own name promised (STU-1211).
export function decayedSignal(rows: Decayable[], now: number, halfLifeDays = HALF_LIFE_DAYS): number {
  let signal = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (now - Date.parse(row.published_at)) / 864e5);
    signal += row.score * 0.5 ** (ageDays / halfLifeDays);
  }
  return signal;
}

// The share of a full horizon's decay weight that a window of `days` carries.
function coveredWeight(days: number, halfLifeDays: number): number {
  return 1 - 0.5 ** (days / halfLifeDays);
}

// A corpus assembled from RSS windows is sparse, not short. The windows run from
// two days (hnrss) to two months (Krebs), so the span reaches back nearly the
// whole horizon while most days inside it hold only the slow feeds' tail —
// scaling by the corpus span corrects 28.9 to 29.3 where the steady state is
// 42.8. The missing weight is per source, so the correction is too: each source
// is scaled by the fraction of the horizon its own window covers, which is what
// makes a three-day-old database and a three-month-old one read the same on the
// same daily rate (STU-1222).
//
// It scales, so it cannot invent signal: a populated horizon whose articles all
// score 0 still sums to 0 and still reads BASE.
export function normalizedSignal(
  rows: Sourced[],
  now: number,
  halfLifeDays = HALF_LIFE_DAYS,
  horizonDays = HORIZON_DAYS
): number {
  const bySource = new Map<string, Sourced[]>();
  for (const row of rows) {
    const group = bySource.get(row.source);
    if (group) group.push(row);
    else bySource.set(row.source, [row]);
  }

  const full = coveredWeight(horizonDays, halfLifeDays);
  let signal = 0;
  for (const group of bySource.values()) {
    const oldest = Math.min(...group.map((r) => Date.parse(r.published_at)));
    const observed = Math.min(horizonDays, Math.max(MIN_COVERAGE_DAYS, (now - oldest) / 864e5));
    signal += decayedSignal(group, now, halfLifeDays) * (full / coveredWeight(observed, halfLifeDays));
  }
  return signal;
}

export function counterFrom(signal: number, base = BASE, divisor = DIVISOR): number {
  return Math.round(Math.min(100, Math.max(0, base + signal / divisor)) * 10) / 10;
}

// What a feed publishing `dailyScore` points a day settles at, once every day
// inside the horizon is populated. A corpus assembled from RSS windows is
// half-empty for weeks, so this — not the stored history — is what DIVISOR has
// to suit.
export function steadySignal(dailyScore: number, halfLifeDays = HALF_LIFE_DAYS, horizonDays = HORIZON_DAYS): number {
  return dailyScore * (halfLifeDays / Math.LN2) * coveredWeight(horizonDays, halfLifeDays);
}

// The counter's four bands, as the site prints them. This lives here rather
// than in `CounterHero` because that component is `'use client'`: the summary
// route the desktop widget polls has to reach the thresholds from the server,
// and a widget that carried its own copy would drift the moment a band moved.
export function statusLine(counter: number): string {
  if (counter >= 60) return 'CONTAINMENT DEGRADED';
  if (counter >= 35) return 'ELEVATED ACTIVITY';
  if (counter >= 18) return 'BACKGROUND CHATTER';
  return 'NOMINAL';
}
