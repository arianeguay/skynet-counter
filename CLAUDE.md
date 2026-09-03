# skynet-counter

A Studio pipeline scores AI-risk news against a closed keyword list and writes a 0–100
counter to SQLite; the Next.js app reads that snapshot and never triggers a run.
[README.md](README.md) has the setup, the commands and the counter formula — this file
has what to know before changing anything.

Issues live in the [skynet-counter Linear project](https://linear.app/studioag/project/skynet-counter-1866aa1101c8/overview);
every issue for this repo belongs in it.

## Pipeline

[.studio/pipelines/skynet-counter.pipeline.yaml](.studio/pipelines/skynet-counter.pipeline.yaml)
is the whole flow.

| Step | Executor | Where it lives |
|---|---|---|
| `fetch` (map over `input.feeds`) | script, one child run per feed | [.studio/pipelines/fetch-feed.pipeline.yaml](.studio/pipelines/fetch-feed.pipeline.yaml), [.studio/scripts/fetch-feed.ts](.studio/scripts/fetch-feed.ts) |
| `dedupe` | script | [.studio/scripts/dedupe.ts](.studio/scripts/dedupe.ts) |
| `scoring` (group, 3 iterations) | agent + script | [.studio/agents/scorer.agent.yaml](.studio/agents/scorer.agent.yaml), [.studio/scripts/validate-scores.ts](.studio/scripts/validate-scores.ts) |
| `aggregate` | script | [.studio/scripts/aggregate.ts](.studio/scripts/aggregate.ts) |

One stage calls a model: `score`. `validate-scores` is a script that recomputes every
score from the keyword table and checks each claimed keyword appears literally in the
article — deliberately not a second model, because a script cannot be talked into
approving a score. A rejection restarts the `scoring` group with the issue list as
feedback, up to three iterations.

The scorer is handed its keywords rather than asked to find them: `dedupe` attaches
`candidate_keywords` to every article it emits, from the same `matchedKeywords()`
scan the validator runs, and the prompt's whole job is to keep or drop each one.
Making the model do that scan itself — 24 keywords over 4000 characters of hydrated
page text per article, 25 articles — is what had the group rejecting on its first
iteration nearly every sweep, at full price each time (STU-1212). The validator does
not read the field; it recomputes from the domain's own module, so handing the list
over costs nothing in traceability.

The scoring group is skipped when `dedupe` finds nothing new
(`condition: stages.dedupe.output.new_count > 0`), so most hourly sweeps cost zero
tokens. Making that group run unconditionally is a cost regression, not a cleanup.

### Adding a feed

Add two lines to `feeds:` in `.studio/inputs/<domain>.input.yaml` —
[cybersecurite](.studio/inputs/cybersecurite.input.yaml) or
[environment](.studio/inputs/environment.input.yaml). Nothing else: `fetch` is a map stage
over that list, so a domain's feed table lives in exactly one place. It used to live
in two — five near-identical stages whose names had to match a table in
`fetch-feed.ts` — and every hourly sweep failed the once they diverged (STU-1191).

Every feed is scored against its linked page rather than its RSS summary. That is
unconditional, and there is no per-feed opt-out: measuring all five feeds on 2026-09-01
(STU-1200) found the summary worse everywhere, from 3.3x on the mildest feed to hnrss,
whose "Article URL / Comments URL / Points" boilerplate scores a structural zero
(STU-1192). A feed added later that should *not* be hydrated needs the flag put back,
not a threshold — Ars Technica's summaries run 9-15 words, the same range as HN's
boilerplate, so no word count separates them.

Only the article's **paragraphs** are scored. Stripping `nav`/`header`/`footer`/`aside`
removes site chrome but leaves the rails publishers put *inside* the body, and those
carry the keyword table without describing the article: measured over 35 live pages,
BleepingComputer's author bio ("covering ... data breach incidents") scored `breach` on
every article by that writer, a tag strip supplied `remote code execution`, and The
Hacker News' category label above the body supplied `vulnerability` (STU-1274).

The cut is `<p>` rather than a list of class names — those differ per publisher and
change without notice, while prose is in paragraphs and rails are links and headings.
It cost nothing on that sample: no page lost its article, and the only matches it
removed were those three. A page with no `<p>` yields nothing and is held back like one
that failed to load, so a publisher that stops using paragraphs shows up in that feed's
`pages_unread` rather than silently scoring its markup.

**`dedupe` does the hydrating, not `fetch`.** It runs after the seen-index filter and
the `MAX_PER_RUN` cap, so a page is fetched once rather than once an hour for as long
as its item stays in the publisher's window — `fetch` pulls ~110 items a sweep and all
but a handful are already scored (STU-1206). The hydrated text is what gets stored, so
a row re-offered from the backlog needs no second fetch.

A fetch run never throws on a dead feed; it emits an empty batch with the reason instead,
and `on_item_failure: collect-all` keeps the other feeds' runs going.

Hydration fails differently. A linked page that does not answer, or is not HTML, **holds
its article back** rather than letting it through on the feed summary — that summary is
hnrss boilerplate, so scoring it writes a 0, and the URL then joins the `score IS NOT NULL`
seen-index for good. A one-minute outage cost an article its score permanently (STU-1204).
Held back means never inserted, so the next sweep pulls the same item off the feed and
tries the page again.

`unread_pages` is what stops that retry being forever. It counts refusals per URL, and
after `UNREADABLE_AFTER_ATTEMPTS` `dedupe` stops asking — HN links PDFs constantly and
`pageText` refuses a non-HTML response by design, so the same dead link was being fetched
every hour until its item rolled off, with nothing recording that the article was lost
(STU-1271). A page that answers again clears its row, so a transient failure never
accumulates toward being given up on.

`dedupe` emits both counts per feed — `pages_unread` for what it tried and lost,
`pages_unreadable` for what it has stopped trying — and writes a line to stderr for each.

A map child does **not** receive its input as an object. The engine YAML-dumps the item
into `additional_context`, so `fetch-feed.ts` reads it back through `readInput()` in
`rss.ts` rather than `readContext()`.

`dedupe` reads `stages.fetch.output.outputs` — a map stage propagates one collected
output (`{ total, succeeded, failed, resumed, results[], outputs[] }`), not one output
per feed.

[.studio/invariants.md](.studio/invariants.md) is injected into every agent's system
prompt automatically; it is the place for a rule the scorer must obey, not a comment.

### Script stage protocol

A script stage reads its context as JSON on **stdin** and writes its contract output as
JSON on **stdout** (`readContext` / `emit` in
[.studio/scripts/rss.ts](.studio/scripts/rss.ts)). Stdout *is* the contract: a stray
`console.log` corrupts the stage output and fails validation. Log to stderr, the way
`fetch-feed.ts` reports a dead feed.

Script stages declare `runtime: node` but import `bun:sqlite`, so `STUDIO_NODE_BIN` must
point at the bun binary or every one of them dies on that import. The same reason puts
`bun --bun` in front of every Next.js script in `package.json`.

### Where a test file goes

`src` tests sit next to the code they cover; **script tests live in
[tests/studio/](tests/studio/), not beside the script**, the scheduler's live in
[tests/docker/](tests/docker/), and **widget tests live in
[tests/widgets/](tests/widgets/)** — Übersicht loads every `.jsx` in its widget
directory as a widget, so a test beside `skynet-counter.jsx` installs as a second,
broken one. That test is a `.jsx` rather than a `.tsx` on purpose: `tsconfig.json`
sets `allowJs: false` and includes only `.ts`/`.tsx`, so a typed test importing the
untyped widget fails `bun run typecheck`. A component test renders with
`renderToStaticMarkup` from `react-dom/server` and asserts on the markup — there is no
DOM testing library here, and a presentational server component needs none. Bun's test discovery never
descends into dot-directories, so a `.test.ts` under `.studio/` is skipped in silence —
`bun test` reports the remaining files green and exits 0. A test placed there does not
fail, it disappears.

## Domains

A domain is the unit the whole pipeline is partitioned by: its own feeds, its own
keyword table, its own scoring guidance, its own divisor, its own rows and its own
counter. `SKYNET_DOMAIN` tells a sweep which one it is running; unset means
`DEFAULT_DOMAIN`, and an unknown slug throws rather than falling back, because a typo
that silently swept into an unread domain would look exactly like a counter that
stopped moving.

Config lives in two places, and the split is forced rather than chosen:

- **`src/lib/domains/<slug>.ts`** — keyword weights, `guidance`, `divisor`, label. One
  file per domain; `domains/index.ts` is the registry that lists them.
- **`.studio/inputs/<slug>.input.yaml`** — the feed list, and only the feed list. The
  `fetch` map stage fans out over `input.feeds`, and Studio reads YAML, not TypeScript.

Do not mirror the feed list into the domain module. Two copies that have to agree is
what STU-1191 already cost a sweep.

Adding a domain is: a module under `src/lib/domains/`, an entry in its `DOMAINS`
array, an input file named for the slug. Nothing in `db.ts`, `dedupe.ts`,
`aggregate.ts` or the frontend needs touching — the scripts read `currentDomain()`
and the site reads the registry.

### Routes

`/<slug>` is the counter, `src/app/[domaine]/page.tsx`, and `/` redirects to
`DEFAULT_DOMAIN` rather than being a second copy of it. A slug no module defines is a
404: an unknown domain rendering an empty gauge would publish 0, which is what a quiet
week looks like.

That route must stay `force-dynamic` and must **not** gain a `generateStaticParams`.
Adding one makes Next prerender each domain at build time, so the site serves the
counter as it stood when the image was built — and a frozen counter looks exactly like
a working one until someone reads the timestamp. `page.test.tsx` asserts the export.

[DomainNav](src/components/DomainNav.tsx) is driven by `DOMAINS` and renders nothing
below two domains, so it stays out of the way until there is something to switch to and
needs no edit when there is.

A slug is a published URL, so renaming one leaves the old path answering: `RETIRED_SLUGS`
in [next.config.ts](next.config.ts) maps it to the new one as a permanent redirect.
`ecologie` -> `environment` is the entry that exists, from the rename that put the tabs
in English. [next.config.test.ts](next.config.test.ts) holds the two ways that table goes
wrong — a retired slug that is *also* registered shadows a real counter, and one pointing
at a domain that does not exist redirects into a 404.

Renaming a slug is never only a redirect, because the slug is also the `domain`
column's value: the rows keep the old one, and since every read filters on the new one
they go **invisible** rather than wrong — no error, just a counter that has forgotten
its history. `renameRetiredDomains()` in [db.ts](src/lib/db.ts) moves them across all
four domain-keyed tables. It and `RETIRED_SLUGS` in `next.config.ts` are the two halves
of one rename and are edited together.

### The schedule

[docker/run-loop.sh](docker/run-loop.sh) is the only scheduler — no cron, no systemd
timer. `SKYNET_SCHEDULE` is `slug:seconds` pairs, and each domain keeps its next-due
timestamp under `/data/schedule` so a container bounce does not re-sweep everything at
once.

The domains sweep **in turn, in one container**, not one container each. That is a
deliberate trade: four concurrent sweeps would be four `claude` sessions sharing one
login through a read-write `~/.claude` mount, refreshing the same token against each
other, and four scoring stages billing at the same moment. Taking turns gives that up
in exchange for losing process isolation, so both ways a domain could hold up another
are closed inside the loop instead — a failing sweep cannot stop it, and a hanging one
is bounded by `SWEEP_TIMEOUT`. Splitting into a service per domain means solving the
shared-credential problem first.

The loop refuses to start without `SKYNET_SCHEDULE` rather than defaulting to a slug:
a default in shell is a second copy of `DEFAULT_DOMAIN` that cannot be read from
TypeScript, and a stale one would sweep a domain nothing serves.
[tests/docker/run-loop.test.ts](tests/docker/run-loop.test.ts) drives the script with a
stub `studio` on PATH, so the cadence is provable without Docker or a paid run.

### Picking a domain's keywords

Both tables were picked by measuring, and the écologie one is why the method is
written down: the words that first suggest themselves are the worst ones.

A keyword earns its place by marking a *story*, not a *subject*. "zero-day" appears
in cybersecurity writing when something happened; "emissions" appears in climate
writing always. A list built from the second kind scored 66% of a 70-article sample
and pinned the gauge at 100 on every divisor — so `emissions`, `data center`,
`fossil fuel` and `cooling` are deliberately absent from
[environment.ts](src/lib/domains/environment.ts), and
[its test](src/lib/domains/environment.test.ts) fails if one comes back.

Repeat the probe before adding a domain or a feed: fetch the candidates, hydrate them
the way `dedupe` does, run `matchedKeywords` over the result and read the per-keyword
hit counts. A keyword firing on 40%+ of articles is measuring the beat. A keyword
firing zero times is dead weight, and a table of those is a counter stuck at its
floor.

### Direction, and why it is the scorer's call

A keyword names a thing going wrong, and an article can be about that thing being
fixed. "Reducing on-site water usage" and "the best protection yet against account
takeovers" both matched and both scored, which is the counter reading vocabulary
rather than direction (STU-1277).

The obvious deterministic fix — reject a match with a mitigation word just before it —
was measured against the live corpus and is **wrong**. Eight of 70 scored articles had
one within five words of a kept keyword, and only two were genuinely about a remedy. A
vulnerability that was silently mitigated was still a vulnerability; refusing to pay a
ransom is still a ransomware story. Suppressing on that signal would have cost six real
incidents to catch two false ones — and those six are the stories the counter exists
for.

So direction is rule 2's job, named explicitly in the prompt and in each domain's
`guidance`. The discriminator is not the phrase but the article: *is it reporting the
problem, or the remedy?*

`mitigatedMatches()` in [keywords.ts](src/lib/keywords.ts) keeps the measurement
useful without acting on it — `validate-scores` emits a note listing kept keywords that
read as mitigated, so a wrong judgement shows up in the run log instead of being
silent. It reports and must never reject;
[mitigation.test.ts](src/lib/mitigation.test.ts) holds all eight measured cases,
including the six that must still score.

### Why there is no domotique domain

Measured on 2026-09-02 (STU-1217). The domain fails differently from the ones that
work: the incident vocabulary exists and matches fine, but no feed publishes
home-automation incidents.

Against smart-home-proper sources — the Home Assistant blog, an HN smart-home filter
and The Verge's smart home feed — vocabulary naming a device in a house going wrong
scored **0.0 per day**. Thirteen of fifteen such keywords were dead across 80
articles: `bricked`, `cloud shutdown`, `default credentials`, `always listening`,
`camera feed`, `no longer receive updates`, `end of life`, `recall`. That press is
product press. It reviews, announces and prices; it does not report incidents.

Widening to general security feeds does produce signal, and the signal is wrong. The
top scorers were SonicWall SMA 1000, Switchvox, Langflow and a WordPress backup
plugin — a second cybersecurity counter, which is the trap the issue names when it
warns off feeds that will score for the wrong reason.

The one feed carrying device-security vocabulary at volume is **CISA's ICS
advisories**: 17.5 score/day, 8 of 12 sampled articles scoring, on real device
findings. But they are *industrial* — Rockwell Automation, Mitsubishi CNC, embedded
radio modules. A counter built on them and labelled domotique would be an advisory
feed wearing a label about someone's house.

So the counter ships without domotique. The version that would work is a differently
named domain — connected-device or industrial-control advisories — which is a change
to what the site claims to measure, not a keyword list to tune.

Two things found while measuring, worth not rediscovering: `staceyoniot.com/feed`
parses fine but its newest item is over three years old, and
`theverge.com/smart-home/rss/index.xml` 404s while
`theverge.com/rss/smart-home/index.xml` works.

### Why there is no design domain

Measured on 2026-09-02 against 89 hydrated articles from eight live design and
frontend feeds — Smashing Magazine, CSS-Tricks, A List Apart, NN/g, UX Collective,
web.dev, Chrome Developers, and an HN filter (STU-1219).

A broad list scores the wrong things. Its top result was NN/g's *Artificial
Intelligence: Glossary* at 36 points, because a glossary page contains the whole
vocabulary by definition, and Chrome's *WebMCP origin trial* and *agent-ready
toolkit* announcements at 8 each. A tight list scores nothing: the displacement
vocabulary the domain would need — "replaces designers", "text to design", "prompt
to app", "without a designer" — fires **zero** times in 89 articles, leaving 2 hits,
one of which is that same glossary.

There is no setting in between, and that is not a tuning failure. In cybersecurity
"zero-day" appears in stories *about incidents* and rarely elsewhere, so its presence
carries severity. In design "ai-generated" and "agentic" appear in any story *about
the topic*, so their presence carries subject matter and nothing more. Keyword
weighting measures severity only where the vocabulary is incident vocabulary, and
design has no incident genre to supply one.

Redefining risk for the domain is the other fork, and it costs more than it looks.
Scoring on judgement rather than literal matches gives up the property that makes the
counter worth publishing — that `validate-scores` can recompute every score from a
closed table without asking a model. Scoring *velocity* instead of severity is
deterministic and would work, but it makes the same gauge mean "how dangerous" on one
route and "how fast is the ground moving" on another.

So the counter ships without design. Reopen this with a mechanism, not a longer
keyword list: a list is the thing that was measured and found not to separate.

### The keyword table

Each domain's table lives in its own module and the matcher in
[src/lib/keywords.ts](src/lib/keywords.ts) is handed one rather than importing a
global. The matcher flattens punctuation and matches on substring, so inflections and
hyphen variants land on the same keyword.

The scorer's prompt used to carry a **hand-maintained second copy** of the table. It
does not any more, and must not grow one back: the prompt is one static file shared by
every domain, so a copy there would be four tables to keep in step instead of one.
`dedupe` emits `keyword_weights` and `domain_guidance` in its output and the prompt
reads them from there. The validator still recomputes from the domain module and never
from that output, so a batch cannot be approved by trusting what it was handed.

Changing a keyword or a weight means editing, in this order:

1. `src/lib/domains/<slug>.ts` — the only copy that decides anything
2. `README.md` — the published weights table, for the cybersecurity domain

## The database

`data/skynet.db`, overridable with `SKYNET_DB`. `openDb()` in
[src/lib/db.ts](src/lib/db.ts) creates the schema on open.

Every table is keyed by `domain` first: `articles` and `unread_pages` on
`(domain, url)`, `feed_sweeps` on `(domain, source, swept_at)`, `counter` on `domain`
alone. Every read takes a domain and every write supplies one — a query that forgets it
pools four domains into one number.

`articles` is the full history and doubles as the dedupe index, but only its *scored*
rows: a URL with a score is never offered again, and a row left with `score IS NULL` is
the scorer's backlog. `dedupe` carries that backlog back into its own output ahead of
the fresh batch, oldest first, and the `MAX_PER_RUN` cap applies to the two together.
That is what keeps a row from sitting unscored forever once its feed item rolls off the
publisher's window — re-offering only what `fetch` pulled recovers a missed article for
a few days and then loses it. A stranded row is invisible to `readSnapshot()`, which
filters on `score IS NOT NULL`, and absent from the counter's decayed sum, so it costs
the number as well as the log. `counter` is one row per domain, recomputed from
`articles` on every run and never asserted by a stage. The frontend only calls
`readSnapshot(domain)`.

The formula itself lives in [src/lib/counter.ts](src/lib/counter.ts), not in
`aggregate.ts`, so [scripts/calibrate.ts](scripts/calibrate.ts) and the tests can reach
it without running a stage. The decay is `0.5 ** (age / HALF_LIFE_DAYS)` — it used to be
`Math.exp(-age / HALF_LIFE_DAYS)`, which is an e-folding time that halves at 4.85 days,
so the constant decayed risk 44% faster than its own name and both docs claimed
(STU-1211). Changing the constants means editing that file and re-running
`bun run calibrate` against a real corpus, never guessing.

Calibrate against the harness's **steady-state** grid, not its stored-corpus grid. A
database whose history came out of RSS windows is half-empty for weeks — the windows
run from two days (hnrss) to two months (Krebs), so most days inside the horizon hold
only the sparse tail of the slow feeds. The stored corpus read 26 on 2026-09-01 where
the steady state reads 41, and `DIVISOR` picked off the first number is 2x too small.
The projection measures each feed over its own window and sums them, which is why
`calibrate` prints a per-feed rate rather than one articles/day for the corpus
(STU-1171).

`feed_sweeps` is **one row per source per sweep** — the fetch outcome and the number of
linked pages `dedupe` could not read — and it is where a feed that stops contributing
becomes visible; nothing else in the run reports one, since `fetch-feed.ts` deliberately
does not throw. It replaced a `feed_health` table holding one row per source, because a
feed that fails 23 hours out of 24 never holds a day-old failure and so was invisible to
anything that only knew the current state (STU-1207). `readFeedErrors()` derives both
shapes from it: the length of the trailing run of failures, and the failure ratio over
the last 24 hours.

Rows are pruned past `SWEEP_RETENTION_DAYS`, and dropped outright for a source no longer
in the input list — deleting a feed while it fails is the likely reason to delete it
(STU-1198).

State goes in a new table, never a column on an old one: `CREATE TABLE IF NOT EXISTS`
reaches an existing database while `ADD COLUMN` would not. Retiring a table is the
mirror image — `openDb()` drops `feed_health` on open, which costs nothing because every
row of it was rewritten each sweep anyway.

`openDb()` carries two exceptions, and they are the same shape: rows that already
exist, whose only copy is the live volume, needing to be relabelled rather than
replaced. `renameRetiredDomains()` is the smaller — it moves a domain's rows when its
slug is renamed, guarded on the old slug still being present so it is one write once
rather than a write lock taken on every page render.

`migrateToDomains()` is the larger, and the reason it had to exist is worth knowing
before writing a third. Partitioning by domain does not add state; it labels
rows that already exist, and the only copy of those rows is the volume behind the live
counter. A new table would have left the old history unlabelled and every read joining
two shapes. It is guarded on `articles.domain` existing, so it runs once and is a no-op
on a fresh database, and [db.test.ts](src/lib/db.test.ts) seeds the exact pre-domain
schema to prove it. Reach for that pattern only when the rows to change are already
there and irreplaceable; otherwise the rule above still holds.

`openDb()` reads `SKYNET_DB` **per call**, not once at import. It used to capture it at
module load, which meant whichever file imported `db.ts` first decided the path for the
whole process — adding an unrelated import to a component moved another suite's database
onto `data/skynet.db`.

The file is gitignored. The history that matters — the one behind the live counter —
exists only on the host serving the site, never in a checkout.

## The desktop widget

[widgets/ubersicht/skynet-counter.jsx](widgets/ubersicht/skynet-counter.jsx) is a
single file loaded straight off disk by Übersicht — there is no bundler, so it
cannot import anything from `src/`. That constraint decides what it may copy.

The gauge geometry is copied out of [Gauge.tsx](src/components/Gauge.tsx), and that
is fine: it is a dial drawing, and a drift shows up as a wrong-looking needle rather
than a wrong number. Thresholds and scores are not fine, which is why
`/api/skynet/summary` serves `status` instead of letting the widget recompute it —
`statusLine` lives in [counter.ts](src/lib/counter.ts) rather than in `CounterHero`
so a server route can reach it, since that component is `'use client'`.

`/api/skynet/summary` is the only route that sets `access-control-allow-origin`: a
widget fetches from a `file://` document and sends `Origin: null`. It exists at all
because `readSnapshot()` reads 40 articles and parses each one's keyword JSON, which
is the wrong shape for a caller polling on a timer for one number — hence
`readCounter()` beside it in [db.ts](src/lib/db.ts).

## Where a Task Runs

An issue is `claude:web` when it can be **both changed and verified** in a Claude Code
web sandbox. Every file here is writable on the web, so the label is decided by the
proof, not the edit.

**`claude:web` — `bun test` and `bun run typecheck` are the whole proof:**

- the keyword tables, the matcher and the score maths (`src/lib/domains/`,
  `src/lib/keywords.ts`)
- the schema, its domain migration and the per-domain reads (`src/lib/db.ts`)
- the validator (`.studio/scripts/validate-scores.ts`) — pure over fixtures
- the dedupe filter and the aggregation maths — both run against a throwaway file via
  `SKYNET_DB=/tmp/x.db`
- feed parsing (`.studio/scripts/rss.ts`) against saved XML
- the Next.js page, the components and `/api/skynet`
- the desktop widget — `tests/widgets/` renders it with `renderToStaticMarkup` and
  asserts on the markup, so the bands, the needle geometry and the failure paths are
  provable without a Mac or Übersicht anywhere near it
- the sweep scheduler's *logic* — `tests/docker/run-loop.test.ts` runs
  `docker/run-loop.sh` against a stub `studio` on PATH, so cadence, failure isolation
  and restart behaviour need neither Docker nor a paid run

**`claude:local` — anything whose proof is a real `studio run`:**

- **the `claude` CLI session.** The `claude-code` provider spawns the CLI and rides
  whatever login it has. There is no API key, so there is nothing to hand a sandbox.
- **live reads of the feeds.** A fixture proves the parser; it never proves what
  the publishers are actually emitting today.
- **accumulated history in `data/skynet.db`.** Anything that depends on weeks of scored
  articles — counter calibration, decay behaviour — cannot be shown against an empty
  file.
- the Dockerfile, the compose topology, systemd units and anything else whose proof is
  the container actually starting. The scheduler is the split worth noting: its logic is
  above, but "does the image still build and run this" is not.

Worked examples: STU-1170 (the validator never looks for keywords the scorer left out)
is `claude:web` — the fix is a pure script and a `bun test` settles it. STU-1171
(calibrate `BASE`, `HALF_LIFE_DAYS`, `DIVISOR`) is `claude:local` — the constants are
editable anywhere, but the only proof is a real sweep over real scored history.

### Dependencies in a worktree

Every task runs in its own git worktree, and `node_modules/` is gitignored, so it exists
only in the checkout where `bun install` ran. In a fresh worktree it is absent, so
`bun test` dies on `Cannot find module 'bun:test'` and `bun run typecheck` on
`tsc: not found` — the two commands this section calls the whole proof report a missing
install, not a broken change. Either fixes it:

```bash
bun install                                     # install into the worktree, or
ln -s /path/to/skynet-counter/node_modules .    # borrow the main checkout's
```

`.gitignore` ignores `node_modules` **without a trailing slash**, so it covers that
symlink as well as a real directory. Git does not treat a symlink pointing at a directory
as a directory, so `node_modules/` would match nothing and `git add -A` would stage the
link — committing one machine's absolute path to `main`. Do not put the slash back.

Host-specific deployment notes for the live site live in the gitignored
`CLAUDE.local.md`, not here.
