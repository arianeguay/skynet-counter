# skynet-counter

A Studio pipeline scores AI-risk news against a closed keyword list and writes a 0–100
counter to SQLite; the Next.js app reads that snapshot and never triggers a run.
[README.md](README.md) has the setup, the commands and the counter formula — this file
has what to know before changing anything.

## Pipeline

[.studio/pipelines/skynet-counter.pipeline.yaml](.studio/pipelines/skynet-counter.pipeline.yaml)
is the whole flow.

| Step | Executor | Where it lives |
|---|---|---|
| `fetch` (parallel group ×3) | script | [.studio/scripts/fetch-feed.ts](.studio/scripts/fetch-feed.ts) |
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

A fetch stage never throws. A parallel group reports `failed` the moment one stage
fails — `on_failure: collect-all` only keeps the siblings running — so one publisher's
502 would take the whole sweep down. A dead feed emits an empty batch with the reason
instead.

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
4. `.studio/invariants.md` — it states how large the list is

## The database

`data/skynet.db`, overridable with `SKYNET_DB`. `openDb()` in
[src/lib/db.ts](src/lib/db.ts) creates the schema on open; there are no migrations, so a
column added there reaches fresh databases only and an existing file keeps its old shape.

`articles` is the full history and doubles as the dedupe index — a URL in the table is
never offered to the scorer again. `counter` is a single row, recomputed from `articles`
on every run and never asserted by a stage. The frontend only calls `readSnapshot()`.

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
- **live reads of the three feeds.** A fixture proves the parser; it never proves what
  the publishers are actually emitting today.
- **accumulated history in `data/skynet.db`.** Anything that depends on weeks of scored
  articles — counter calibration, decay behaviour — cannot be shown against an empty
  file.
- Docker, systemd and deployment changes.

Worked examples: STU-1170 (the validator never looks for keywords the scorer left out)
is `claude:web` — the fix is a pure script and a `bun test` settles it. STU-1171
(calibrate `BASE`, `HALF_LIFE_DAYS`, `DIVISOR`) is `claude:local` — the constants are
editable anywhere, but the only proof is a real sweep over real scored history.

Host-specific deployment notes for the live site live in the gitignored
`CLAUDE.local.md`, not here.
