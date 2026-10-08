// The probe in CLAUDE.md's "Picking a domain's keywords" for feeds that have no
// stored corpus yet — a domain that does not exist, or a feed not yet added.
// `keyword-probe.ts` reads rows the pipeline already hydrated; this fetches the
// feeds live, hydrates each linked page the way `dedupe` does, and counts the
// same way. Read-only: it never scores and never writes.
//
//   bun scripts/live-probe.ts --feeds scripts/candidates/capability-compression.feeds \
//                             --candidates scripts/candidates/capability-compression.txt
//
// `--feeds <file>`: one feed per line, the URL first and the source name after
// it, `#` comments. `--candidates <file>`: the probe's own format. Positional
// arguments are extra terms. `--no-gate` skips the AI subject gate, for a
// domain whose subject is not AI.
import { AI_SUBJECT } from '@/lib/domains/ai-subject';
import { mentionsSubject } from '@/lib/keywords';
import {
  BEAT_RATIO,
  CONCENTRATION_RATIO,
  probeTerms,
  sourceSignal,
  verdictOf,
  type SourcedRow,
} from '@/lib/keyword-probe';
import { hydrateSummaries, parseFeed, USER_AGENT, type RawArticle } from '../.studio/scripts/rss';

const args = process.argv.slice(2);
const terms: string[] = [];
const feeds: { url: string; source: string }[] = [];
let gate = true;

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--candidates' || arg === '--feeds') {
    const file = args[++i];
    if (!file) throw new Error(`${arg} needs a file path`);
    const text = await Bun.file(file).text();
    if (arg === '--candidates') terms.push(...lines(text));
    else
      for (const line of lines(text)) {
        const [url, ...name] = line.split(/\s+/);
        feeds.push({ url: url!, source: name.join(' ') || url! });
      }
  } else if (arg === '--no-gate') {
    gate = false;
  } else {
    terms.push(arg);
  }
}

if (feeds.length === 0 || terms.length === 0) {
  console.error('usage: live-probe.ts --feeds <file> --candidates <file> [term ...] [--no-gate]');
  process.exit(2);
}

// A dead feed is reported and skipped, the way `fetch-feed.ts` never throws on
// one: a probe that stops on the first 404 measures nothing.
async function pull(feed: { url: string; source: string }): Promise<RawArticle[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`responded ${res.status}`);
    return parseFeed(await res.text(), feed.source);
  } catch (err) {
    console.log(`feed       ${feed.source}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

const pulled = (await Promise.all(feeds.map(pull))).flat();
const { articles: hydrated, failed } = await hydrateSummaries(pulled);
const rows: SourcedRow[] = hydrated.filter((a) => !gate || mentionsSubject(`${a.title} ${a.summary}`, AI_SUBJECT));

function pct(n: number, total: number): string {
  return `${total === 0 ? 0 : Math.round((100 * n) / total)}%`;
}

function line(cells: [string, ...string[]]): string {
  const [first, ...rest] = cells;
  return `  ${first.padEnd(26)}${rest.map((c) => c.padStart(9)).join('')}`;
}

console.log(`corpus     ${pulled.length} items from ${feeds.length} feeds, ${hydrated.length} pages read, ${failed.length} unread`);
if (gate) console.log(`subject    the AI gate holds back ${hydrated.length - rows.length} of ${hydrated.length}`);

if (rows.length === 0) {
  console.log('nothing left to probe.');
  process.exit(1);
}

const stats = probeTerms(
  rows.map((r) => ({ ...r, score: 0 })),
  terms
);
console.log(`\ncandidates — ${terms.length} terms over ${rows.length} articles`);
console.log(line(['term', 'hits', 'share']) + '   verdict');
for (const s of stats) {
  const verdict = verdictOf(s);
  console.log(line([s.term, String(s.hits), pct(s.hits, rows.length)]) + (verdict === 'ok' ? '' : `   ${verdict.toUpperCase()}`));
}

// Only the terms that mark a story count toward where the signal comes from.
const marking = stats.filter((s) => verdictOf(s) === 'ok').map((s) => s.term);
const sources = sourceSignal(rows, marking);
console.log(`\nsources — articles holding at least one of the ${marking.length} terms that mark a story`);
console.log(line(['source', 'articles', 'signal', 'share']));
for (const s of sources) {
  const flag = s.share > CONCENTRATION_RATIO ? '   CONCENTRATED' : '';
  console.log(line([s.source, String(s.articles), String(s.signal), `${Math.round(100 * s.share)}%`]) + flag);
}
console.log(
  `\n  DEAD  fires on nothing.  BEAT  fires on ${Math.round(100 * BEAT_RATIO)}%+ — the subject, not the story.` +
    `\n  CONCENTRATED  one source supplies over ${Math.round(100 * CONCENTRATION_RATIO)}% of the signal — the counter would` +
    `\n                measure that publisher rather than the beat.`
);
