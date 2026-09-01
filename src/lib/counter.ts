export const BASE = 12;
export const HALF_LIFE_DAYS = 7;
export const DIVISOR = 8;
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
