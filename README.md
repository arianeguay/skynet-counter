# Skynet Counter

A 0–100 gauge of how close the AI news cycle is to sounding like a Skynet origin
story. A Studio pipeline scrapes three feeds, scores what is new against a closed
list of weighted keywords, and writes the result to SQLite. The Next.js frontend
only reads that — it never triggers a run.

```
feeds ──▶ studio pipeline ──▶ data/skynet.db ──▶ Next.js (page + /api/skynet)
```

## Requirements

- [Bun](https://bun.sh) 1.2+
- [Studio](https://github.com/studio-foundation/studio) 0.17.0+ (`studio --version`)
- The [Claude Code](https://claude.com/claude-code) CLI, logged in (`claude`)

No API key. The pipeline uses Studio's `claude-code` provider, which spawns the
`claude` CLI and rides whatever session it is already authenticated with.

## Setup

```bash
bun install
cp .studio/config.example.yaml .studio/config.yaml
export STUDIO_NODE_BIN="$(command -v bun)"
studio doctor          # checks the version, the config, bun and claude
```

`STUDIO_NODE_BIN` is not optional. The script stages declare `runtime: node` because
that is the runtime Studio knows about, but they import `bun:sqlite` — without the
override Studio spawns `node` and every script stage dies on the import.

## Run the pipeline manually

```bash
studio run skynet-counter --input-file .studio/inputs/default.input.yaml
studio run skynet-counter --input-file .studio/inputs/default.input.yaml --live   # stream stages
studio status                                                                     # last run
studio logs <run-id>
```

The first run scores everything the feeds return; later runs only score what the
dedupe stage has not seen before. When it finds nothing new the scoring group is
skipped outright (`condition: stages.dedupe.output.new_count > 0`) and the run costs
zero tokens — which is most runs on an hourly schedule.

## Run the frontend

```bash
bun dev              # http://localhost:3000
```

`bun dev`, `bun run build` and `bun start` all go through `bun --bun` so the API
route can import `bun:sqlite`. Running them under Node will fail at that import.

## Pipeline shape

| Stage | Executor | What it does |
|---|---|---|
| `fetch` (parallel group) | script ×3 | One fetcher per feed — TechCrunch AI, Ars Technica, HN. `collect-all`, so one dead feed does not fail the run. |
| `dedupe` | script | Drops anything already in SQLite, by URL and by normalized title over the last 100 articles. Caps the run at 25 new articles. |
| `scoring` (group, 3 iterations) | claude-code + script | `score` applies the weighted keywords; `validate-scores` recomputes every score and checks each claimed keyword literally appears in the article. A mismatch rejects the group and `score` retries with the issues as feedback. |
| `aggregate` | script | Persists the scores, recomputes the counter, writes the snapshot. |

**Anti-theatre:** the validator is a script, not a second model. It cannot be talked
into approving a score, and a keyword the scorer invented fails on a substring check.

**The counter:** `12 + Σ(score × e^(−age_days / 7)) / 8`, clamped to 0–100, over the
last 30 days. The 7-day half-life is what makes radio silence walk the number back
down to the floor on its own — there is no separate decay rule to keep in sync.

## Scheduling

Studio has no scheduler. Two ways to give it one:

**Docker (self-contained, the default):**

```bash
docker compose up -d
```

The `pipeline` service loops `studio run` every `PIPELINE_INTERVAL` seconds (default
3600), sharing the `skynet-data` volume with `web`. A failed sweep logs and waits for
the next tick rather than taking the container down.

It bind-mounts `~/.claude` so the containerised `claude` inherits the host login —
there is no headless way to authenticate it otherwise. Log in on the host first
(`claude`), and expect the mount to be the thing that breaks if runs start failing
with an auth error.

**systemd timer (host-run, no idle container):**

```ini
# ~/.config/systemd/user/skynet-counter.service
[Service]
Type=oneshot
WorkingDirectory=%h/skynet-counter
Environment=STUDIO_NODE_BIN=%h/.bun/bin/bun
ExecStart=%h/.bun/bin/studio run skynet-counter --input-file .studio/inputs/default.input.yaml
```

```ini
# ~/.config/systemd/user/skynet-counter.timer
[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now skynet-counter.timer
```

## API

`GET /api/skynet` — the last snapshot, never a fresh run:

```json
{
  "counter": 23.4,
  "updatedAt": "2026-08-31T18:00:00.000Z",
  "articles": [
    { "title": "…", "url": "…", "source": "Ars Technica", "date": "…", "score": 20,
      "keywords": ["sandbox escape", "zero-day"], "evidence": "…" }
  ]
}
```

## Keyword weights

Defined once in [src/lib/keywords.ts](src/lib/keywords.ts) and consumed by both the
validator and the agent prompt. Change them there.

| Keyword | Weight | | Keyword | Weight |
|---|---|---|---|---|
| loss of control | 15 | | zero-day | 8 |
| self-replicating | 15 | | autonomous agent | 6 |
| shutdown resistance | 14 | | breach | 5 |
| sandbox escape | 12 | | agentic | 4 |
| privilege escalation | 9 | | | |

## License

[AGPL-3.0-or-later](LICENSE). Same as [Studio](https://github.com/studio-foundation/studio),
which this pipeline runs on.
