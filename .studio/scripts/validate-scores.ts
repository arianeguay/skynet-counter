import { readContext, emit, type RawArticle } from './rss.ts';
import { matchedKeywords, mitigatedMatches, scoreFor } from '../../src/lib/keywords.ts';
import { currentDomain } from '../../src/lib/domains/index.ts';

// Read from the domain's own module, never from the `keyword_weights` the dedupe
// stage hands the scorer. The validator's whole value is that it recomputes from
// a source the batch under test cannot influence (STU-1213).
const { keywords: weights } = currentDomain();

interface Dropped {
  keyword?: string;
  reason?: string;
}

interface Scored {
  url?: string;
  score?: number;
  matched_keywords?: string[];
  dropped_keywords?: Dropped[];
  evidence?: string;
}

const ctx = await readContext<{
  previous_outputs?: {
    dedupe?: { articles?: RawArticle[] };
    score?: { articles?: Scored[] };
  };
}>();

const candidates = ctx.previous_outputs?.dedupe?.articles ?? [];
const scored = ctx.previous_outputs?.score?.articles ?? [];
const byUrl = new Map(candidates.map((a) => [a.url, a]));
const issues: string[] = [];
const omissions: string[] = [];
const declarations: string[] = [];
const mitigated: string[] = [];

if (scored.length !== candidates.length) {
  issues.push(`Scored ${scored.length} articles but ${candidates.length} were submitted — score every one, exactly once.`);
}

for (const s of scored) {
  const label = s.url ?? '<missing url>';
  const source = s.url ? byUrl.get(s.url) : undefined;
  if (!source) {
    issues.push(`${label}: not one of the submitted articles.`);
    continue;
  }

  const present = new Set(matchedKeywords(`${source.title} ${source.summary}`, weights));
  const keywords = s.matched_keywords ?? [];
  const kept = new Set(keywords.map((k) => k.toLowerCase().trim()));

  for (const k of keywords) {
    const key = k.toLowerCase().trim();
    if (!(key in weights)) {
      issues.push(`${label}: "${k}" is not in the keyword list.`);
    } else if (!present.has(key)) {
      issues.push(`${label}: claimed keyword "${k}" does not appear in the title or summary.`);
    }
  }

  // Rule 2 lets the scorer drop a literal match that does not describe the risk it
  // names. A drop it declares — keyword plus a one-line reason — is a judgement it
  // stands behind; a silent one is indistinguishable from a keyword it never saw.
  const declared = new Set<string>();
  for (const d of s.dropped_keywords ?? []) {
    const raw = d?.keyword ?? '';
    const key = raw.toLowerCase().trim();
    if (!key) {
      issues.push(`${label}: a dropped_keywords entry names no keyword.`);
    } else if (!(key in weights)) {
      issues.push(`${label}: dropped keyword "${raw}" is not in the keyword list.`);
    } else if (!present.has(key)) {
      issues.push(`${label}: dropped keyword "${raw}" does not appear in the title or summary.`);
    } else if (kept.has(key)) {
      issues.push(`${label}: "${raw}" is in both matched_keywords and dropped_keywords — keep it or drop it.`);
    } else if (!d.reason?.trim()) {
      issues.push(
        `${label}: dropped keyword "${raw}" with no reason — say in one line why it does not describe the risk it names.`
      );
    } else {
      declared.add(key);
    }
  }

  const dropped = [...present].filter((k) => !kept.has(k));
  const silent = dropped.filter((k) => !declared.has(k));
  if (silent.length > 0) {
    omissions.push(`${label}: ${silent.map((k) => `"${k}"`).join(', ')}`);
    // A blanket zero is what a silently broken scorer looks like — but only when the
    // zero is silent. Every literal match accounted for in dropped_keywords is rule 2
    // working, and rejecting it burns all three iterations over a correct answer.
    if (kept.size === 0) {
      issues.push(
        `${label}: kept none of the ${dropped.length} keywords literally present and left ${silent
          .map((k) => `"${k}"`)
          .join(', ')} unaccounted for — keep the ones that describe the article's risk, or declare the drop in dropped_keywords with a reason.`
      );
    }
  }
  if (declared.size > 0) {
    declarations.push(
      `${label}: ${[...declared].map((k) => `"${k}"`).join(', ')}`
    );
  }

  // Reported, never rejected. A keyword reading as mitigated is usually still
  // earned — the incident happened and was fixed afterwards — so this is a line in
  // the run log for a human, not a verdict (STU-1277).
  const reads = mitigatedMatches(`${source.title} ${source.summary}`, keywords);
  if (reads.length > 0) {
    mitigated.push(`${label}: ${reads.map((k) => `"${k}"`).join(', ')}`);
  }

  const expected = scoreFor(keywords, weights);
  if (s.score !== expected) {
    issues.push(`${label}: score ${s.score} does not match the sum of its matched keyword weights (${expected}).`);
  }
  if (keywords.length > 0 && !s.evidence?.trim()) {
    issues.push(`${label}: scored above zero with no evidence quote.`);
  }
}

const verdict =
  issues.length === 0
    ? `${scored.length} scored articles verified: every claimed keyword is literally present and every score matches its weights.`
    : `${issues.length} traceability violations across ${scored.length} scored articles.`;

const notes: string[] = [];
if (omissions.length > 0) {
  notes.push(`${omissions.length} articles left a literal keyword unclaimed — ${omissions.join('; ')}.`);
}
if (declarations.length > 0) {
  notes.push(`${declarations.length} articles declared a deliberate drop — ${declarations.join('; ')}.`);
}
if (mitigated.length > 0) {
  notes.push(
    `${mitigated.length} articles kept a keyword that reads as mitigated — ${mitigated.join('; ')}. Check the article reports the problem rather than the remedy.`
  );
}

emit({
  status: issues.length === 0 ? 'approved' : 'rejected',
  summary: [verdict, ...notes].join(' '),
  issues,
});
