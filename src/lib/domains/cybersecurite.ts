import type { Domain } from './index';

// The original single-domain configuration, unchanged in substance: the same
// twenty-four keywords at the same weights, and the same divisor calibrated on
// 2026-09-01 against the live corpus (STU-1216).
export const cybersecurite: Domain = {
  slug: 'cybersecurite',
  label: 'Cybersecurity',
  tagline: 'AI-driven compromise, autonomy and loss of control',
  // Calibrated 2026-09-01 by `bun run calibrate` against the live corpus, whose
  // feeds publish 97 points of score a day between them. At a 7-day half-life
  // that settles at a steady signal of ~930, so /32 reads 41 on an ordinary week,
  // 70 on a doubled one, and still stops short of 100 on a tripled one. The
  // previous /8 was guessed while every article scored 0; it pegs the gauge at 100
  // on an ordinary week and never comes back down (STU-1171).
  divisor: 32,
  keywords: {
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
  },
  guidance: [
    'This domain scores AI-driven compromise: an incident, a capability, or a',
    'failure that leaves systems less controllable than before.',
    '',
    'Keywords that are present but describe no risk, as they keep appearing here:',
    '"agentic" in a product tagline, "breach" in a contract-law story, "deceptive"',
    'in a story about advertising practices.',
    '',
    'Direction is the subtler case. A defence named after the attack it stops —',
    '"the best protection yet against account takeovers" — scores nothing. But an',
    'incident that was patched afterwards is still an incident: a vulnerability that',
    'was silently mitigated was real, and refusing to pay a ransom is still a',
    'ransomware story. Ask whether the article reports the problem or the remedy.',
  ].join('\n'),
};
