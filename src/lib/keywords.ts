export const KEYWORD_WEIGHTS: Record<string, number> = {
  'loss of control': 15,
  'self-replicating': 15,
  'shutdown resistance': 14,
  'sandbox escape': 12,
  'privilege escalation': 9,
  'zero-day': 8,
  'autonomous agent': 6,
  breach: 5,
  agentic: 4,
};

export const MAX_SCORE = 100;

export function scoreFor(keywords: string[]): number {
  const seen = new Set(keywords.map((k) => k.toLowerCase().trim()));
  let total = 0;
  for (const k of seen) total += KEYWORD_WEIGHTS[k] ?? 0;
  return Math.min(MAX_SCORE, total);
}
