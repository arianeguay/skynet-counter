// Replays the stored article history through the counter formula so BASE,
// HALF_LIFE_DAYS and DIVISOR can be chosen from measured data instead of a live
// sweep per question. Read-only: it never scores, never writes (STU-1171).
import { Database } from 'bun:sqlite';
import { BASE, DIVISOR, HALF_LIFE_DAYS, HORIZON_DAYS, counterFrom, decayedSignal, steadySignal } from '@/lib/counter';

const HALF_LIVES = [3, 5, 7, 10, 14];
const DIVISORS = [8, 12, 16, 24, 32, 40];

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
console.log(`top scores ${scores.slice(0, 10).join(' ')}`);
console.log(`\nlive constants: BASE=${BASE} HALF_LIFE_DAYS=${HALF_LIFE_DAYS} DIVISOR=${DIVISOR}\n`);

// Each feed is measured over its own RSS window, not over the corpus span. The
// windows are wildly different — Krebs reaches back two months, hnrss two days
// — so a corpus-wide articles/day divides every feed's output by the longest
// window and lands 3x low.
const today = new Date(now).toISOString().slice(0, 10);
const feeds = db
  .query<{ source: string; n: number; sum: number; oldest: string }, [string]>(
    `SELECT source, COUNT(*) n, SUM(score) sum, MIN(published_at) oldest FROM articles
     WHERE score IS NOT NULL AND substr(published_at, 1, 10) < ? GROUP BY source ORDER BY source`
  )
  .all(today);

console.log('per-feed rate over its own RSS window (today excluded, it is still filling):');
let dailyScore = 0;
let dailyArticles = 0;
for (const f of feeds) {
  const days = Math.max(1, (Date.parse(today) - Date.parse(f.oldest)) / 864e5);
  dailyScore += f.sum / days;
  dailyArticles += f.n / days;
  console.log(
    `  ${f.source.padEnd(24)} ${String(f.n).padStart(3)} articles over ${days.toFixed(1).padStart(5)}d` +
      ` -> ${(f.n / days).toFixed(2).padStart(5)} art/day, ${(f.sum / days).toFixed(1).padStart(5)} score/day`
  );
}
console.log(`  ${'TOTAL'.padEnd(24)} ${dailyArticles.toFixed(1)} articles/day, ${dailyScore.toFixed(1)} score/day`);

// The corpus grid says what the site publishes today; the steady-state grid says
// what it publishes once every day inside the horizon is populated. They differ
// by ~2x on a corpus assembled from RSS windows, and the second one is the one
// DIVISOR has to suit.
const grid = (label: string, signalFor: (h: number) => number) => {
  console.log(`\n${label} (BASE=${BASE}), by half-life (rows) and divisor (columns):`);
  console.log(['  half-life', ...DIVISORS.map((d) => `/${d}`.padStart(7))].join(''));
  for (const h of HALF_LIVES) {
    const signal = signalFor(h);
    const cells = DIVISORS.map((d) => counterFrom(signal, BASE, d).toFixed(1).padStart(7));
    const lost = 0.5 ** (HORIZON_DAYS / h);
    console.log([`  ${String(h).padStart(2)}d      `, ...cells, `   (${(100 * lost).toFixed(0)}% clipped)`].join(''));
  }
};

grid('counter on the stored corpus', (h) => decayedSignal(rows, now, h));
grid('counter projected to steady state', (h) => steadySignal(dailyScore, h));

// A divisor is only defensible if the whole range fits: silence reads the floor,
// an ordinary week reads mid-gauge, and a tripled week still has somewhere to go.
const steady = steadySignal(dailyScore);
console.log(`\nheadroom at HALF_LIFE_DAYS=${HALF_LIFE_DAYS} (steady signal ${steady.toFixed(0)}):`);
console.log(['  divisor', 'silent', 'quiet', 'ordinary', 'busy 2x', 'crisis 3x'].map((h) => h.padStart(10)).join(''));
for (const d of DIVISORS) {
  const cells = [0, 0.4, 1, 2, 3].map((m) => counterFrom(m * steady, BASE, d).toFixed(1).padStart(10));
  console.log([`  /${d}`.padEnd(9), ...cells].join(''));
}
db.close();
