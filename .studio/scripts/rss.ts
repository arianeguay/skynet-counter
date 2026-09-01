export interface RawArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
}

const TAG = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m?.[1] ? decode(m[1]) : '';
};

// A malformed feed can carry an out-of-range entity; decoding it would throw
// RangeError and take the fetch stage down over one bad character.
function codePoint(n: number, fallback: string): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback;
}

export function decode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => codePoint(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec) => codePoint(Number(dec), m))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Atom puts the URL in an attribute, RSS in element text.
function linkOf(block: string): string {
  const href = block.match(/<link[^>]*href="([^"]+)"/i);
  if (href?.[1]) return href[1];
  return TAG(block, 'link');
}

function dateOf(block: string): string {
  const raw = TAG(block, 'pubDate') || TAG(block, 'updated') || TAG(block, 'published');
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

export function parseFeed(xml: string, source: string): RawArticle[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const articles: RawArticle[] = [];
  for (const block of blocks) {
    const url = linkOf(block);
    const title = TAG(block, 'title');
    if (!url || !title) continue;
    articles.push({
      title,
      url,
      source,
      publishedAt: dateOf(block),
      summary: (TAG(block, 'description') || TAG(block, 'summary') || TAG(block, 'content')).slice(0, 600),
    });
  }
  return articles;
}

export interface Hydration {
  articles: RawArticle[];
  failed: number;
}

export const USER_AGENT = 'skynet-counter/0.1 (+https://skynet-counter.com)';

// Chrome carries no article text but plenty of keywords — a "Vulnerabilities"
// nav item would score every page on the site.
const CHROME = /<(script|style|noscript|nav|header|footer|aside|svg)[\s\S]*?<\/\1>/gi;
const PAGE_TEXT_LIMIT = 4000;

async function pageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return '';
  return decode((await res.text()).replace(CHROME, ' ')).slice(0, PAGE_TEXT_LIMIT);
}

// Every feed is hydrated, because measuring all five on 2026-09-01 found none
// that scores as well off its summary as off the linked page — the gain ranged
// from 3.3x the score sum on the mildest feed to a structural zero becoming 5 of
// 20 on hnrss, whose `<description>` is the same "Article URL / Comments URL /
// Points" boilerplate every time. The cost is one request per item per sweep.
// Failure keeps the feed's own summary, so a feed is never worse off for it.
// It is worse off than it looks, though: falling back leaves the article scored
// on boilerplate, which is the structural zero hydration exists to remove — so
// the fallbacks are counted rather than swallowed.
export async function hydrateSummaries(articles: RawArticle[]): Promise<Hydration> {
  const hydrated = await Promise.all(
    articles.map(async (a) => {
      try {
        const text = await pageText(a.url);
        return text ? { ...a, summary: text } : null;
      } catch {
        return null;
      }
    })
  );
  return {
    articles: hydrated.map((a, i) => a ?? articles[i]!),
    failed: hydrated.filter((a) => a === null).length,
  };
}

export async function readContext<T>(): Promise<T> {
  return JSON.parse(await Bun.stdin.text()) as T;
}

export function emit(output: unknown): void {
  process.stdout.write(JSON.stringify(output));
}

// `context.include: [input]` does not hand a script its pipeline input — the
// engine YAML-dumps it into `additional_context` first. A map stage's items are
// flat string maps, so one `key: value` line per field is the whole document;
// js-yaml single-quotes a value only when a plain scalar would be ambiguous.
export async function readInput(): Promise<Record<string, string>> {
  const { additional_context = '' } = await readContext<{ additional_context?: string }>();
  return Object.fromEntries(
    additional_context.split('\n').filter(Boolean).map((line) => {
      const at = line.indexOf(': ');
      const value = line.slice(at + 2);
      const quoted = value.match(/^'(.*)'$/);
      return [line.slice(0, at), quoted ? quoted[1].replaceAll("''", "'") : value];
    })
  );
}
