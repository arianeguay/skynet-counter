export const MAX_SCORE = 100;

// Feeds render the same phrase as "supply-chain attack", "supply chain attack"
// or with a typographic hyphen; flattening punctuation makes those one token.
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// The table is a parameter rather than a module constant: each domain carries
// its own in `src/lib/domains/<slug>.ts`, and the matcher is the one piece of
// the scoring that is the same for all of them (STU-1213).
export function matchedKeywords(text: string, weights: Record<string, number>): string[] {
  const haystack = normalizeText(text);
  return Object.keys(weights).filter((k) => haystack.includes(normalizeText(k)));
}

export function scoreFor(keywords: string[], weights: Record<string, number>): number {
  const seen = new Set(keywords.map((k) => k.toLowerCase().trim()));
  let total = 0;
  for (const k of seen) total += weights[k] ?? 0;
  return Math.min(MAX_SCORE, total);
}

// Words that sit in front of a keyword when an article is describing the thing
// being fixed rather than happening. Prefixes, so "reducing" and "reduced" both
// land; deliberately narrow, because a note that cries wolf gets ignored — these
// are the ones measured firing on the live corpus plus their obvious siblings.
const MITIGATION =
  /^(reduc|prevent|patch|mitigat|protect|fix|curb|avoid|eliminat|offset|decreas|lower|minimis|minimiz|defend|slash|halv|without)/;
const MITIGATION_WINDOW = 5;

// Which of `keywords` read as mitigated in `text` — the keyword is there, but a
// word like "reducing" or "protection against" comes just before it.
//
// This reports; it must never decide a score. Measured over the live corpus
// (STU-1277), 8 of 70 scored articles had a mitigation word within five words of a
// kept keyword and only 2 were genuinely about a remedy: a vulnerability that was
// silently mitigated was still a vulnerability, and refusing to pay a ransom is
// still a ransomware story. Suppressing on this signal would have cost six real
// incidents to catch two false ones, so the judgement stays the scorer's and this
// only makes a wrong one visible.
export function mitigatedMatches(text: string, keywords: string[]): string[] {
  const haystack = normalizeText(text);
  const flagged: string[] = [];
  for (const keyword of keywords) {
    const needle = normalizeText(keyword);
    if (!needle) continue;
    for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
      const before = haystack.slice(0, i).trim().split(' ').slice(-MITIGATION_WINDOW);
      if (before.some((word) => MITIGATION.test(word))) {
        flagged.push(keyword);
        break;
      }
    }
  }
  return flagged;
}

// Whether `text` is about a domain's subject at all — the gate that runs before
// the keyword table gets a say.
//
// A keyword table measures *severity*, and it can only do that inside a subject
// it can assume. `environment` could not: its table names quantities and
// decisions in the physical world ("aquifer", "ratepayer", "gas turbine") while
// its feeds are general climate press, so an oil spill and a farm going under on
// fuel prices both scored — real stories, on the wrong beat, on a counter whose
// tagline says AI compute (STU-1291). The subject is the thing the tagline
// claims; the table is what went wrong inside it.
//
// Matching is whole-token, not `matchedKeywords`' substring: the subject list
// carries short words that live inside longer unrelated ones, and "ai" as a
// substring matches aircraft, said, available and rain. Inflections are the cost
// — "data center" no longer covers "data centers" — so a subject list spells its
// plurals out rather than relying on a prefix.
//
// A domain with no subject list is ungated, which is the right default: a domain
// whose feeds are all on its beat already has the gate its feed list gives it.
export function mentionsSubject(text: string, subject?: readonly string[]): boolean {
  if (!subject || subject.length === 0) return true;
  const haystack = ` ${normalizeText(text)} `;
  return subject.some((term) => haystack.includes(` ${normalizeText(term)} `));
}

// The keywords an article may be scored on: none at all when it is off the
// domain's subject, however much of the table its text happens to contain.
//
// This is the one definition of the gate. `dedupe` calls it to build
// `candidate_keywords` and `validate-scores` calls it to recompute them, for the
// same reason both already call `matchedKeywords` — a gate the two stages
// implemented separately would be two rules that have to agree.
export function candidateKeywords(
  text: string,
  weights: Record<string, number>,
  subject?: readonly string[]
): string[] {
  return mentionsSubject(text, subject) ? matchedKeywords(text, weights) : [];
}
