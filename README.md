# Skynet Counter

A 0–100 gauge of how close the AI news cycle is to sounding like a Skynet origin
story. A Studio pipeline scrapes four feeds, scores what is new against a closed
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
export SKYNET_DOMAIN=cybersecurite   # which domain this sweep is for
studio run skynet-counter --input-file .studio/inputs/$SKYNET_DOMAIN.input.yaml
studio run skynet-counter --input-file .studio/inputs/$SKYNET_DOMAIN.input.yaml --live   # stream stages
studio status                                                                            # last run
studio logs <run-id>
```

`SKYNET_DOMAIN` picks the feed list, the keyword table and the slice of every table
the sweep reads and writes. Unset it and the sweep runs the default domain; set it to
a slug no module defines and it fails on the spot rather than writing rows nothing
serves.

The first run scores everything the feeds return; later runs only score what the
dedupe stage has not seen before, plus any row an earlier sweep inserted but never
scored. When it finds nothing to score the group is skipped outright
(`condition: stages.dedupe.output.new_count > 0`) and the run costs zero tokens —
which is most runs on an hourly schedule.

## Run the frontend

```bash
bun dev              # http://localhost:3000
```

`bun dev`, `bun run build` and `bun start` all go through `bun --bun` so the API
route can import `bun:sqlite`. Running them under Node will fail at that import.

## Routes

| Path | What it serves |
|---|---|
| `/` | redirect to the default domain |
| `/<domain>` | that domain's gauge, status band and signal log — `/cybersecurite`, `/environment`, `/frontend`, `/smarthome` |
| `/ecologie` | permanent redirect to `/environment`, the slug it was renamed from |
| `/api/skynet` | the default domain's full snapshot as JSON |
| `/api/skynet/summary` | the default domain's counter, timestamp and band, for the desktop widget |

The domain switcher above the gauge is built from the registry in
`src/lib/domains/`, so it appears once a second domain exists and lists exactly the
ones that do.

Below it, every page also carries a **balance band** — how the risk domains are
reading against the progress ones, each compared to its own recent normal rather
than to another domain's raw counter (two counters on different divisors are not
directly comparable). It renders nothing until there is at least one *mature* domain
on each side — a domain only counts once it has been actually swept, not merely
published about, for `HORIZON_DAYS + HISTORY_WINDOW_DAYS` (44) days, so expect it
empty for weeks after a fresh deploy. See CLAUDE.md's "The balance band" for why a
domain is measured against itself rather than against the others.

## Pipeline shape

| Stage | Executor | What it does |
|---|---|---|
| `fetch` (map over `input.feeds`) | script ×4 | One `fetch-feed` sub-pipeline run per feed — Ars Technica Security, The Hacker News, Krebs on Security, HN. The list lives in `.studio/inputs/<domain>.input.yaml`, so adding a feed is two lines there. A feed that errors emits an empty batch with the reason, so one publisher's 502 does not take the sweep down. |
| `dedupe` | script | Drops anything already *scored* in SQLite, by URL and by normalized title over the last 100 articles, and carries back any row still unscored from an earlier sweep. Caps the run at 25 articles, the backlog first; what the backlog leaves is shared round-robin across the sources that returned any, so a busy feed cannot crowd out a quiet one. Then reads each surviving article's linked page and scores against that text rather than the RSS summary — after the cap, so a page is fetched once instead of every sweep its item stays in the feed. An article whose page does not answer is held back rather than scored on its feed summary, and is offered again next sweep. Attaches each surviving article's `candidate_keywords` — the literal matches the scorer chooses from — along with the domain's weight table and scoring guidance. |
| `scoring` (group, 3 iterations) | claude-code + script | `score` keeps or drops each of the article's `candidate_keywords` and sums the weights of the ones it kept; `validate-scores` recomputes every score and checks each claimed keyword literally appears in the article. A keyword that appears literally but names no real risk is dropped on purpose, and the scorer says so in `dropped_keywords` with a reason — an article whose every literal match is left out silently is rejected. A mismatch rejects the group and `score` retries with the issues as feedback. |
| `aggregate` | script | Persists the scores, recomputes the counter, writes the snapshot. |

**Anti-theatre:** the validator is a script, not a second model. It cannot be talked
into approving a score, and a keyword the scorer invented fails on a substring check
— it recomputes the matches from the domain's own module and never reads the candidate
list or the weight table `dedupe` handed the scorer.

**The counter:** `12 + Σ(score × 0.5^(age_days / 7)) / DIVISOR`, clamped to 0–100, over
the last 30 days. `DIVISOR` is the domain's — 32 for cybersecurity — because it is
calibrated from a feed set's measured score per day. The 7-day half-life is what makes radio silence walk the number back
down to the floor on its own — there is no separate decay rule to keep in sync.

The divisor is set so the gauge spans the range the feeds actually produce. Measured
2026-09-01, the feeds publish 97 points of score a day between them, which at a
7-day half-life settles at a signal of ~930: an ordinary week reads 43, a doubled one
77, a tripled one pegs at 100, and silence returns to 12.

The sum is normalised per source before that division. Each feed's RSS window covers a
different slice of the 30 days — two days for hnrss, two months for Krebs — so the raw
sum measures how much history the database holds as much as how much risk there is, and
a freshly seeded database read 15 where a mature one reads 43. Scaling each source by
the fraction of the horizon its own window covers takes that out; the scale reaches 1
once a source has been watched for the whole horizon, so it front-loads the plateau
rather than raising it.

`bun run calibrate` replays the stored history through that formula across a grid of
half-lives and divisors, so the constants can be argued from the corpus rather than
guessed. It prints three grids: the stored history raw, the same history normalised,
and what it publishes once every day inside the horizon is populated. The last two
should agree — the raw one lags by however much of the horizon the RSS windows leave
empty. It reads the database and never writes to it; point it elsewhere with
`SKYNET_DB=/path/to.db`.

## Scheduling

Studio has no scheduler. Two ways to give it one:

**Docker (self-contained, the default):**

```bash
docker compose up -d
```

The `pipeline` service is the scheduler — there is no cron and no systemd timer. It
sweeps each domain on its own period, set by `SKYNET_SCHEDULE` as whitespace-separated
`slug:seconds` pairs (default `cybersecurite:3600`), sharing the `skynet-data` volume
with `web`. A failed sweep logs and waits for that domain's next tick rather than
taking the container down, and a hung one is cut off at `SWEEP_TIMEOUT` (default 1800s)
so it cannot hold up another domain's turn.

Each sweep pays for its own scoring stage, so the period is per domain rather than
uniform: a feed set that publishes one article a week does not need the cadence that a
security newswire does.

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
Environment=SKYNET_DOMAIN=cybersecurite
ExecStart=/usr/bin/env studio run skynet-counter --input-file .studio/inputs/cybersecurite.input.yaml
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

## Deploy

Once the site runs on another machine, name it in `.env` and let `make` do the trip:

```bash
cp .env.example .env     # set DEPLOY_HOST to an ssh alias or user@host
make deploy
```

That pulls `main` on the server and rebuilds both containers over it. It is one target
on purpose: `web` and `pipeline` build the tree into an image, so a pull without the
rebuild leaves the old code serving.

```bash
make run-pipeline
```

Runs one sweep now rather than waiting out the `pipeline` container's sleep. It runs
*inside* that container, so it writes the volume the site reads — a sweep started on the
host would write a `data/skynet.db` nothing serves.

## API

`GET /api/skynet` — the last snapshot, never a fresh run:

```json
{
  "counter": 23.4,
  "updatedAt": "2026-08-31T18:00:00.000Z",
  "articles": [
    { "title": "…", "url": "…", "source": "Ars Technica", "date": "…", "score": 20,
      "keywords": ["sandbox escape", "zero-day"], "evidence": "…" }
  ],
  "feedErrors": [
    { "source": "Ars Technica Security", "error": "Ars Technica Security responded 404",
      "since": "2026-08-14T18:00:00.000Z" }
  ]
}
```

`feedErrors` is empty when every feed answered on the last sweep. A dead feed never
fails the run — it costs the counter its input silently — so this array is where it
shows up; `since` is the first sweep it failed on, which is what tells a publisher's
502 apart from a URL that has been 404ing for weeks.

The page renders a `/// FEED FAULT` panel under the counter for any source whose
`since` is more than 24 hours old, so a transient 502 stays out of the public view
while a genuinely dead feed does not. Every current error reaches the API regardless
of age.

`GET /api/skynet/summary` — the same counter without the payload around it:

```json
{ "counter": 23.4, "updatedAt": "2026-08-31T18:00:00.000Z", "status": "BACKGROUND CHATTER" }
```

For a caller that draws the number and nothing else. `/api/skynet` reads 40 articles
and parses each one's keyword JSON to answer, which is a lot of wire for a widget
polling on a timer. `status` is the band the site prints — served rather than
computed by the caller, so a second surface cannot drift from the thresholds in
`counter.ts`. This is the only route that sets `access-control-allow-origin`, because
a desktop widget fetches from a `file://` document.

## Desktop widget

[widgets/ubersicht/](widgets/ubersicht/) is a Mac desktop widget — the gauge, the
number and the band on the wallpaper layer, polling `/api/skynet/summary` every 15
minutes. It needs [Übersicht](https://tracesof.net/uebersicht/) (`brew install --cask
ubersicht`) and no Xcode, no signing and no Apple account;
[its README](widgets/ubersicht/README.md) has the install and how to move it.

`bun test tests/widgets/` covers it without Übersicht running.

## Keyword weights

One table per domain, in `src/lib/domains/<slug>.ts`. The table below is the
cybersecurity domain's, defined in
[src/lib/domains/cybersecurite.ts](src/lib/domains/cybersecurite.ts) — change them
there. `environment` and `frontend` carry their own, in
[environment.ts](src/lib/domains/environment.ts) and
[frontend.ts](src/lib/domains/frontend.ts), picked the same way: measuring which
words mark an *event* rather than the beat. `frontend` also carries
`polarity: 'progress'` — its events are the web platform doing well, not doing harm,
so its bands and accent read the opposite way (see CLAUDE.md's Polarity section). The
validator recomputes from each domain's own module; the scorer is handed the same
table through the `dedupe` stage output, so neither carries a copy of its own.

| Keyword | Weight | | Keyword | Weight |
|---|---|---|---|---|
| loss of control | 15 | | zero-day | 8 |
| self-replicating | 15 | | backdoor | 8 |
| self-improving | 15 | | active exploitation | 8 |
| shutdown resistance | 14 | | jailbreak | 8 |
| sandbox escape | 12 | | exfiltrate | 7 |
| misalign | 12 | | credentials leaked | 7 |
| remote code execution | 10 | | autonomous agent | 6 |
| supply-chain attack | 10 | | ransomware | 6 |
| deceptive | 10 | | breach | 5 |
| reward hacking | 10 | | vulnerability | 5 |
| privilege escalation | 9 | | agentic | 4 |
| prompt injection | 9 | | account takeover | 4 |

## License

[AGPL-3.0-or-later](LICENSE). Same as [Studio](https://github.com/studio-foundation/studio),
which this pipeline runs on.
