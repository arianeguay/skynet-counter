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
not read the field; it recomputes from `keywords.ts`, so handing the list over costs
nothing in traceability.

The scoring group is skipped when `dedupe` finds nothing new
(`condition: stages.dedupe.output.new_count > 0`), so most hourly sweeps cost zero
tokens. Making that group run unconditionally is a cost regression, not a cleanup.

### Adding a feed

Add two lines to `feeds:` in
[.studio/inputs/default.input.yaml](.studio/inputs/default.input.yaml). Nothing else:
`fetch` is a map stage over that list, so the feed table lives in exactly one place.
It used to live in two — five near-identical stages whose names had to match a table in
`fetch-feed.ts` — and every hourly sweep failed the once they diverged (STU-1191).

Every feed is scored against its linked page rather than its RSS summary. That is
unconditional, and there is no per-feed opt-out: measuring all five feeds on 2026-09-01
(STU-1200) found the summary worse everywhere, from 3.3x on the mildest feed to hnrss,
whose "Article URL / Comments URL / Points" boilerplate scores a structural zero
(STU-1192). A feed added later that should *not* be hydrated needs the flag put back,
not a threshold — Ars Technica's summaries run 9-15 words, the same range as HN's
boilerplate, so no word count separates them.

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
[tests/studio/](tests/studio/), not beside the script**, and **widget tests live in
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

## The keyword table

[src/lib/keywords.ts](src/lib/keywords.ts) is the source of truth. The matcher flattens
punctuation and matches on substring, so inflections and hyphen variants land on the
same keyword.

The scorer's system prompt carries a **hand-maintained second copy** of the same table.
It has to: the prompt is static YAML and cannot import TypeScript, and the agent has to
see the weights to compute a score at all. That copy is not authoritative — the
validator scores from `keywords.ts`, so a prompt that drifts produces rejections, not
wrong numbers.

Changing a keyword or a weight means editing, in this order:

1. `src/lib/keywords.ts` — the only copy that decides anything
2. `.studio/agents/scorer.agent.yaml` — the prompt's `KEYWORD WEIGHTS` block
3. `README.md` — the published weights table

## The database

`data/skynet.db`, overridable with `SKYNET_DB`. `openDb()` in
[src/lib/db.ts](src/lib/db.ts) creates the schema on open; there are no migrations, so a
column added there reaches fresh databases only and an existing file keeps its old shape.

`articles` is the full history and doubles as the dedupe index, but only its *scored*
rows: a URL with a score is never offered again, and a row left with `score IS NULL` is
the scorer's backlog. `dedupe` carries that backlog back into its own output ahead of
the fresh batch, oldest first, and the `MAX_PER_RUN` cap applies to the two together.
That is what keeps a row from sitting unscored forever once its feed item rolls off the
publisher's window — re-offering only what `fetch` pulled recovers a missed article for
a few days and then loses it. A stranded row is invisible to `readSnapshot()`, which
filters on `score IS NOT NULL`, and absent from the counter's decayed sum, so it costs
the number as well as the log. `counter` is a single row, recomputed from `articles`
on every run and never asserted by a stage. The frontend only calls `readSnapshot()`.

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

State goes in a new table, never a column on an old one: `openDb()` has no migrations, so
`CREATE TABLE IF NOT EXISTS` reaches an existing database while `ADD COLUMN` would need a
hand-run `ALTER` on the live volume. Retiring a table is the mirror image — `openDb()`
drops `feed_health` on open, which costs nothing because every row of it was rewritten
each sweep anyway.

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

- the keyword table, the matcher and the score maths (`src/lib/keywords.ts`)
- the validator (`.studio/scripts/validate-scores.ts`) — pure over fixtures
- the dedupe filter and the aggregation maths — both run against a throwaway file via
  `SKYNET_DB=/tmp/x.db`
- feed parsing (`.studio/scripts/rss.ts`) against saved XML
- the Next.js page, the components and `/api/skynet`
- the desktop widget — `tests/widgets/` renders it with `renderToStaticMarkup` and
  asserts on the markup, so the bands, the needle geometry and the failure paths are
  provable without a Mac or Übersicht anywhere near it

**`claude:local` — anything whose proof is a real `studio run`:**

- **the `claude` CLI session.** The `claude-code` provider spawns the CLI and rides
  whatever login it has. There is no API key, so there is nothing to hand a sandbox.
- **live reads of the feeds.** A fixture proves the parser; it never proves what
  the publishers are actually emitting today.
- **accumulated history in `data/skynet.db`.** Anything that depends on weeks of scored
  articles — counter calibration, decay behaviour — cannot be shown against an empty
  file.
- Docker, systemd and deployment changes.

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
