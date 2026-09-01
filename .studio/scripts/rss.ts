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

export async function readContext<T>(): Promise<T> {
  return JSON.parse(await Bun.stdin.text()) as T;
}

export function emit(output: unknown): void {
  process.stdout.write(JSON.stringify(output));
}
