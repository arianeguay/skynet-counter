import { expect, test } from 'bun:test';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '../../.studio/scripts/validate-scores.ts');

const ARTICLES = [
  {
    title: 'Terabytes of credentials leaked in massive supply-chain attack',
    url: 'https://example.com/supply-chain',
    source: 'arstechnica',
    publishedAt: '2026-09-01T00:00:00.000Z',
    summary: 'The data was scraped and exfiltrated from 2,500 users of a compromised AI package.',
  },
  {
    title: 'Vulnerability giving attackers full control of Macs is under active exploitation',
    url: 'https://example.com/macs-exploit',
    source: 'arstechnica',
    publishedAt: '2026-09-01T00:00:00.000Z',
    summary: 'Screen-sharing bug lets remote hackers log in without a password.',
  },
];

// Rule 2's own example: the word is there, the risk it names is not. Its only
// literal match, so dropping it is the whole verdict — the case STU-1184 is about.
const CONTRACT_STORY = [
  {
    title: 'Judge rules AI vendor in breach of its enterprise support contract',
    url: 'https://example.com/contract-law',
    source: 'techcrunch',
    publishedAt: '2026-09-01T00:00:00.000Z',
    summary: 'The dispute turns on an uptime clause, not on anything the model did.',
  },
];

interface Verdict {
  status: string;
  summary: string;
  issues: string[];
}

async function validate(scored: unknown[], candidates: unknown[] = ARTICLES): Promise<Verdict> {
  const proc = Bun.spawn(['bun', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        previous_outputs: { dedupe: { articles: candidates }, score: { articles: scored } },
      })
    ),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out) as Verdict;
}

test('a batch scored all zeros over articles carrying keywords is rejected and names the omissions', async () => {
  const verdict = await validate(
    ARTICLES.map((a) => ({ url: a.url, score: 0, matched_keywords: [], evidence: '' }))
  );

  expect(verdict.status).toBe('rejected');
  expect(verdict.issues).toHaveLength(2);
  expect(verdict.issues[0]).toContain('supply-chain attack');
  expect(verdict.issues[1]).toContain('active exploitation');
  expect(verdict.summary).toContain('left a literal keyword unclaimed');
});

test('a partial omission is reported in the summary but still approved', async () => {
  const verdict = await validate([
    {
      url: ARTICLES[0]!.url,
      score: 17,
      matched_keywords: ['supply-chain attack', 'credentials leaked'],
      evidence: 'Terabytes of credentials leaked',
    },
    {
      url: ARTICLES[1]!.url,
      score: 13,
      matched_keywords: ['active exploitation', 'vulnerability'],
      evidence: 'under active exploitation',
    },
  ]);

  expect(verdict.status).toBe('approved');
  expect(verdict.summary).toContain('"exfiltrate"');
});

test('a fully claimed batch reports no omissions', async () => {
  const verdict = await validate([
    {
      url: ARTICLES[0]!.url,
      score: 24,
      matched_keywords: ['supply-chain attack', 'credentials leaked', 'exfiltrate'],
      evidence: 'Terabytes of credentials leaked',
    },
    {
      url: ARTICLES[1]!.url,
      score: 13,
      matched_keywords: ['active exploitation', 'vulnerability'],
      evidence: 'under active exploitation',
    },
  ]);

  expect(verdict.status).toBe('approved');
  expect(verdict.summary).not.toContain('unclaimed');
});

test('an all-zero article whose only literal match is declared dropped is approved', async () => {
  const verdict = await validate(
    [
      {
        url: CONTRACT_STORY[0]!.url,
        score: 0,
        matched_keywords: [],
        dropped_keywords: [
          { keyword: 'breach', reason: 'a contract dispute, not a security breach' },
        ],
        evidence: '',
      },
    ],
    CONTRACT_STORY
  );

  expect(verdict.status).toBe('approved');
  expect(verdict.issues).toHaveLength(0);
  expect(verdict.summary).toContain('declared a deliberate drop');
  expect(verdict.summary).not.toContain('unclaimed');
});

test('the same article with the drop undeclared is still rejected', async () => {
  const verdict = await validate(
    [{ url: CONTRACT_STORY[0]!.url, score: 0, matched_keywords: [], evidence: '' }],
    CONTRACT_STORY
  );

  expect(verdict.status).toBe('rejected');
  expect(verdict.issues).toHaveLength(1);
  expect(verdict.issues[0]).toContain('"breach"');
  expect(verdict.summary).toContain('unclaimed');
});

test('a drop declared without a reason is rejected', async () => {
  const verdict = await validate(
    [
      {
        url: CONTRACT_STORY[0]!.url,
        score: 0,
        matched_keywords: [],
        dropped_keywords: [{ keyword: 'breach', reason: '  ' }],
        evidence: '',
      },
    ],
    CONTRACT_STORY
  );

  expect(verdict.status).toBe('rejected');
  expect(verdict.issues.join(' ')).toContain('with no reason');
  // The drop never counted, so the blanket zero is still unaccounted for.
  expect(verdict.issues).toHaveLength(2);
});

test('a keyword both kept and dropped is rejected', async () => {
  const verdict = await validate(
    [
      {
        url: CONTRACT_STORY[0]!.url,
        score: 5,
        matched_keywords: ['breach'],
        dropped_keywords: [{ keyword: 'breach', reason: 'a contract dispute' }],
        evidence: 'in breach of its enterprise support contract',
      },
    ],
    CONTRACT_STORY
  );

  expect(verdict.status).toBe('rejected');
  expect(verdict.issues.join(' ')).toContain('both matched_keywords and dropped_keywords');
});

test('a drop of a keyword that is not literally present is rejected', async () => {
  const verdict = await validate(
    [
      {
        url: CONTRACT_STORY[0]!.url,
        score: 0,
        matched_keywords: [],
        dropped_keywords: [
          { keyword: 'breach', reason: 'a contract dispute' },
          { keyword: 'ransomware', reason: 'not in this story at all' },
        ],
        evidence: '',
      },
    ],
    CONTRACT_STORY
  );

  expect(verdict.status).toBe('rejected');
  expect(verdict.issues.join(' ')).toContain('does not appear in the title or summary');
});

test('a partial batch that declares its one drop reports no unclaimed keyword', async () => {
  const verdict = await validate([
    {
      url: ARTICLES[0]!.url,
      score: 17,
      matched_keywords: ['supply-chain attack', 'credentials leaked'],
      dropped_keywords: [
        { keyword: 'exfiltrate', reason: 'describes the same leak already counted' },
      ],
      evidence: 'Terabytes of credentials leaked',
    },
    {
      url: ARTICLES[1]!.url,
      score: 13,
      matched_keywords: ['active exploitation', 'vulnerability'],
      evidence: 'under active exploitation',
    },
  ]);

  expect(verdict.status).toBe('approved');
  expect(verdict.summary).not.toContain('unclaimed');
  expect(verdict.summary).toContain('"exfiltrate"');
});
