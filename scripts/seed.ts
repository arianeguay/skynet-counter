// Writes a throwaway database holding one chosen page state, so a layout can be
// looked at before it ships. `/// FEED FAULT` shipped without anyone seeing it:
// the tests assert substrings of `renderToStaticMarkup` output, which proves the
// logic and nothing about the amber-on-panel contrast or how the row wraps on a
// phone, and the panel only draws when a source has been failing for over a day
// (STU-1208).
//
// It never scores and never fetches: every row is synthesised from the domain's
// own keyword table, so a fixture stays in step with a table that changes and a
// domain added later needs nothing here. The counter is then computed from those
// rows through the same call `aggregate` makes, so the gauge and the log the page
// draws are one state rather than two.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AIID_HOLDBACK_DAYS } from '@/lib/aiid';
import {
  BASE,
  HALF_LIFE_DAYS,
  HORIZON_DAYS,
  counterFrom,
  normalizedSignal,
  signalFor,
  statusLine,
  steadySignal,
} from '@/lib/counter';
import { TREND_WINDOW_DAYS, dbPath, openDb, scoredHistory } from '@/lib/db';
import { DOMAINS, currentDomain, type Domain } from '@/lib/domains';
import { MAX_SCORE, scoreFor } from '@/lib/keywords';

interface Scenario {
  // One line, printed by the usage list. What you would be looking at the page for.
  what: string;
  // Roughly where the counter should settle. A keyword table is lumpy and a
  // greedy pick lands under its target, so a scenario names a band rather than a
  // number — the number it actually produced is printed at the end of the run.
  // Absent means no articles at all: the empty state.
  target?: number;
  feeds?: 'healthy' | 'dead' | 'flapping' | 'outage';
  // Seed every domain in the registry, not just this one. The balance band reads
  // the whole registry and renders nothing with one side unpopulated, so it is
  // the one page state a single domain cannot produce.
  everyDomain?: boolean;
  // Multiply the last two days' scores for the domain being run, so its own
  // trajectory reads as an unusual week rather than a flat line.
  bump?: number;
  // Seeds `aiid_incidents` instead of any domain's articles: the AIID trend
  // page is not a gauge and has nothing to do with `target`/`feeds`/`bump`.
  aiid?: boolean;
}

const SCENARIOS: Record<string, Scenario> = {
  nominal: {
    what: 'an ordinary week — every feed answering, the counter mid-gauge',
    target: 41,
    feeds: 'healthy',
  },
  quiet: {
    what: 'a week nobody wrote about — the counter in its bottom band',
    target: 14,
    feeds: 'healthy',
  },
  critical: {
    what: 'the top band, a log that is almost all CRIT, and DIVISOR SATURATED with it',
    target: 88,
    feeds: 'healthy',
  },
  'dead-feed': {
    what: 'one source down 30 hours — /// FEED FAULT, past its day of grace',
    target: 41,
    feeds: 'dead',
  },
  flapping: {
    what: 'one source failing two sweeps in three but answering right now — FLAPPING',
    target: 41,
    feeds: 'flapping',
  },
  'host-outage': {
    what: 'every feed failing together — /// HOST FAULT, and no publisher named for it',
    target: 41,
    feeds: 'outage',
  },
  balance: {
    what: 'every domain old enough to compare, this one having an unusual week — the balance band',
    target: 41,
    feeds: 'healthy',
    everyDomain: true,
    bump: 3,
  },
  empty: {
    what: 'the schema and nothing else — the log’s empty state, a gauge at zero',
  },
  aiid: {
    what: 'a rising multi-year trend on the AIID page, with recent months held back',
    aiid: true,
  },
};

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

// The one thing this script must never do. `data/skynet.db` is the checkout's
// own history and `/data` is the volume behind the live counter on apollon —
// both hold scored rows that exist nowhere else, since the file is gitignored
// and never backed up. Refusing an unset `SKYNET_DB` is the same guard: the
// default path *is* the live one.
function seedPath(): string {
  if (!process.env.SKYNET_DB) {
    die(
      'seed: SKYNET_DB is unset, so this would write the checkout’s own data/skynet.db.\n' +
        '      Point it somewhere throwaway:  SKYNET_DB=/tmp/skynet-seed.db bun run seed <scenario>'
    );
  }
  const path = resolve(dbPath());
  if (path === resolve('data/skynet.db') || path.startsWith('/data/')) {
    die(`seed: refusing to write ${path} — that is a live counter's history, not a fixture.`);
  }
  return path;
}

// The feed names come out of the domain's input file rather than a list here,
// for the reason CLAUDE.md gives for the fetch stage reading it: a domain's feed
// table lives in exactly one place, and a fixture naming a source the domain
// does not have would put a fictional publisher on the fault panel. Two flat
// keys is not enough YAML to take a dependency for.
function feedsOf(domain: Domain): string[] {
  const path = `.studio/inputs/${domain.slug}.input.yaml`;
  const sources = [...readFileSync(path, 'utf8').matchAll(/^\s*-\s*source:\s*(.+?)\s*$/gm)].map((m) =>
    m[1]!.replace(/^['"]|['"]$/g, '')
  );
  if (sources.length === 0) die(`seed: ${path} lists no feeds.`);
  return sources;
}

// Far enough back that every read on the page has its full input: the trend
// sparkline asks for TREND_WINDOW_DAYS of counter history and each of those days
// needs a whole horizon behind it, which is also more than the balance band's
// maturity gate wants. Seeding less produces the artifact STU-1283 found on the
// live site — a flat run of BASE that nothing swept, read as a wild swing.
const SPAN_DAYS = TREND_WINDOW_DAYS + HORIZON_DAYS;
// The floor, not the count: a busy week publishes more articles rather than
// bigger ones, and no article can score past its domain's whole table anyway.
const PER_DAY = 3;
// How far the daily budget swings around the target, and how fast. A flat
// trajectory draws a flat sparkline and a deviation of exactly zero, neither of
// which is a state worth looking at.
const WAVE = 0.35;
const WAVE_PERIOD_DAYS = 3.3;
const BUMP_DAYS = 2;

// The wave, flattened to a decay-weighted mean of exactly 1. Without this the
// counter misses the target the scenario asked for by however much of the wave's
// crest happens to land on the recent days — and those days are the ones the
// half-life weights, so a 35% swing put `critical` 9 points over its own target.
const waveAt = (() => {
  let weighted = 0;
  let weight = 0;
  for (let d = 0; d <= SPAN_DAYS; d++) {
    const w = 0.5 ** (d / HALF_LIFE_DAYS);
    weighted += (1 + WAVE * Math.sin(d / WAVE_PERIOD_DAYS)) * w;
    weight += w;
  }
  const mean = weighted / weight;
  return (daysAgo: number): number => (1 + WAVE * Math.sin(daysAgo / WAVE_PERIOD_DAYS)) / mean;
})();

// Hourly, over two days: `readFeedErrors` reads a 24-hour window for the ratio
// and the whole retained history for the failure run, so the fixture has to
// carry more than the window for the two to differ.
const SWEEPS = 48;
const SWEEP_STEP_MS = 3_600_000;

// What a domain's articles are about, in the words its own subject gate accepts.
// A seeded row that fails that gate is invisible to every read on the page, so
// the fixture would be a blank page rather than the scenario asked for.
const subjectOf = (domain: Domain): string => domain.subject?.[0] ?? 'AI';

// How many keywords one article may claim. Unbounded, a greedy pick spends the
// whole table on the first row of a loud day — twenty-four terms in one headline,
// which is a stress test rather than a page state anyone will ever see. A real
// article scoring at the top of the log carries a handful.
const MAX_KEYWORDS = 5;

// What one article can carry at most: the heaviest `MAX_KEYWORDS` of the domain's
// own table, and never past `scoreFor`'s own cap. A domain whose whole table is
// worth 74 points reaches a loud counter on more rows a day rather than bigger
// ones — which is also what a loud week actually looks like.
function ceilingOf(domain: Domain): number {
  const heaviest = Object.values(domain.keywords)
    .sort((a, b) => b - a)
    .slice(0, MAX_KEYWORDS);
  return Math.min(MAX_SCORE, heaviest.reduce((a, b) => a + b, 0));
}

// Keywords out of the domain's own table summing to roughly `target`. Rotated by
// the article index so consecutive rows are not the same three words, and greedy
// so the sum lands under the target rather than over it.
function keywordsFor(domain: Domain, target: number, index: number): string[] {
  const entries = Object.entries(domain.keywords);
  const offset = index % entries.length;
  const rotated = [...entries.slice(offset), ...entries.slice(0, offset)];

  const picked: string[] = [];
  let remaining = target;
  for (const [keyword, weight] of rotated) {
    if (picked.length === MAX_KEYWORDS) break;
    if (weight > remaining) continue;
    picked.push(keyword);
    remaining -= weight;
  }
  return picked;
}

// Four shapes, deliberately different lengths: the point of looking at the page
// is seeing what a long headline does to a row that also carries a date, a
// source and a score badge.
const HEADLINES: ((subject: string, keywords: string) => string)[] = [
  (s, k) => `${s} report: ${k} confirmed in production`,
  (s, k) =>
    `Operators disclose ${k} across ${s} deployments on three continents, with a fix promised for next week and no timeline for the rest`,
  (s, k) => `${k} — what the ${s} disclosure actually says`,
  (s, k) => `Second week of ${k} in ${s} systems`,
];
const QUIET_HEADLINES: ((subject: string) => string)[] = [
  (s) => `${s} roundup: what shipped this week`,
  (s) => `Notes from a quiet week in ${s}`,
];

interface SeededArticle {
  url: string;
  title: string;
  source: string;
  published_at: string;
  summary: string;
  score: number;
  matched_keywords: string;
  evidence: string;
  scored_at: string;
}

function articleAt(domain: Domain, index: number, source: string, at: number, target: number): SeededArticle {
  const subject = subjectOf(domain);
  const keywords = target > 0 ? keywordsFor(domain, target, index) : [];
  const phrase = keywords.join(', ');
  const title = keywords.length
    ? HEADLINES[index % HEADLINES.length]!(subject, phrase)
    : QUIET_HEADLINES[index % QUIET_HEADLINES.length]!(subject);
  const published = new Date(at).toISOString();
  return {
    // `.invalid` is reserved and can never resolve, so a row in a fixture log
    // cannot be clicked through to something real.
    url: `https://seed.invalid/${domain.slug}/${index}`,
    title,
    source,
    published_at: published,
    summary: keywords.length
      ? `Seeded fixture row. Reporting on ${phrase} in ${subject} infrastructure, with the operator confirming the finding and declining to say how long it stood.`
      : `Seeded fixture row. A week of ${subject} announcements with nothing on this domain's table in any of them.`,
    score: scoreFor(keywords, domain.keywords),
    matched_keywords: JSON.stringify(keywords),
    evidence: keywords.length ? `…${keywords[0]}, confirmed by the operator…` : '',
    // Twenty minutes after publication, the way a sweep on an hourly schedule
    // scores one. It is `scored_at` — never `published_at` — that both the
    // balance gate and the trend window measure a domain's age on (STU-1283).
    scored_at: new Date(at + 20 * 60_000).toISOString(),
  };
}

// The daily score a domain has to publish for its counter to settle at `target`.
// `signalFor` inverted through `steadySignal(1)` rather than a constant worked
// out here, so the two stay one formula — and so a scenario name means the same
// band on every domain, which it would not if a domain calibrated at /24 were
// handed the daily rate that reads 41 at /32. Going through `signalFor` rather
// than the old straight-line inverse matters above `HEADROOM_KNEE`: `critical`'s
// target sits in the compressed range, and the linear inverse would undershoot
// the daily score the fixture actually needs (STU-1270).
function dailyScoreFor(domain: Domain, target: number): number {
  return Math.max(0, signalFor(target, BASE, domain.divisor) / steadySignal(1));
}

function seedDomain(db: ReturnType<typeof openDb>, domain: Domain, scenario: Scenario, bumped: boolean): number {
  if (!scenario.target) return 0;

  const sources = feedsOf(domain);
  const now = Date.now();
  const daily = dailyScoreFor(domain, scenario.target);
  const ceiling = ceilingOf(domain);

  const insert = db.prepare(
    'INSERT INTO articles (domain, url, title, source, published_at, summary, score, matched_keywords, evidence, scored_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  let index = 0;
  let written = 0;
  // Carried across days, not reset with each one: a domain whose cheapest
  // keyword is worth more than it publishes in a day cannot spend its budget on
  // the day it earns it, and resetting would throw that remainder away — which
  // read as whole weeks scoring nothing on `smarthome`, whose table starts at 10
  // and whose divisor is 4. Carried, the same domain publishes one story every
  // few days, which is what a table that coarse can say.
  let remaining = 0;
  db.transaction(() => {
    for (let daysAgo = SPAN_DAYS; daysAgo >= 0; daysAgo--) {
      const wave = waveAt(daysAgo);
      const bump = bumped && daysAgo < BUMP_DAYS ? (scenario.bump ?? 1) : 1;
      // The budget is spent a row at a time rather than split evenly across the
      // day, so a quiet domain publishes one story that scored and two that did
      // not instead of three rows each too cheap to carry any keyword at all.
      // The row it runs out on is the NOMINAL one, which is a log state worth
      // seeing too.
      remaining += daily * wave * bump;
      const perDay = Math.max(PER_DAY, Math.ceil(remaining / ceiling) + 1);
      for (let n = 0; n < perDay; n++, index++) {
        const at = now - daysAgo * 864e5 + n * Math.floor(864e5 / (perDay + 1));
        if (at > now) continue;
        const article = articleAt(
          domain,
          index,
          sources[index % sources.length]!,
          at,
          Math.min(ceiling, Math.max(0, remaining))
        );
        remaining -= article.score;
        insert.run(
          domain.slug,
          article.url,
          article.title,
          article.source,
          article.published_at,
          article.summary,
          article.score,
          article.matched_keywords,
          article.evidence,
          article.scored_at
        );
        written++;
      }
    }
  })();

  seedSweeps(db, domain, sources, scenario.feeds ?? 'healthy', now);

  // Through `scoredHistory` and `normalizedSignal`, which is the call
  // `aggregate.ts` makes on every real sweep — including its subject gate, so a
  // fixture on a gated domain reads the number that domain would actually
  // publish rather than one counting rows the page hides.
  const history = scoredHistory(db, domain, new Date(now - HORIZON_DAYS * 864e5).toISOString());
  const counter = counterFrom(normalizedSignal(history, now), BASE, domain.divisor);
  db.query(
    'INSERT INTO counter (domain, value, updated_at) VALUES (?, ?, ?)' +
      ' ON CONFLICT(domain) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(domain.slug, counter, new Date(now).toISOString());
  return written;
}

function seedSweeps(
  db: ReturnType<typeof openDb>,
  domain: Domain,
  sources: string[],
  feeds: NonNullable<Scenario['feeds']>,
  now: number
): void {
  if (feeds === 'outage' && sources.length < 2) {
    die(
      `seed: host-outage needs a domain with two feeds — with one, "all of them failed" is only "the feed failed",` +
        ` and ${domain.slug} has ${sources.length}.`
    );
  }

  const insert = db.prepare(
    'INSERT INTO feed_sweeps (domain, source, swept_at, error, pages_unread) VALUES (?, ?, ?, ?, 0)'
  );
  db.transaction(() => {
    for (let i = 0; i < SWEEPS; i++) {
      const sweptAt = new Date(now - i * SWEEP_STEP_MS).toISOString();
      for (const [n, source] of sources.entries()) {
        insert.run(domain.slug, source, sweptAt, errorFor(feeds, source, n, i));
      }
    }
  })();
}

// The two vocabularies `fetch-feed.ts` writes, and the distinction
// `reachedPublisher` reads them for: a status is proof the host resolved the
// name, so a sweep holding one is never charged to the host however many feeds
// failed in it.
function errorFor(feeds: NonNullable<Scenario['feeds']>, source: string, n: number, sweep: number): string | null {
  if (feeds === 'outage') return sweep < 3 ? 'getaddrinfo EAI_AGAIN — no resolver' : null;
  if (n !== 0) return null;
  // 30 hours, so the panel's day of grace is behind it and the verdict reads DOWN 30H.
  if (feeds === 'dead') return sweep <= 30 ? `${source} responded 503` : null;
  // Two sweeps in three, and never the newest: a feed answering right now has no
  // failure run to be judged on, which is the case the ratio exists for.
  if (feeds === 'flapping') return sweep % 3 === 0 ? null : `${source} responded 429`;
  return null;
}

// How many years of rising trend to seed, and the growth rate between them:
// AIID's real history roughly doubles every few years, and a flat line would
// say nothing about a page built specifically to show that kind of growth.
const AIID_YEARS_BACK = 8;
const AIID_GROWTH = 1.35;
const AIID_BASE_COUNT = 8;
// How many incidents to seed inside the trailing holdback window, so the
// fixture also proves the page holds them back rather than reading the
// current window as a real slowdown.
const AIID_RECENT_COUNT = 3;

function seedAiid(db: ReturnType<typeof openDb>): number {
  const currentYear = new Date().getUTCFullYear();
  const insert = db.prepare(
    'INSERT INTO aiid_incidents (incident_id, date, title, ingested_at) VALUES (?, ?, ?, ?)'
  );
  const ingestedAt = new Date().toISOString();
  let incidentId = 1;
  let written = 0;

  db.transaction(() => {
    for (let yearsAgo = AIID_YEARS_BACK; yearsAgo >= 0; yearsAgo--) {
      const year = currentYear - yearsAgo;
      const count = Math.round(AIID_BASE_COUNT * AIID_GROWTH ** (AIID_YEARS_BACK - yearsAgo));
      for (let i = 0; i < count; i++) {
        const dayOfYear = Math.floor((i / count) * 350) + 1;
        const date = new Date(Date.UTC(year, 0, dayOfYear)).toISOString();
        insert.run(incidentId, date, `Seeded AIID incident ${incidentId}`, ingestedAt);
        incidentId++;
        written++;
      }
    }

    for (let i = 0; i < AIID_RECENT_COUNT; i++) {
      const daysAgo = Math.floor((AIID_HOLDBACK_DAYS / (AIID_RECENT_COUNT + 1)) * i);
      const date = new Date(Date.now() - daysAgo * 864e5).toISOString();
      insert.run(incidentId, date, `Seeded recent AIID incident ${incidentId}`, ingestedAt);
      incidentId++;
      written++;
    }
  })();

  return written;
}

const name = process.argv[2];
const scenario = name ? SCENARIOS[name] : undefined;
if (!scenario) {
  const width = Math.max(...Object.keys(SCENARIOS).map((s) => s.length));
  console.error(
    (name ? `seed: no scenario called "${name}".` : 'seed: which scenario?') +
      '\n\n' +
      Object.entries(SCENARIOS)
        .map(([slug, s]) => `  ${slug.padEnd(width)}  ${s.what}`)
        .join('\n') +
      `\n\n  SKYNET_DB=/tmp/skynet-seed.db bun run seed nominal\n`
  );
  process.exit(1);
}

const path = seedPath();
const domain = currentDomain();
const db = openDb();

// Every scenario starts from an empty file rather than from whatever the last
// one left: a page state is the whole page, and the balance band and the nav
// read every domain in the registry, not the one being seeded.
db.transaction(() => {
  for (const table of ['articles', 'feed_sweeps', 'unread_pages', 'counter', 'aiid_incidents']) {
    db.query(`DELETE FROM ${table}`).run();
  }
})();

console.log(`scenario   ${name} — ${scenario.what}`);

if (scenario.aiid) {
  const written = seedAiid(db);
  db.close();
  console.log(`wrote      ${path}: ${written} AIID incidents`);
  console.log(`\n  SKYNET_DB=${path} bun run dev\n  then open /aiid\n`);
} else {
  const targets = scenario.everyDomain ? DOMAINS : [domain];
  let written = 0;
  for (const target of targets) written += seedDomain(db, target, scenario, target.slug === domain.slug);
  const counter = db
    .query<{ value: number }, [string]>('SELECT value FROM counter WHERE domain = ?')
    .get(domain.slug);
  db.close();

  console.log(`domain     ${domain.slug} (${domain.label})${targets.length > 1 ? `, and ${targets.length - 1} more` : ''}`);
  console.log(`wrote      ${path} — ${written} articles over ${SPAN_DAYS} days`);
  console.log(
    counter
      ? `counter    ${counter.value.toFixed(1)}  ${statusLine(counter.value, domain.polarity)}`
      : 'counter    no row — the page reads 0'
  );
  console.log(`\n  SKYNET_DB=${path} bun run dev\n`);
}
