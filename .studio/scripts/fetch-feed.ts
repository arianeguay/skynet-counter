import { parseFeed, hydrateSummaries, readInput, emit, USER_AGENT, type RawArticle } from './rss.ts';

const { source, url, hydrate } = await readInput();
if (!source || !url) throw new Error(`Feed item is missing source or url: ${JSON.stringify({ source, url })}`);

// A dead feed emits an empty batch rather than throwing. `on_item_failure:
// collect-all` keeps the siblings running, but a throw here still costs this
// feed its whole batch over one publisher's 502. The error rides along in the
// output instead, where dedupe simply finds no articles.
let articles: RawArticle[] = [];
let error: string | null = null;

try {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) {
    articles = parseFeed(await res.text(), source).slice(0, 40);
    if (hydrate === 'true') articles = await hydrateSummaries(articles);
  } else {
    error = `${source} responded ${res.status}`;
  }
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

if (error) process.stderr.write(`${source}: ${error}\n`);
emit({ source, count: articles.length, error, articles });
