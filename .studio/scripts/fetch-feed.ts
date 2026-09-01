import { parseFeed, readContext, emit, type RawArticle } from './rss.ts';

const FEEDS: Record<string, { source: string; url: string }> = {
  'fetch-techcrunch': {
    source: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  },
  'fetch-arstechnica': {
    source: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
  },
  'fetch-hn': {
    source: 'Hacker News',
    url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+agent+OR+exploit&points=80',
  },
};

const ctx = await readContext<{ stage_name?: string }>();
const feed = ctx.stage_name ? FEEDS[ctx.stage_name] : undefined;
if (!feed) throw new Error(`No feed configured for stage '${ctx.stage_name}'`);

const res = await fetch(feed.url, {
  headers: { 'user-agent': 'skynet-counter/0.1 (+https://github.com/arianeguay)' },
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) throw new Error(`${feed.source} responded ${res.status}`);

const articles: RawArticle[] = parseFeed(await res.text(), feed.source).slice(0, 40);
emit({ source: feed.source, count: articles.length, articles });
