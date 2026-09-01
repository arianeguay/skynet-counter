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
| `fetch` (parallel group) | script ×3 | One fetcher per feed — TechCrunch AI, Ars Technica, HN. A feed that errors emits an empty batch with the reason, so one publisher's 502 does not take the sweep down. (A parallel group reports `failed` on any failed stage — `on_failure: collect-all` only keeps the siblings running.) |
| `dedupe` | script | Drops anything already in SQLite, by URL and by normalized title over the last 100 articles. Caps the run at 25 new articles. |
| `scoring` (group, 3 iterations) | claude-code + script | `score` applies the weighted keywords; `validate-scores` recomputes every score and checks each claimed keyword literally appears in the article. A keyword that appears literally but names no real risk is dropped on purpose, and the scorer says so in `dropped_keywords` with a reason — an article whose every literal match is left out silently is rejected. A mismatch rejects the group and `score` retries with the issues as feedback. |
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

> **That mount is your live Claude session, read-write.** The container can use your
> account and the CLI refreshes the token in place, so `docker compose up` means
> trusting this pipeline with it. Read [docker/run-loop.sh](docker/run-loop.sh) and the
> [pipeline stages](.studio/pipelines/skynet-counter.pipeline.yaml) before running it on
> an account you care about — or drop the `${HOME}/.claude` volume and run the pipeline
> on the host with the systemd timer below.

**systemd timer (host-run, no idle container):**

The Docker path writes the Studio config on every start; here you do it once. It is
gitignored and holds no secrets — the `claude-code` provider uses the CLI's own session.
`data/` comes with a clone, but not with a tree that was copied into place.

```bash
cp .studio/config.example.yaml .studio/config.yaml
mkdir -p data
```

```ini
# ~/.config/systemd/user/skynet-counter.service
[Service]
Type=oneshot
WorkingDirectory=%h/skynet-counter
Environment=STUDIO_NODE_BIN=%h/.bun/bin/bun
Environment=PATH=%h/.local/bin:%h/.bun/bin:%h/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin
TimeoutStartSec=900
ExecStart=/usr/bin/env studio run skynet-counter --input-file .studio/inputs/default.input.yaml
```

A user service starts with a minimal environment, so the `PATH` line is not optional:
the `claude-code` provider spawns the `claude` binary from `~/.local/bin`, and without it
the scoring stage fails. It also has to cover wherever `studio` itself landed — `ExecStart`
goes through `env` because systemd resolves a bare command name against its own fixed
search path, not the unit's `PATH`. `TimeoutStartSec` replaces systemd's 90-second
default, which a scoring stage over a full batch of articles exceeds once RALPH retries.

A sweep that finds no new articles skips scoring and finishes in under a second, so a unit
missing either line still looks healthy — the failure only shows up once there is
something to score.

```ini
# ~/.config/systemd/user/skynet-counter.timer
[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
loginctl enable-linger "$USER"
systemctl --user enable --now skynet-counter.timer
```

Lingering is what keeps the user manager alive after logout. Without it the timer stops
when you log out, which is exactly when an hourly sweep should still be running.

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
| loss of control | 15 | | active exploitation | 8 |
| self-replicating | 15 | | jailbreak | 8 |
| shutdown resistance | 14 | | exfiltrate | 7 |
| sandbox escape | 12 | | credentials leaked | 7 |
| remote code execution | 10 | | autonomous agent | 6 |
| supply-chain attack | 10 | | ransomware | 6 |
| privilege escalation | 9 | | breach | 5 |
| prompt injection | 9 | | vulnerability | 5 |
| zero-day | 8 | | agentic | 4 |
| backdoor | 8 | | account takeover | 4 |

## License

[AGPL-3.0-or-later](LICENSE). Same as [Studio](https://github.com/studio-foundation/studio),
which this pipeline runs on.
