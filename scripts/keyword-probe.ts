// Runs the measurement "Picking a domain's keywords" describes against the
// stored corpus, instead of by hand (STU-1218, STU-1217, STU-1219 all ran it
// that way). Read-only: it never scores, never fetches and never writes.
//
//   SKYNET_DOMAIN=cybersecurite bun scripts/keyword-probe.ts
//   SKYNET_DOMAIN=cybersecurite bun scripts/keyword-probe.ts --candidates scripts/candidates/ai-uplift.txt
//   SKYNET_DOMAIN=environment   bun scripts/keyword-probe.ts --days 30 'heat pump'
//
// Positional arguments and `--candidates <file>` (one term per line, `#`
// comments) are terms **not yet in the table**, measured the same way so a
// proposed entry is a number before it is a commit.
import { Database } from 'bun:sqlite';
import { currentDomain } from '@/lib/domains';
import { mentionsSubject } from '@/lib/keywords';
import { BEAT_RATIO, collisions, probeTerms, verdictOf, type ProbeRow, type TermStat } from '@/lib/keyword-probe';

const args = process.argv.slice(2);
const candidates: string[] = [];
let days: number | null = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--candidates') {
    const file = args[++i];
    if (!file) throw new Error('--candidates needs a file path');
    candidates.push(
      ...(await Bun.file(file).text())
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter(Boolean)
    );
  } else if (arg === '--days') {
    days = Number(args[++i]);
    if (!Number.isFinite(days)) throw new Error('--days needs a number');
  } else {
    candidates.push(arg);
  }
}

const domain = currentDomain();
const path = process.env.SKYNET_DB ?? 'data/skynet.db';
const db = new Database(path, { readonly: true });
const since = days === null ? '' : new Date(Date.now() - days * 864e5).toISOString();

const stored = db
  .query<ProbeRow & { published_at: string }, [string, string]>(
    'SELECT title, summary, score, published_at FROM articles WHERE domain = ? AND score IS NOT NULL AND published_at >= ?'
  )
  .all(domain.slug, since);

// The same gate the counter reads through. An off-subject row scores zero by
// construction, so leaving those in would make every candidate look like it
// rescues articles the table missed, when what it found is articles the gate
// already threw away (STU-1291).
const rows = stored.filter((r) => mentionsSubject(`${r.title} ${r.summary}`, domain.subject));

if (rows.length === 0) {
  console.log(`${path}: no scored ${domain.slug} article to probe.`);
  process.exit(1);
}

const dates = rows.map((r) => r.published_at).sort();
const span = Math.max(1, (Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / 864e5);
const zeros = rows.filter((r) => r.score === 0).length;
const thin = rows.filter((r) => r.summary.length < 400).length;

console.log(`domain     ${domain.slug} (${domain.label})`);
console.log(`corpus     ${path} — ${rows.length} scored articles${days === null ? '' : ` in the last ${days} days`}`);
console.log(`span       ${dates[0]!.slice(0, 10)} .. ${dates.at(-1)!.slice(0, 10)}  (${span.toFixed(1)} days)`);
console.log(`scoring    ${rows.length - zeros} above zero (${pct(rows.length - zeros, rows.length)}), ${zeros} at zero`);
if (domain.subject) {
  const cut = stored.length - rows.length;
  console.log(`subject    the gate holds back ${cut} of ${stored.length} scored rows (${pct(cut, stored.length)})`);
}
// A row whose page never hydrated carries an RSS summary of a few dozen words,
// and every term reads as dead against it. Worth seeing before believing a zero.
if (thin > 0) console.log(`thin       ${thin} rows carry under 400 characters — hydration failed or the feed is boilerplate`);

function pct(n: number, total: number): string {
  return `${total === 0 ? 0 : Math.round((100 * n) / total)}%`;
}

function line(cells: [string, ...string[]]): string {
  const [term, ...rest] = cells;
  return `  ${term.padEnd(26)}${rest.map((c) => c.padStart(9)).join('')}`;
}

function stat(s: TermStat): [string, string, string, string, string] {
  return [s.term, String(s.hits), pct(s.hits, rows.length), s.meanScore.toFixed(1), String(s.rescues)];
}

const table = Object.keys(domain.keywords);
console.log(`\nlive table — ${table.length} keywords, sorted by hits`);
console.log(line(['keyword', 'hits', 'share', 'mean', 'rescues']) + '   verdict');
for (const s of probeTerms(rows, table)) {
  const verdict = verdictOf(s);
  console.log(line(stat(s)) + `   ${verdict === 'ok' ? '' : verdict.toUpperCase()}`);
}
console.log(
  `\n  rescues  articles holding the keyword that still scored zero — the scorer dropped it.` +
    `\n           A live entry with many is one rule 2 keeps reading as a remedy, not an incident.` +
    `\n  DEAD  fires on nothing — dead weight, and a table of those is a counter stuck at its floor.` +
    `\n  BEAT  fires on ${Math.round(100 * BEAT_RATIO)}%+ — measuring the beat, not the story. Dead weight as severity,` +
    `\n        and exactly what makes a good subject term. Read it twice, for the two purposes.`
);

if (candidates.length > 0) {
  console.log(`\ncandidates — ${candidates.length} terms not in the table`);
  console.log(line(['term', 'hits', 'share', 'mean', 'rescues']) + '   collides with');
  for (const s of probeTerms(rows, candidates)) {
    const clash = collisions(s.term, domain.keywords);
    const verdict = verdictOf(s);
    const note = [verdict === 'ok' ? '' : verdict.toUpperCase(), ...clash].filter(Boolean).join(' ');
    console.log(line(stat(s)) + (note ? `   ${note}` : ''));
  }
  console.log(
    `\n  rescues  hits on articles the live table scores at zero (${zeros} of ${rows.length} rows).` +
      `\n           The only column that says whether a term reaches stories the counter` +
      `\n           cannot currently see, rather than adding weight to ones it already counts.` +
      `\n  collides an existing keyword this term contains or is contained by. The matcher` +
      `\n           scans by substring, so such a pair pays twice on one article.`
  );
}
