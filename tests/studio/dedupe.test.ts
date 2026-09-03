import { Database } from 'bun:sqlite';
import { openDb, UNREADABLE_AFTER_ATTEMPTS } from '@/lib/db';
import { DEFAULT_DOMAIN } from '@/lib/domains';
import { cybersecurite } from '@/lib/domains/cybersecurite';
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '../../.studio/scripts/dedupe.ts');

interface Fetched {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
}

// Hydration runs in this stage now (STU-1206) and an article whose page does not
// load is held back rather than scored on its feed summary (STU-1204) — so every
// fixture needs a page that answers. `/page` echoes the article's own summary
// back, which makes hydration a no-op for the tests that are not about it.
let pageRequests = 0;
let flakyRefusals = 1;
let recoveringRefusals = 2;
const pages = Bun.serve({
  port: 0,
  fetch(req) {
    pageRequests++;
    const url = new URL(req.url);
    const html = (body: string) =>
      new Response(`<html><body>${body}</body></html>`, { headers: { 'content-type': 'text/html' } });

    if (url.pathname === '/dead') return new Response('gone', { status: 404 });
    if (url.pathname === '/pdf') return new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } });
    if (url.pathname === '/flaky') {
      if (flakyRefusals-- > 0) return new Response('gone', { status: 503 });
      return html('<p>Their agent exploited 87% of a benchmark of known vulnerability reports.</p>');
    }
    if (url.pathname === '/recovering') {
      if (recoveringRefusals-- > 0) return new Response('gone', { status: 503 });
      return html('<p>Their agent exploited 87% of a benchmark of known vulnerability reports.</p>');
    }
    // The three shapes measured on live pages for STU-1274, all outside <p>: a
    // related-article rail, the author bio, and the tag strip under the body.
    if (url.pathname === '/rail') {
      return new Response(
        '<html><body><article>' +
          '<p>The maintainers shipped a fix after a self-improving agent rewrote its own limits.</p>' +
          '<div class="related"><h3>Related</h3><ul>' +
          '<li><a href="/x">Critical flaw allows remote code execution on 40,000 servers</a></li>' +
          '<li><a href="/y">Ransomware crew leaks hospital records</a></li>' +
          '</ul></div>' +
          '<div class="tags">Zero-day Backdoor Vulnerability Jailbreak</div>' +
          '<div class="bio">Bill covers open-source, malware, data breach incidents and hacks.</div>' +
          '</article></body></html>',
        { headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.pathname === '/no-paragraphs') {
      return new Response(
        '<html><body><div>Their agent exploited a zero-day, with no paragraph in sight.</div></body></html>',
        { headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.pathname === '/chrome') {
      return new Response(
        '<html><head><style>.n{color:red}</style></head><body><nav>Ransomware</nav>' +
          '<p>Their agent exploited 87% of a benchmark of known vulnerability reports.</p></body></html>',
        { headers: { 'content-type': 'text/html' } }
      );
    }
    return html(`<p>${url.searchParams.get('text') ?? ''}</p>`);
  },
});
afterAll(() => pages.stop(true));

const ORIGIN = pages.url.origin;
const page = (path: string, text: string) => `${ORIGIN}${path}?text=${encodeURIComponent(text)}`;

const MAC_SUMMARY = 'Screen-sharing bug lets remote hackers log in without a password.';
const ARTICLE: Fetched = {
  title: 'Vulnerability giving attackers full control of Macs is under active exploitation',
  url: page('/macs-exploit', MAC_SUMMARY),
  source: 'arstechnica',
  publishedAt: '2026-09-01T00:00:00.000Z',
  summary: MAC_SUMMARY,
};

async function runDedupe(dbPath: string, articles: Fetched[] = [ARTICLE]) {
  const proc = Bun.spawn(['bun', SCRIPT], {
    env: { ...process.env, SKYNET_DB: dbPath },
    stdin: new TextEncoder().encode(
      JSON.stringify({ previous_outputs: { fetch: { outputs: [{ articles }] } } })
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  return Object.assign(
    JSON.parse(out) as {
      domain: string;
      keyword_weights: Record<string, number>;
      domain_guidance: string;
      new_count: number;
      seen_count: number;
      stranded_count: number;
      pages_unread: Record<string, number>;
      pages_unreadable: Record<string, number>;
      articles: (Fetched & { candidate_keywords: string[] })[];
    },
    { stderr: err }
  );
}

function withDb(body: (dbPath: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skynet-dedupe-'));
    try {
      await body(join(dir, 'skynet.db'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

// Through `openDb()` rather than a hand-written CREATE TABLE: a second copy of
// the schema here drifted the moment the real one gained a column, and the
// mismatch surfaced as a crash inside the script under test rather than as a
// failing assertion.
function strand(dbPath: string, articles: Fetched[]): void {
  const previous = process.env.SKYNET_DB;
  process.env.SKYNET_DB = dbPath;
  try {
    const db = openDb();
    const insert = db.prepare(
      'INSERT OR IGNORE INTO articles (domain, url, title, source, published_at, summary) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const a of articles) {
      insert.run(DEFAULT_DOMAIN, a.url, a.title, a.source, a.publishedAt, a.summary);
    }
    db.close();
  } finally {
    if (previous === undefined) delete process.env.SKYNET_DB;
    else process.env.SKYNET_DB = previous;
  }
}

// Newest first, so a global newest-first cut would take the busy feed's 40 and
// nothing else. Minute-apart timestamps keep every article's rank unambiguous.
function batch(source: string, count: number, startedAt: string): Fetched[] {
  const start = Date.parse(startedAt);
  return Array.from({ length: count }, (_, i) => ({
    title: `${source} story ${i}`,
    url: page(`/${source.replace(/\W+/g, '-').toLowerCase()}/${i}`, `${source} summary ${i}`),
    source,
    publishedAt: new Date(start - i * 60_000).toISOString(),
    summary: `${source} summary ${i}`,
  }));
}

test(
  'an article inserted but never scored is offered again on the next run',
  withDb(async (dbPath) => {
    expect((await runDedupe(dbPath)).new_count).toBe(1);
    expect((await runDedupe(dbPath)).articles[0]?.url).toBe(ARTICLE.url);
  })
);

test(
  'a scored article is filtered out on the next run',
  withDb(async (dbPath) => {
    await runDedupe(dbPath);
    const db = new Database(dbPath);
    db.query('UPDATE articles SET score = 5, scored_at = ? WHERE url = ?').run(
      new Date().toISOString(),
      ARTICLE.url
    );
    db.close();
    expect((await runDedupe(dbPath)).new_count).toBe(0);
  })
);

test(
  'a stranded row whose feed item has rolled off is still handed to the scorer',
  withDb(async (dbPath) => {
    strand(dbPath, [ARTICLE]);

    // The feed no longer carries it, so nothing but the table can re-present it.
    const out = await runDedupe(dbPath, []);

    expect(out.stranded_count).toBe(1);
    expect(out.new_count).toBe(1);
    expect(out.articles).toEqual([
      { ...ARTICLE, candidate_keywords: ['active exploitation', 'vulnerability'] },
    ]);
  })
);

test(
  'a stranded row still in the feed is one candidate, not two',
  withDb(async (dbPath) => {
    strand(dbPath, [ARTICLE]);

    const out = await runDedupe(dbPath, [ARTICLE]);

    expect(out.articles.map((a) => a.url)).toEqual([ARTICLE.url]);
    expect(out.new_count).toBe(1);
  })
);

test(
  'the backlog is carried oldest-first and drains within a bounded number of runs',
  withDb(async (dbPath) => {
    const backlog = Array.from({ length: 30 }, (_, i) => ({
      ...ARTICLE,
      title: `Stranded article ${i}`,
      url: page(`/stranded-${i}`, ARTICLE.summary),
    }));
    strand(dbPath, backlog);

    // A run full of fresh news must not push the backlog's tail out of the batch.
    const first = await runDedupe(dbPath, [ARTICLE]);
    expect(first.articles.map((a) => a.url)).toEqual(backlog.slice(0, 25).map((a) => a.url));

    const db = new Database(dbPath);
    db.query('UPDATE articles SET score = 0, scored_at = ? WHERE score IS NULL AND url IN (SELECT url FROM articles WHERE score IS NULL ORDER BY rowid LIMIT 25)').run(
      new Date().toISOString()
    );
    db.close();

    const second = await runDedupe(dbPath, []);
    expect(second.articles.map((a) => a.url)).toEqual(backlog.slice(25).map((a) => a.url));
  })
);

test(
  'a burst on one feed does not push an older feed out of the batch',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [
      ...batch('TechCrunch AI', 40, '2026-09-01T12:00:00.000Z'),
      ...batch('Ars Technica', 20, '2026-08-20T12:00:00.000Z'),
    ]);

    expect(out.new_count).toBe(25);
    const bySource = (source: string) => out.articles.filter((a) => a.source === source).length;
    expect(bySource('Ars Technica')).toBe(12);
    expect(bySource('TechCrunch AI')).toBe(13);
  })
);

test(
  'the cap is still filled when only one feed has anything to offer',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, batch('TechCrunch AI', 40, '2026-09-01T12:00:00.000Z'));

    expect(out.new_count).toBe(25);
    expect(out.articles[0]?.title).toBe('TechCrunch AI story 0');
  })
);

// The scorer no longer reads the article looking for keywords — it is handed the
// literal matches and decides which of them describe the article's risk (STU-1212).
test(
  'every article carries the literal keyword matches the validator will recompute',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [
      ARTICLE,
      {
        ...ARTICLE,
        title: 'An AI model quietly rewrote its own weights',
        url: page('/self-improving', 'Researchers describe a self-improving system that resisted a shutdown.'),
        summary: 'Researchers describe a self-improving system that resisted a shutdown.',
      },
    ]);

    expect(out.articles.map((a) => a.candidate_keywords)).toEqual([
      ['active exploitation', 'vulnerability'],
      ['self-improving'],
    ]);
  })
);

// The scorer's prompt no longer carries a weight table, so this output is the
// only place it can learn what the keywords are worth (STU-1213).
test(
  'the batch carries the domain, its weights and its scoring guidance',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath);

    expect(out.domain).toBe(DEFAULT_DOMAIN);
    expect(out.keyword_weights).toEqual(cybersecurite.keywords);
    expect(out.domain_guidance).toBe(cybersecurite.guidance);
  })
);

test(
  'an article with no literal match carries an empty candidate list',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [
      {
        ...ARTICLE,
        title: 'A chatbot wrote a sonnet about lawn care',
        url: page('/sonnet', 'No risk vocabulary anywhere in this one.'),
        summary: 'No risk vocabulary anywhere in this one.',
      },
    ]);

    expect(out.articles[0]?.candidate_keywords).toEqual([]);
  })
);


const BOILERPLATE = 'Article URL: http://example.com Comments URL: https://news.ycombinator.com/item?id=1';
const linked = (path: string): Fetched => ({ ...ARTICLE, url: `${ORIGIN}${path}`, summary: BOILERPLATE });

test(
  'a fresh article is scored against its linked page, not its feed summary',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [linked('/chrome')]);

    expect(out.articles[0]?.summary).toContain('exploited 87%');
    // Chrome is stripped, so a nav item cannot lend the page a keyword it never used.
    expect(out.articles[0]?.summary).not.toContain('Ransomware');
    expect(out.articles[0]?.summary).not.toContain('color:red');
    expect(out.pages_unread).toEqual({});
  })
);

// The whole reason hydration moved here: `fetch` pulls ~110 items a sweep and a
// publisher holds an item for days, so hydrating before the seen-index filter
// re-fetched the same page every hour for as long as it stayed in the window.
test(
  'an article already scored costs no page request',
  withDb(async (dbPath) => {
    const before = pageRequests;
    await runDedupe(dbPath, [ARTICLE]);
    expect(pageRequests - before).toBe(1);

    const db = new Database(dbPath);
    db.query('UPDATE articles SET score = 5, scored_at = ? WHERE url = ?').run(
      new Date().toISOString(),
      ARTICLE.url
    );
    db.close();

    const second = await runDedupe(dbPath, [ARTICLE]);
    expect(second.new_count).toBe(0);
    expect(pageRequests - before).toBe(1);
  })
);

// The stored summary is the hydrated one, so a row re-offered from the backlog
// is scored on its page text without paying a second request.
test(
  'a stranded row keeps its page text and is not re-fetched',
  withDb(async (dbPath) => {
    const before = pageRequests;
    await runDedupe(dbPath, [ARTICLE]);
    expect(pageRequests - before).toBe(1);

    const second = await runDedupe(dbPath, []);
    expect(second.stranded_count).toBe(1);
    expect(second.articles[0]?.summary).toBe(ARTICLE.summary);
    expect(pageRequests - before).toBe(1);
  })
);

// Scoring the feed summary instead is what made a one-minute outage permanent:
// hnrss boilerplate scores 0, `aggregate` writes that 0, and the URL joins the
// `score IS NOT NULL` seen-index for good.
test(
  'an article whose linked page does not answer is held back, not scored on boilerplate',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [linked('/dead')]);

    expect(out.articles).toEqual([]);
    expect(out.new_count).toBe(0);
    expect(out.pages_unread).toEqual({ arstechnica: 1 });
    expect(out.stderr).toContain('dedupe loaded 0 of 1 linked pages');
  })
);

// Held back means never seen, so nothing has to remember it: the next sweep
// pulls the same item off the feed and tries the page again.
test(
  'a held-back article is offered again, and scored on its page once it answers',
  withDb(async (dbPath) => {
    const article = linked('/flaky');

    const first = await runDedupe(dbPath, [article]);
    expect(first.articles).toEqual([]);

    // Nothing was inserted, so the seen-index cannot have swallowed it.
    const db = new Database(dbPath);
    expect(db.query('SELECT COUNT(*) n FROM articles').get()).toEqual({ n: 0 });
    db.close();

    const second = await runDedupe(dbPath, [article]);
    expect(second.articles[0]?.url).toBe(article.url);
    expect(second.articles[0]?.summary).toContain('exploited 87%');
    expect(second.pages_unread).toEqual({});
  })
);

// HN links PDFs regularly. The body stays the same readable page, so the
// content-type check is the only thing that can keep it out of the summary —
// drop that check and this is the test that notices.
test(
  'a linked page that is not HTML is held back too',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [linked('/pdf')]);

    expect(out.articles).toEqual([]);
    expect(out.pages_unread).toEqual({ arstechnica: 1 });
  })
);

// One unreadable page must cost its own article and nothing else.
test(
  'a batch that loses one page still scores the rest',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [ARTICLE, { ...linked('/dead'), title: 'A dead page' }]);

    expect(out.articles.map((a) => a.url)).toEqual([ARTICLE.url]);
    expect(out.pages_unread).toEqual({ arstechnica: 1 });
    expect(out.stderr).toContain('dedupe loaded 1 of 2 linked pages');
  })
);


// STU-1271: a page that will never load — HN links PDFs constantly — was retried
// every sweep until its item rolled off, and left no trace of having been lost.
test(
  'a page refused several sweeps running is given up on and counted',
  withDb(async (dbPath) => {
    const article = linked('/dead');
    const before = pageRequests;

    for (let i = 0; i < UNREADABLE_AFTER_ATTEMPTS; i++) {
      const out = await runDedupe(dbPath, [article]);
      expect(out.pages_unread).toEqual({ arstechnica: 1 });
      expect(out.pages_unreadable).toEqual({});
    }
    expect(pageRequests - before).toBe(UNREADABLE_AFTER_ATTEMPTS);

    const out = await runDedupe(dbPath, [article]);
    expect(out.pages_unreadable).toEqual({ arstechnica: 1 });
    expect(out.pages_unread).toEqual({});
    expect(out.articles).toEqual([]);
    // The point of giving up: it stops paying for a link it has established is dead.
    expect(pageRequests - before).toBe(UNREADABLE_AFTER_ATTEMPTS);
    expect(out.stderr).toContain(`refused ${UNREADABLE_AFTER_ATTEMPTS}+ sweeps running`);
  })
);

// The count has to survive the run, or it is the container log again.
test(
  'the refusals are recorded per page and readable afterwards',
  withDb(async (dbPath) => {
    const article = linked('/dead');
    await runDedupe(dbPath, [article]);
    await runDedupe(dbPath, [article]);

    const db = new Database(dbPath);
    const row = db
      .query<{ url: string; source: string; attempts: number }, []>(
        'SELECT url, source, attempts FROM unread_pages'
      )
      .get();
    db.close();
    expect(row).toEqual({ url: article.url, source: 'arstechnica', attempts: 2 });
  })
);

// A transient failure must not accumulate toward being given up on: the run of
// refusals ends the moment the page answers.
test(
  'a page that answers again clears its record of refusals',
  withDb(async (dbPath) => {
    const article = linked('/recovering');
    await runDedupe(dbPath, [article]);
    await runDedupe(dbPath, [article]);
    const out = await runDedupe(dbPath, [article]);

    expect(out.articles[0]?.summary).toContain('exploited 87%');

    const db = new Database(dbPath);
    const rows = db.query<{ url: string }, []>('SELECT url FROM unread_pages').all();
    db.close();
    expect(rows).toEqual([]);
  })
);

// STU-1274: stripping chrome left the rails publishers put *inside* the body. A
// related-article list carries the whole keyword table, so an article picked up
// weight from the stories it merely sat next to — and the validator agreed,
// because it re-reads the same contaminated text.
// A neutral title, so what the assertions see comes from the page rather than from
// the headline — `candidate_keywords` is scanned over both.
const railed = (path: string) => ({
  ...linked(path),
  title: 'A quiet headline with no scoring vocabulary in it',
});

test(
  'keywords from the related-links rail, the tag strip and the author bio are not scored',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [railed('/rail')]);

    // The one keyword that is actually in the article's prose.
    expect(out.articles[0]?.candidate_keywords).toEqual(['self-improving']);
    // Present in the markup, absent from the prose, and each one measured leaking
    // on a real page: the rail, the tag strip, the bio.
    for (const leaked of ['remote code execution', 'ransomware', 'zero-day', 'backdoor', 'breach']) {
      expect(out.articles[0]?.candidate_keywords).not.toContain(leaked);
    }
  })
);

// The prose still has to survive the cut — a filter that drops the article too is
// not a fix.
test(
  'the article’s own paragraphs are what reaches the scorer',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [railed('/rail')]);

    expect(out.articles[0]?.summary).toContain('rewrote its own limits');
    expect(out.articles[0]?.summary).not.toContain('Related');
  })
);

// Measured on 35 live pages, none lacked paragraphs — but a publisher can change,
// and the failure has to be the safe one: held back and retried, like a page that
// did not load, rather than scored on whatever else the markup held.
test(
  'a page with no paragraph at all is held back rather than scored on its markup',
  withDb(async (dbPath) => {
    const out = await runDedupe(dbPath, [railed('/no-paragraphs')]);

    expect(out.articles).toEqual([]);
    expect(out.pages_unread).toEqual({ arstechnica: 1 });
  })
);
