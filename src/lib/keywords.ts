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
