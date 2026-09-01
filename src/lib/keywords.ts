export const KEYWORD_WEIGHTS: Record<string, number> = {
  'loss of control': 15,
  'self-replicating': 15,
  'self-improving': 15,
  'shutdown resistance': 14,
  'sandbox escape': 12,
  misalign: 12,
  'remote code execution': 10,
  'supply-chain attack': 10,
  deceptive: 10,
  'reward hacking': 10,
  'privilege escalation': 9,
  'prompt injection': 9,
  'zero-day': 8,
  backdoor: 8,
  'active exploitation': 8,
  jailbreak: 8,
  exfiltrate: 7,
  'credentials leaked': 7,
  'autonomous agent': 6,
  ransomware: 6,
  breach: 5,
  vulnerability: 5,
  agentic: 4,
  'account takeover': 4,
};

export const MAX_SCORE = 100;

// Feeds render the same phrase as "supply-chain attack", "supply chain attack"
// or with a typographic hyphen; flattening punctuation makes those one token.
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchedKeywords(text: string): string[] {
  const haystack = normalizeText(text);
  return Object.keys(KEYWORD_WEIGHTS).filter((k) => haystack.includes(normalizeText(k)));
}

export function scoreFor(keywords: string[]): number {
  const seen = new Set(keywords.map((k) => k.toLowerCase().trim()));
  let total = 0;
  for (const k of seen) total += KEYWORD_WEIGHTS[k] ?? 0;
  return Math.min(MAX_SCORE, total);
}
