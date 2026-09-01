import { parseFeed, hydrateSummaries, readInput, emit, USER_AGENT, type RawArticle } from './rss.ts';

const { source, url } = await readInput();
if (!source || !url) throw new Error(`Feed item is missing source or url: ${JSON.stringify({ source, url })}`);

// A dead feed emits an empty batch rather than throwing. `on_item_failure:
// collect-all` keeps the siblings running, but a throw here still costs this
// feed its whole batch over one publisher's 502. The error rides along in the
// output instead, where dedupe simply finds no articles.
let articles: RawArticle[] = [];
let error: string | null = null;
let hydrationFailures = 0;

try {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) {
    articles = parseFeed(await res.text(), source).slice(0, 40);
    ({ articles, failed: hydrationFailures } = await hydrateSummaries(articles));
    if (hydrationFailures) {
      const loaded = `${source} loaded ${articles.length - hydrationFailures} of ${articles.length} linked pages`;
      // Losing every page leaves the batch scored on its boilerplate summaries
      // — the structural zero hydration exists to remove, from a feed that
      // fetched fine. Raising it as the feed's error is what puts it in
      // `feed_health` next to a 404 instead of leaving it silent.
      if (hydrationFailures === articles.length) error = loaded;
      else process.stderr.write(`${loaded}\n`);
    }
  } else {
    error = `${source} responded ${res.status}`;
  }
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

if (error) process.stderr.write(`${source}: ${error}\n`);
emit({ source, count: articles.length, error, hydration_failures: hydrationFailures, articles });
