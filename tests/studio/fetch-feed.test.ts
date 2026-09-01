import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SCRIPT = new URL('../../.studio/scripts/fetch-feed.ts', import.meta.url).pathname;

async function runFetch(additional_context: string) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    stdin: new TextEncoder().encode(JSON.stringify({ additional_context })),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

const BOILERPLATE = 'Article URL: http://example.com Comments URL: https://news.ycombinator.com/item?id=1';

// hnrss's shape: no article text in the description, everything in the link.
// `post` overrides where that link points, to stand in for a dead page.
function serveFeed(post?: string) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/post') {
        return new Response(
          '<html><head><style>.n{color:red}</style></head><body>' +
            '<nav>Ransomware</nav>' +
            '<p>Their agent exploited 87% of a benchmark of known vulnerability reports.</p>' +
            '</body></html>',
          { headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response(
        `<rss><channel><item><title>Just the rumour of a bug</title>` +
          `<link>${post ?? `${url.origin}/post`}</link>` +
          `<description>${BOILERPLATE}</description></item></channel></rss>`,
        { headers: { 'content-type': 'application/rss+xml' } }
      );
    },
  });
}

async function summaryFor(hydrate: boolean, post?: string) {
  const feed = serveFeed(post);
  try {
    const { out } = await runFetch(
      `source: Hacker News\nurl: ${feed.url.origin}/feed\n` + (hydrate ? 'hydrate: true\n' : '')
    );
    const [first] = (JSON.parse(out) as { articles: { summary: string }[] }).articles;
    return first?.summary ?? '';
  } finally {
    feed.stop(true);
  }
}

// The engine YAML-dumps a map item into `additional_context` rather than handing
// the script its input, so these are the exact bytes fetch-feed.ts has to read.
test('reads source and url out of the engine dump, quoted or not', async () => {
  const { code, out } = await runFetch("source: 'AI: The Newsletter'\nurl: http://127.0.0.1:1/feed\n");
  expect(code).toBe(0);
  const result = JSON.parse(out) as { source: string; count: number; error: string | null };
  expect(result.source).toBe('AI: The Newsletter');
  expect(result.count).toBe(0);
  expect(result.error).not.toBeNull();
});

// Hacker News is the feed the flag exists for; losing it there restores the
// structural zero this whole path was added to fix, silently.
test('the Hacker News feed is the one flagged for hydration', () => {
  const input = readFileSync('.studio/inputs/default.input.yaml', 'utf8');
  const flagged = [...input.matchAll(/^ {2}- source: (.+)\n(?: {4}.+\n)*? {4}hydrate: true$/gm)];
  expect(flagged.map((m) => m[1])).toEqual(['Hacker News']);
});

test('hydrate: true scores the linked page instead of the boilerplate summary', async () => {
  const summary = await summaryFor(true);
  expect(summary).toContain('exploited 87%');
  // Chrome is stripped, so a nav item cannot lend the page a keyword it never used.
  expect(summary).not.toContain('Ransomware');
  expect(summary).not.toContain('color:red');
});

test('without the flag a feed pays for no extra request', async () => {
  expect(await summaryFor(false)).toBe(BOILERPLATE);
});

// Hydration is best-effort: a dead link must cost the article its page text, not
// its row. Failing back to the feed summary is exactly today's behaviour.
test('a linked page that does not answer leaves the feed summary in place', async () => {
  expect(await summaryFor(true, 'http://127.0.0.1:1/post')).toBe(BOILERPLATE);
});

test('every feed the input declares carries a source and a url', () => {
  const input = readFileSync('.studio/inputs/default.input.yaml', 'utf8');
  const feeds = [...input.matchAll(/^ {2}- source: (.+)\n {4}url: (\S+)$/gm)];
  expect(feeds.length).toBe(5);
  expect(new Set(feeds.map((m) => m[1])).size).toBe(5);
});
