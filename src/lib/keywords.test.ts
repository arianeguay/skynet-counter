import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { KEYWORD_WEIGHTS, matchedKeywords, normalizeText, scoreFor } from '@/lib/keywords';

// Real feed items from the 2026-09-01 run. The Ars Technica three scored 0 back
// when the list only carried agentic-AI vocabulary; the TechCrunch one scored 0
// for the mirror-image reason, once the list had only infosec vocabulary left.
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
  {
    title: 'An Anthropic researcher just gave us a peek at self-improving AI',
    summary:
      'Given 10 benchmarks for specific misaligned behaviors, the automated systems were able to improve performance on every single one without degrading overall performance.',
    expected: ['self-improving', 'misalign'],
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

// The README table is the third copy, and the one that drifted through eleven
// keywords before anyone noticed.
test('the README table lists exactly the weighted keywords', () => {
  const table = readFileSync('README.md', 'utf8').match(/^\| (?!Keyword )(.+) \| (\d+) \| \| (.+) \| (\d+) \|$/gm) ?? [];
  const listed = Object.fromEntries(
    table.flatMap((line) => {
      const [, a, aw, b, bw] = line.match(/^\| (.+) \| (\d+) \| \| (.+) \| (\d+) \|$/)!;
      return [
        [a, Number(aw)],
        [b, Number(bw)],
      ];
    })
  );
  expect(listed).toEqual(KEYWORD_WEIGHTS);
});

// `deceptive` and `reward hacking` are the two additions no feed item in the
// corpus exercises yet. They are eval-report vocabulary the outlets have started
// carrying, held to the same literal-match rule as the rest.
test.each([
  { text: 'Frontier model shows deceptive alignment under evaluation', expected: ['deceptive'] },
  { text: 'Agents caught reward hacking their own benchmarks', expected: ['reward hacking'] },
])('$text matches $expected', ({ text, expected }) => {
  expect(matchedKeywords(text)).toEqual([...expected]);
});

// `exploit` was the near-miss that motivated this: "under active exploitation"
// contains it, so one phrase would have paid out twice.
test('no keyword is a substring of another', () => {
  const keys = Object.keys(KEYWORD_WEIGHTS).map(normalizeText);
  for (const a of keys) {
    expect(keys.filter((b) => b.includes(a))).toEqual([a]);
  }
});
