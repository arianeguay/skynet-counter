import { expect, test } from 'bun:test';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'validate-scores.ts');

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

interface Verdict {
  status: string;
  summary: string;
  issues: string[];
}

async function validate(scored: unknown[]): Promise<Verdict> {
  const proc = Bun.spawn(['bun', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        previous_outputs: { dedupe: { articles: ARTICLES }, score: { articles: scored } },
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
