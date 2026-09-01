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

test('every feed the input declares carries a source and a url', () => {
  const input = readFileSync('.studio/inputs/default.input.yaml', 'utf8');
  const feeds = [...input.matchAll(/^ {2}- source: (.+)\n {4}url: (\S+)$/gm)];
  expect(feeds.length).toBe(5);
  expect(new Set(feeds.map((m) => m[1])).size).toBe(5);
});
