import { BASE, HALF_LIFE_DAYS, HEADROOM_KNEE, HORIZON_DAYS, counterFrom, steadySignal, type Sourced } from './counter';

// A divisor is picked by hand, once, from a feed set's measured score per day —
// and nothing re-checks it when that feed set changes. Adding a feed moves the
// real rate (STU-1171's failure with the sign flipped), and the only thing that
// has ever caught it is somebody noticing the published gauge looks wrong: on
// 2026-09-11 three newsrooms went into `cybersecurite` against a divisor
// calibrated on the three before them, and the live site read 94.6 within a day.
//
// This is that check, as a pure function over rows the page already reads
// (STU-1401). It recomputes on read rather than storing a verdict, for the reason
// `counterHistory` recomputes instead of snapshotting a daily number: the answer
// is a function of rows already in the table, so a divisor edited today corrects
// the reading immediately instead of a day later.
//
// A calendar recheck would be the wrong shape. Re-running `calibrate` weekly
// conflates "the feed set changed" with "the news got louder", and only the first
// should ever move a divisor.

// How much of a source's own publishing a rate has to be measured over before it
// is worth extrapolating. It is the bar the input files already use in prose:
// `cybersecurite.input.yaml` says to re-calibrate "once a couple of weeks of rows
// have accumulated", and `cybersecurite.ts` names Dark Reading's 13.2-day window
// as the depth the two feeds beside it have to reach.
export const SOURCE_MATURITY_DAYS = 14;

// The two checkpoints this asks the gauge to keep apart — the same "busy 2x" /
// "crisis 3x" columns `calibrate`'s own headroom table already prints, reused
// here so the check answers the same question in the same units the page's own
// diagnostic script does.
export const BUSY_MULTIPLE = 2;
export const CRISIS_MULTIPLE = 3;

// How many gauge points must still separate a busy week's reading from a
// crisis week's. Before STU-1270's soft knee this check compared an unclamped
// straight line to the literal ceiling of 100 — a hard wall the formula no
// longer has above `HEADROOM_KNEE`, where it asymptotes instead. `crisis -
// busy` is what "still has somewhere to go" means against a curve that never
// quite reaches 100: shrinking toward zero is the flattening, whatever the
// absolute reading sits at.
//
// Measured against the two real cases already in this file's tests: the
// outgrown cybersecurite/32 set (the actual STU-1401 incident) separates busy
// from crisis by 5.0 points once re-derived against the soft knee; the /64
// divisor it was bumped to separates them by 13.3. 8 sits in the gap between
// the two and reproduces both verdicts unchanged.
export const MIN_HEADROOM = 8;

// One source's measured output over its own RSS window, the way `calibrate.ts`
// groups it: each feed's window covers a different slice of the horizon — two
// days for hnrss, two months for Krebs — so a corpus-wide articles/day divides
// every feed by the longest window and lands 3x low (STU-1171).
export interface SourceRate {
  source: string;
  articles: number;
  score: number;
  windowDays: number;
  mature: boolean;
}

// Measured on `published_at`, and that is not the trap STU-1283 names. The
// question there was "how long has this pipeline been watching", which a first
// sweep's backlog can antedate, so `readBalance` asks `scored_at` instead. The
// question here is "how deep is the sample this rate was divided by", and the
// rows' own publication span *is* that sample — a feed that arrives carrying two
// months of its own window arrives with a real rate, which is the whole reason
// `calibrate` measures per feed rather than per corpus.
//
// Today is excluded, as it is there: it is still filling, and a partial day
// counted as a whole one drags every rate down.
export function sourceRates(rows: Sourced[], now: number): SourceRate[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const byFeed = new Map<string, { articles: number; score: number; oldest: string }>();
  for (const row of rows) {
    if (row.published_at.slice(0, 10) >= today) continue;
    const feed = byFeed.get(row.source);
    if (feed) {
      feed.articles += 1;
      feed.score += row.score;
      if (row.published_at < feed.oldest) feed.oldest = row.published_at;
    } else {
      byFeed.set(row.source, { articles: 1, score: row.score, oldest: row.published_at });
    }
  }

  return [...byFeed]
    .map(([source, feed]) => {
      const windowDays = Math.max(1, (Date.parse(today) - Date.parse(feed.oldest)) / 864e5);
      return {
        source,
        articles: feed.articles,
        score: feed.score,
        windowDays,
        mature: windowDays >= SOURCE_MATURITY_DAYS,
      };
    })
    .sort((a, b) => a.source.localeCompare(b.source));
}

export interface DivisorSaturation {
  divisor: number;
  // Points of score a day, summed over each source's own window.
  dailyScore: number;
  // What that rate settles at once every day inside the horizon is populated.
  steady: number;
  // What a busy (BUSY_MULTIPLE×) and a crisis (CRISIS_MULTIPLE×) week actually
  // read through the real, soft-knee formula — not the unclamped straight line
  // the old check compared to 100. A flag exists precisely because these two
  // have collapsed together.
  busy: number;
  crisis: number;
  sources: number;
}

// The one miscalibration this project has actually hit, twice: a divisor too
// small for the feed set it is dividing, so an ordinary week pegs the gauge and
// nothing louder can read any differently.
//
// It deliberately does not flag the mirror case. A mature domain sitting near
// BASE is the correct reading for `frontend` and `smarthome` today — their beats
// publish at the rate they publish — and calling that miscalibration is the false
// positive this codebase has already documented and rejected (STU-1217,
// STU-1219).
//
// `null` means nothing to report, and that covers "not enough data" as well as
// "fine": one immature source means the measured rate is not yet a rate, which is
// not the same as the divisor being right, and a page cannot usefully say so. A
// source that has published nothing at all is invisible here rather than
// immature — it contributes no score either, so its absence can only make this
// check quieter, never louder.
export function divisorSaturation(
  rows: Sourced[],
  now: number,
  divisor: number,
  base = BASE,
  halfLifeDays = HALF_LIFE_DAYS,
  horizonDays = HORIZON_DAYS
): DivisorSaturation | null {
  const rates = sourceRates(rows, now);
  if (rates.length === 0 || rates.some((r) => !r.mature)) return null;

  const dailyScore = rates.reduce((total, r) => total + r.score / r.windowDays, 0);
  const steady = steadySignal(dailyScore, halfLifeDays, horizonDays);
  const busy = counterFrom(BUSY_MULTIPLE * steady, base, divisor);
  const crisis = counterFrom(CRISIS_MULTIPLE * steady, base, divisor);

  // Below the knee both readings sit on the straight line by construction, and
  // their gap there tracks nothing but how quiet the domain is — a mature but
  // quiet domain (STU-1217, STU-1219) can land under MIN_HEADROOM on a small
  // divisor with plenty of ceiling left. Gating on `busy` already having
  // crossed into the compressed range is what keeps that domain unflagged.
  if (busy <= HEADROOM_KNEE) return null;
  if (crisis - busy >= MIN_HEADROOM) return null;

  return { divisor, dailyScore, steady, busy, crisis, sources: rates.length };
}
