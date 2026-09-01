import { readContext, emit, type RawArticle } from './rss.ts';
import { KEYWORD_WEIGHTS, matchedKeywords, scoreFor } from '../../src/lib/keywords.ts';

interface Scored {
  url?: string;
  score?: number;
  matched_keywords?: string[];
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

  const present = new Set(matchedKeywords(`${source.title} ${source.summary}`));
  const keywords = s.matched_keywords ?? [];
  const kept = new Set(keywords.map((k) => k.toLowerCase().trim()));

  for (const k of keywords) {
    const key = k.toLowerCase().trim();
    if (!(key in KEYWORD_WEIGHTS)) {
      issues.push(`${label}: "${k}" is not in the keyword list.`);
    } else if (!present.has(key)) {
      issues.push(`${label}: claimed keyword "${k}" does not appear in the title or summary.`);
    }
  }

  // Rule 2 lets the scorer drop a literal match that does not describe the risk it
  // names, so an omission is reported rather than rejected — except a blanket zero,
  // which is what a silently broken scorer looks like.
  const dropped = [...present].filter((k) => !kept.has(k));
  if (dropped.length > 0) {
    omissions.push(`${label}: ${dropped.map((k) => `"${k}"`).join(', ')}`);
    if (kept.size === 0) {
      issues.push(
        `${label}: kept none of the ${dropped.length} keywords literally present (${dropped
          .map((k) => `"${k}"`)
          .join(', ')}) — keep the ones that describe the article's risk.`
      );
    }
  }

  const expected = scoreFor(keywords);
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

emit({
  status: issues.length === 0 ? 'approved' : 'rejected',
  summary:
    omissions.length === 0
      ? verdict
      : `${verdict} ${omissions.length} articles left a literal keyword unclaimed — ${omissions.join('; ')}.`,
  issues,
});
