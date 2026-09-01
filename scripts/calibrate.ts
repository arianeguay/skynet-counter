// Replays the stored article history through the counter formula so BASE,
// HALF_LIFE_DAYS and DIVISOR can be chosen from measured data instead of a live
// sweep per question. Read-only: it never scores, never writes (STU-1171).
import { Database } from 'bun:sqlite';
import { BASE, DIVISOR, HALF_LIFE_DAYS, HORIZON_DAYS, counterFrom, decayedSignal } from '@/lib/counter';

const HALF_LIVES = [3, 5, 7, 10, 14];
const DIVISORS = [2, 3, 4, 6, 8, 12];

const path = process.env.SKYNET_DB ?? 'data/skynet.db';
const db = new Database(path, { readonly: true });
const now = Date.now();
const horizon = new Date(now - HORIZON_DAYS * 864e5).toISOString();

const rows = db
  .query<{ score: number; published_at: string }, [string]>(
    'SELECT score, published_at FROM articles WHERE score IS NOT NULL AND published_at >= ?'
  )
  .all(horizon);

if (rows.length === 0) {
  console.log(`${path}: no scored article inside the ${HORIZON_DAYS}-day horizon — nothing to calibrate against.`);
  process.exit(1);
}

const scores = rows.map((r) => r.score).sort((a, b) => b - a);
const scoring = scores.filter((s) => s > 0);
const dates = rows.map((r) => r.published_at).sort();
const spanDays = Math.max(1, (Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / 864e5);

console.log(`corpus     ${path} — ${rows.length} scored articles inside the ${HORIZON_DAYS}-day horizon`);
console.log(`span       ${dates[0]!.slice(0, 10)} .. ${dates.at(-1)!.slice(0, 10)}  (${spanDays.toFixed(1)} days)`);
console.log(`scoring    ${scoring.length} above zero (${((100 * scoring.length) / rows.length).toFixed(0)}%), sum ${scores.reduce((t, s) => t + s, 0)}`);
console.log(`rate       ${(rows.length / spanDays).toFixed(1)} articles/day, ${(scoring.length / spanDays).toFixed(1)} of them scoring`);
console.log(`top scores ${scores.slice(0, 10).join(' ')}`);
console.log(`\nlive constants: BASE=${BASE} HALF_LIFE_DAYS=${HALF_LIFE_DAYS} DIVISOR=${DIVISOR}\n`);

// The corpus is fixed, so each cell is the counter this exact history would
// publish under those constants — the grid is what makes the pick arguable.
console.log(`counter at BASE=${BASE}, by half-life (rows) and divisor (columns):`);
console.log(['  half-life', ...DIVISORS.map((d) => `/${d}`.padStart(7))].join(''));
for (const h of HALF_LIVES) {
  const signal = decayedSignal(rows, now, h);
  const cells = DIVISORS.map((d) => counterFrom(signal, BASE, d).toFixed(1).padStart(7));
  console.log([`  ${String(h).padStart(2)}d      `, ...cells].join(''));
}
db.close();
