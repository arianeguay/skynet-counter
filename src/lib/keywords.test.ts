import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { KEYWORD_WEIGHTS, matchedKeywords, scoreFor } from '@/lib/keywords';

// Real Ars Technica items from the 2026-09-01 run, which scored 0 across the
// board because the list only carried agentic-AI vocabulary.
const CORPUS = [
  {
    title: 'Thousands of servers can be backdoored by exploiting buggy motherboard controllers',
    summary: "Baseboard management controllers from the world's biggest manufacturers are a security mess.",
    expected: ['backdoor'],
  },
  {
    title: 'Terabytes of credentials leaked in massive supply-chain attack',
    summary: 'The data was scraped and exfiltrated from 2,500 users of a compromised AI package.',
    expected: ['supply-chain attack', 'exfiltrate', 'credentials leaked'],
  },
  {
    title: 'Vulnerability giving attackers full control of Macs is under active exploitation',
    summary: 'Screen-sharing bug lets remote hackers log in without a password.',
    expected: ['active exploitation', 'vulnerability'],
  },
];

test.each(CORPUS)('$title scores above zero', ({ title, summary, expected }) => {
  const matched = matchedKeywords(`${title} ${summary}`);
  expect(matched.sort()).toEqual([...expected].sort());
  expect(scoreFor(matched)).toBeGreaterThan(0);
});

test('punctuation and inflection do not break a match', () => {
  expect(matchedKeywords('a supply chain attack')).toEqual(['supply-chain attack']);
  expect(matchedKeywords('Grok exfiltrates user data')).toEqual(['exfiltrate']);
  expect(matchedKeywords('protection against account takeovers')).toEqual(['account takeover']);
});

test('an unrelated article still scores zero', () => {
  expect(matchedKeywords('The Pentagon now has its own version of ChatGPT and Grok')).toEqual([]);
});

// The scorer prompt hardcodes the table; a change on one side only would let the
// agent claim a keyword the validator rejects, or miss one it should have used.
test('the scorer prompt lists exactly the weighted keywords', () => {
  const prompt = readFileSync('.studio/agents/scorer.agent.yaml', 'utf8');
  const table = prompt.match(/^ {4}(.+?) \.+ *(\d+)$/gm) ?? [];
  const listed = Object.fromEntries(
    table.map((line) => {
      const [, keyword, weight] = line.match(/^ {4}(.+?) \.+ *(\d+)$/)!;
      return [keyword, Number(weight)];
    })
  );
  expect(listed).toEqual(KEYWORD_WEIGHTS);
});
