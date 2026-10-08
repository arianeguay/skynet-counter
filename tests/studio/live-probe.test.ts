import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../scripts/live-probe.ts', import.meta.url).pathname;

// Two feeds standing in for two publishers. Every item links to a page on this
// server, so hydration runs for real: the feed's own description says nothing,
// and only the page's <p> carries the terms, the way hnrss looks.
const PAGES: Record<string, string> = {
  '/a1': '<p>One developer used AI to ship a clean-room rewrite of the editor.</p>',
  '/a2': '<p>The AI model produced a drop-in replacement in a weekend.</p>',
  '/a3': '<p>An AI lab announced a new model.</p>',
  '/b1': '<p>A clean-room port, written with AI, reached feature parity.</p>',
  // Off-subject: carries a candidate but never names AI, so the gate drops it.
  '/b2': '<p>A clean-room kitchen renovation finished early.</p>',
};

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname, origin } = new URL(req.url);
    if (pathname === '/dead.xml') return new Response('gone', { status: 404 });
    if (pathname === '/pdf') return new Response('%PDF', { headers: { 'content-type': 'application/pdf' } });
    if (pathname.endsWith('.xml')) {
      const prefix = pathname === '/a.xml' ? 'a' : 'b';
      const links = Object.keys(PAGES).filter((p) => p.startsWith(`/${prefix}`));
      if (prefix === 'b') links.push('/pdf');
      const items = links
        .map((p) => `<item><title>Item ${p}</title><link>${origin}${p}</link><description>Points: 9</description></item>`)
        .join('');
      return new Response(`<rss><channel>${items}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
    }
    const body = PAGES[pathname];
    if (!body) return new Response('missing', { status: 404 });
    return new Response(`<html><body><nav>clean-room</nav>${body}</body></html>`, { headers: { 'content-type': 'text/html' } });
  },
});
afterAll(() => server.stop());

function files(feeds: string, candidates: string) {
  const dir = mkdtempSync(join(tmpdir(), 'skynet-live-probe-'));
  writeFileSync(join(dir, 'feeds'), feeds);
  writeFileSync(join(dir, 'candidates'), candidates);
  return { feeds: join(dir, 'feeds'), candidates: join(dir, 'candidates') };
}

async function probe(args: string[]) {
  const proc = Bun.spawn(['bun', SCRIPT, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

function row(out: string, first: string): string[] {
  const line = out.split('\n').find((l) => l.trimStart().startsWith(`${first} `));
  if (!line) throw new Error(`no row for ${first} in:\n${out}`);
  return line.trim().split(/\s{2,}/);
}

const origin = () => `http://localhost:${server.port}`;

test('counts terms over hydrated, gated pages and reports where the signal comes from', async () => {
  const f = files(
    `# a comment\n${origin()}/a.xml Feed A\n${origin()}/b.xml Feed B\n${origin()}/dead.xml Dead Feed\n`,
    'clean-room\ndrop-in replacement\nfeature parity\nsingle developer\nAI\n'
  );
  const { code, out } = await probe(['--feeds', f.feeds, '--candidates', f.candidates]);
  expect(code).toBe(0);
  // A dead feed is reported and skipped; the PDF is a page that cannot be read.
  expect(out).toContain('Dead Feed: responded 404');
  expect(out).toContain('6 items from 3 feeds, 5 pages read, 1 unread');
  expect(out).toContain('the AI gate holds back 1 of 5');
  // `clean-room` in the <nav> of every page is chrome, not prose: only the two
  // on-subject paragraphs carrying it count.
  expect(row(out, 'clean-room')).toEqual(['clean-room', '2', '50%', 'BEAT']);
  expect(row(out, 'drop-in replacement')).toEqual(['drop-in replacement', '1', '25%']);
  expect(row(out, 'single developer')).toEqual(['single developer', '0', '0%', 'DEAD']);
  // BEAT and DEAD terms are left out of the source split, so it reads where the
  // story-marking terms land: one article each from A and B.
  expect(row(out, 'Feed A')).toEqual(['Feed A', '3', '1', '50%']);
  expect(row(out, 'Feed B')).toEqual(['Feed B', '1', '1', '50%']);
});

test('one source holding most of the signal is flagged', async () => {
  const f = files(`${origin()}/a.xml Feed A\n${origin()}/b.xml Feed B\n`, 'weekend\nhonda\n');
  const { out } = await probe(['--feeds', f.feeds, '--candidates', f.candidates]);
  expect(row(out, 'Feed A')).toEqual(['Feed A', '3', '1', '100%', 'CONCENTRATED']);
});

test('--no-gate keeps the off-subject page', async () => {
  const f = files(`${origin()}/b.xml Feed B\n`, 'clean-room\n');
  const { out } = await probe(['--feeds', f.feeds, '--candidates', f.candidates, '--no-gate']);
  expect(out).not.toContain('AI gate');
  expect(row(out, 'clean-room')).toEqual(['clean-room', '2', '100%', 'BEAT']);
});

test('without feeds or terms it refuses rather than printing an empty table', async () => {
  expect((await probe([])).code).toBe(2);
});
