import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DOMAINS } from '@/lib/domains';

const SCRIPT = new URL('../../.studio/scripts/fetch-feed.ts', import.meta.url).pathname;

async function runFetch(additional_context: string) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    stdin: new TextEncoder().encode(JSON.stringify({ additional_context })),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { code: await proc.exited, out, err };
}

const BOILERPLATE = 'Article URL: http://example.com Comments URL: https://news.ycombinator.com/item?id=1';

// hnrss's shape: no article text in the description, everything in the link.
// `post` overrides where that link points, to stand in for a dead page;
// `postType` overrides what it answers with, to stand in for a link that is
// not a web page at all. `secondPost` adds a second item, so a batch can fail
// its links in part rather than wholesale.
function serveFeed(post?: string, postType = 'text/html', secondPost?: string, onPost?: () => void) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/post') {
        onPost?.();
        return new Response(
          '<html><head><style>.n{color:red}</style></head><body>' +
            '<nav>Ransomware</nav>' +
            '<p>Their agent exploited 87% of a benchmark of known vulnerability reports.</p>' +
            '</body></html>',
          { headers: { 'content-type': postType } }
        );
      }
      const item = (title: string, link: string) =>
        `<item><title>${title}</title><link>${link}</link>` +
        `<description>${BOILERPLATE}</description></item>`;
      return new Response(
        `<rss><channel>` +
          item('Just the rumour of a bug', post ?? `${url.origin}/post`) +
          (secondPost ? item('A second rumour', secondPost) : '') +
          `</channel></rss>`,
        { headers: { 'content-type': 'application/rss+xml' } }
      );
    },
  });
}

interface FetchOutput {
  error: string | null;
  articles: { summary: string }[];
}

async function fetchFrom(post?: string, postType?: string, secondPost?: string) {
  const feed = serveFeed(post, postType, secondPost);
  try {
    const { out, err } = await runFetch(`source: Hacker News\nurl: ${feed.url.origin}/feed\n`);
    return { output: JSON.parse(out) as FetchOutput, err };
  } finally {
    feed.stop(true);
  }
}

async function summaryFor(post?: string, postType?: string) {
  const { output } = await fetchFrom(post, postType);
  return output.articles[0]?.summary ?? '';
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

// The linked page is `dedupe`'s job now, so this stage must hand on the feed's
// own summary untouched — and must not have paid a request for the page. Both
// hydration coverage and the request-count proof live in dedupe.test.ts.
test('the feed summary is emitted without reading the linked page', async () => {
  let postRequests = 0;
  const feed = serveFeed(undefined, undefined, undefined, () => postRequests++);
  try {
    const { out, err } = await runFetch(`source: Hacker News\nurl: ${feed.url.origin}/feed\n`);
    const output = JSON.parse(out) as FetchOutput;
    expect(output.articles[0]?.summary).toBe(BOILERPLATE);
    expect(postRequests).toBe(0);
    expect(err).toBe('');
  } finally {
    feed.stop(true);
  }
});

test.each(DOMAINS)('every feed $slug declares carries a source and a url', ({ slug }) => {
  const input = readFileSync(`.studio/inputs/${slug}.input.yaml`, 'utf8');
  const declared = [...input.matchAll(/^ {2}- source: (.+)$/gm)].map((m) => m[1]!);
  const paired = [...input.matchAll(/^ {2}- source: (.+)\n {4}url: (\S+)$/gm)];
  expect(paired.length).toBe(declared.length);
  expect(new Set(declared).size).toBe(declared.length);
});
