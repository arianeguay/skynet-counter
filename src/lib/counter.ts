export const BASE = 12;
export const HALF_LIFE_DAYS = 7;
// Calibrated 2026-09-01 by `bun run calibrate` against the live corpus, whose
// five feeds publish 97 points of score a day between them. At a 7-day
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

export function counterFrom(signal: number, base = BASE, divisor = DIVISOR): number {
  return Math.round(Math.min(100, Math.max(0, base + signal / divisor)) * 10) / 10;
}

// What a feed publishing `dailyScore` points a day settles at, once every day
// inside the horizon is populated. A corpus assembled from RSS windows is
// half-empty for weeks, so this — not the stored history — is what DIVISOR has
// to suit.
export function steadySignal(dailyScore: number, halfLifeDays = HALF_LIFE_DAYS, horizonDays = HORIZON_DAYS): number {
  return dailyScore * (halfLifeDays / Math.LN2) * (1 - 0.5 ** (horizonDays / halfLifeDays));
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
