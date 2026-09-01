import { parseFeed, readContext, emit, type RawArticle } from './rss.ts';

const FEEDS: Record<string, { source: string; url: string }> = {
  'fetch-arstechnica-security': {
    source: 'Ars Technica Security',
    url: 'https://feeds.arstechnica.com/arstechnica/security',
  },
  'fetch-arstechnica-ai': {
    source: 'Ars Technica AI',
    url: 'https://arstechnica.com/ai/feed',
  },
  'fetch-thehackernews': {
    source: 'The Hacker News',
    url: 'https://thehackernews.com/feeds/posts/default',
  },
  'fetch-krebs': {
    source: 'Krebs on Security',
    url: 'https://krebsonsecurity.com/feed/',
  },
  'fetch-hn': {
    source: 'Hacker News',
    url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+agent+OR+exploit&points=80',
  },
};

const ctx = await readContext<{ stage_name?: string }>();
const feed = ctx.stage_name ? FEEDS[ctx.stage_name] : undefined;
if (!feed) throw new Error(`No feed configured for stage '${ctx.stage_name}'`);

// A dead feed emits an empty batch rather than throwing. A parallel group
// reports `failed` as soon as one stage fails — `on_failure: collect-all` only
// keeps the siblings running — so a throw here takes the whole hourly sweep
// down over one publisher's 502. The error rides along in the output instead.
let articles: RawArticle[] = [];
let error: string | null = null;

try {
  const res = await fetch(feed.url, {
    headers: { 'user-agent': 'skynet-counter/0.1 (+https://skynet-counter.com)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) {
    articles = parseFeed(await res.text(), feed.source).slice(0, 40);
  } else {
    error = `${feed.source} responded ${res.status}`;
  }
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

if (error) process.stderr.write(`${feed.source}: ${error}\n`);
emit({ source: feed.source, count: articles.length, error, articles });
