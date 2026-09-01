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

The scoring group is skipped when `dedupe` finds nothing new
(`condition: stages.dedupe.output.new_count > 0`), so most hourly sweeps cost zero
tokens. Making that group run unconditionally is a cost regression, not a cleanup.

### Adding a feed

Add two lines to `feeds:` in
[.studio/inputs/default.input.yaml](.studio/inputs/default.input.yaml). Nothing else:
`fetch` is a map stage over that list, so the feed table lives in exactly one place.
It used to live in two — five near-identical stages whose names had to match a table in
`fetch-feed.ts` — and every hourly sweep failed the once they diverged (STU-1191).

A third line, `hydrate: true`, is for a feed that ships no article text — hnrss puts only
"Article URL / Comments URL / Points" in every `<description>`, so matching title-and-summary
matches the title alone and the feed scores a structural zero (STU-1192). The stage then
reads each linked page and scores that text instead, at one request per item. It is a
per-feed flag and not a thin-summary heuristic because Ars Technica's summaries run 9-15
words, the same range as HN's boilerplate — no threshold separates them.

A fetch run never throws on a dead feed; it emits an empty batch with the reason instead,
and `on_item_failure: collect-all` keeps the other feeds' runs going. Hydration follows the
same rule: a linked page that does not answer, or is not HTML, keeps the feed's own summary.
Falling back is counted, not swallowed — `hydration_failures` rides out on the fetch output,
a partial loss goes to stderr, and losing every page becomes the feed's `error`, because a
batch scored on boilerplate is the structural zero hydration exists to remove.

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
[tests/studio/](tests/studio/), not beside the script**. Bun's test discovery never
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

`feed_health` is one row per source, written by `aggregate` from the `fetch` outputs,
and it is where a dead feed — or a hydrated feed whose linked pages all fail — becomes
visible; nothing else in the run reports one, since `fetch-feed.ts` deliberately does not
throw. It is a table rather than a column on
`counter` because `openDb()` has no migrations: `CREATE TABLE IF NOT EXISTS` reaches an
existing database, `ADD COLUMN` would have needed a hand-run `ALTER` on the live volume.
Add state here the same way — a new table, never a column on an old one.

The file is gitignored. The history that matters — the one behind the live counter —
exists only on the host serving the site, never in a checkout.

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

**`claude:local` — anything whose proof is a real `studio run`:**

- **the `claude` CLI session.** The `claude-code` provider spawns the CLI and rides
  whatever login it has. There is no API key, so there is nothing to hand a sandbox.
- **live reads of the five feeds.** A fixture proves the parser; it never proves what
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
