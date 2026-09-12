// The AIID trend page's ongoing ingestion, run weekly by `docker/run-loop.sh`
// rather than hourly like the gauge feeds: this data doesn't need that
// freshness, and reusing the Studio fetch/dedupe/score pipeline for a number
// that needs no LLM would mean paying for a scoring stage on every poll.
//
// AIID's GraphQL API is origin-gated, so this reads their public RSS feed
// instead: one item per *report*, not per incident (a single incident can
// gain several reports in one feed). `<description>` ends with a citation like
// `(https://incidentdatabase.ai/cite/1684#7927)`, and it's the incident id in
// that citation, not the RSS item itself, that decides whether this is a new
// row.
//
// Known, accepted imprecision: a newly-discovered incident is stored with the
// *report's* pubDate, not AIID's own incident date (unreachable without the
// gated API or a second page fetch per incident). This only affects incidents
// first seen between sync runs (everything the backfill loaded keeps its
// exact date), and it is absorbed by the same trailing holdback window that
// already exists for "the current year reads low while reporting catches up",
// so it never surfaces as a number the chart claims is exact.
import { openDb } from '@/lib/db';
import { extractCiteIncidentId } from '@/lib/aiid';
import { USER_AGENT, TAG } from '../.studio/scripts/rss';

const RSS_URL = 'https://incidentdatabase.ai/rss.xml';

function die(message: string): never {
  console.error(`aiid-sync: ${message}`);
  process.exit(1);
}

interface FeedItem {
  title: string;
  description: string;
  pubDate: string;
}

// Deliberately not `.studio/scripts/rss.ts`'s `parseFeed`: that truncates the
// description to 600 characters for the scorer's benefit, and AIID's citation
// can sit past that cut on a longer report blurb.
function parseItems(xml: string): FeedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return blocks.map((block) => ({
    title: TAG(block, 'title'),
    description: TAG(block, 'description'),
    pubDate: TAG(block, 'pubDate'),
  }));
}

function isoDateOf(pubDate: string): string {
  const parsed = pubDate ? new Date(pubDate) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

const res = await fetch(RSS_URL, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
if (!res.ok) die(`${RSS_URL} responded ${res.status}`);

const items = parseItems(await res.text());
if (items.length === 0) die('parsed zero items from the feed, feed format may have changed');

const db = openDb();
try {
  const known = new Set(
    db.query<{ incident_id: number }, []>('SELECT incident_id FROM aiid_incidents').all().map((r) => r.incident_id)
  );
  const insert = db.prepare(
    'INSERT INTO aiid_incidents (incident_id, date, title, ingested_at) VALUES (?, ?, ?, ?)'
  );
  const now = new Date().toISOString();

  let added = 0;
  db.transaction(() => {
    for (const item of items) {
      const incidentId = extractCiteIncidentId(item.description);
      if (incidentId === null || known.has(incidentId)) continue;
      insert.run(incidentId, isoDateOf(item.pubDate), item.title, now);
      known.add(incidentId);
      added++;
    }
  })();

  console.log(`aiid-sync: ${items.length} report(s) in the feed, ${added} new incident(s) added`);
} finally {
  db.close();
}
