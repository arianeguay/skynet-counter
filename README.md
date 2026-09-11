# Skynet Counter

A 0–100 gauge of how close the AI news cycle is to sounding like a Skynet origin
story. A Studio pipeline scrapes one feed list per domain, scores what is new
against a closed list of weighted keywords, and writes the result to SQLite. The Next.js frontend
only reads that — it never triggers a run.

```
feeds ──▶ studio pipeline ──▶ data/skynet.db ──▶ Next.js (page + /api/skynet)
```

## Requirements

- [Bun](https://bun.sh) 1.2+
- [Studio](https://github.com/studio-foundation/studio) 0.19.0+ (`studio --version`)
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

## Look at a page state

The page draws what the database happens to hold, so a state that needs weeks of
history — or a feed that has been failing for a day and a half — cannot be looked at
by running the pipeline. `bun run seed` writes a throwaway database holding one:

```bash
bun run seed                                   # lists the scenarios
SKYNET_DB=/tmp/seed.db bun run seed dead-feed  # writes it
SKYNET_DB=/tmp/seed.db bun dev                 # look at it
```

| Scenario | What the page shows |
|---|---|
| `nominal` | an ordinary week, every feed answering |
| `quiet` | the counter in its bottom band |
| `critical` | the top band, and a log that is almost all CRIT |
| `dead-feed` | `/// FEED FAULT`, one source past its day of grace |
| `flapping` | the same panel's other verdict — a source answering now, failing two sweeps in three |
| `host-outage` | `/// HOST FAULT`, with no publisher named for it |
| `balance` | every domain old enough for the balance band, the one you ran it as having an unusual week |
| `empty` | the log's empty state |
| `aiid` | a rising multi-year trend on `/aiid`, with recent months held back |

`SKYNET_DOMAIN` picks which domain gets the scenario, the same as it does for a sweep.
Nothing is fetched and nothing is scored: every row is synthesised from that domain's
own keyword table, and the counter is then computed from those rows through the same
call `aggregate` makes, so the gauge and the log are one state rather than two.

It refuses to run against `data/skynet.db` or anything under `/data`, and refuses an
unset `SKYNET_DB` for the same reason — the history behind a live counter is
gitignored and exists only on the volume serving it.

## Routes

| Path | What it serves |
|---|---|
| `/` | redirect to the default domain |
| `/<domain>` | that domain's gauge, status band and signal log — `/cybersecurite`, `/environment`, `/ai-business`, `/frontend`, `/smarthome` |
| `/ecologie` | permanent redirect to `/environment`, the slug it was renamed from |
| `/aiid` | reported AI incidents per year, in absolute terms, not a gauge |
| `/api/skynet` | the default domain's full snapshot as JSON |
| `/api/skynet/summary` | the default domain's counter, timestamp and band, for the desktop widget |
| `/api/skynet/<domain>` | that domain's full snapshot — the same shape, for any registered slug |
| `/api/skynet/<domain>/summary` | that domain's counter, timestamp and band |

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
| `fetch` (map over `input.feeds`) | script × one per feed | One `fetch-feed` sub-pipeline run per feed — for the cybersecurity domain, Ars Technica Security, The Hacker News, Krebs on Security, BleepingComputer, The Record and Dark Reading. The list lives in `.studio/inputs/<domain>.input.yaml`, so adding a feed is two lines there. A feed that errors emits an empty batch with the reason, so one publisher's 502 does not take the sweep down. |
| `dedupe` | script | Drops anything already *scored* in SQLite, by URL and by normalized title over the last 100 articles, and carries back any row still unscored from an earlier sweep. Caps the run at 25 articles, the backlog first; what the backlog leaves is shared round-robin across the sources that returned any, so a busy feed cannot crowd out a quiet one. Then reads each surviving article's linked page and scores against that text rather than the RSS summary — after the cap, so a page is fetched once instead of every sweep its item stays in the feed. An article whose page does not answer is held back rather than scored on its feed summary, and is offered again next sweep. Attaches each surviving article's `candidate_keywords` — the literal matches the scorer chooses from — along with the domain's weight table and scoring guidance. |
| `scoring` (group, 3 iterations) | claude-code + script | `score` keeps or drops each of the article's `candidate_keywords` and sums the weights of the ones it kept; `validate-scores` recomputes every score and checks each claimed keyword literally appears in the article. A keyword that appears literally but names no real risk is dropped on purpose, and the scorer says so in `dropped_keywords` with a reason — an article whose every literal match is left out silently is rejected. A mismatch rejects the group and `score` retries with the issues as feedback. |
| `aggregate` | script | Persists the scores, recomputes the counter, writes the snapshot. |

**Anti-theatre:** the validator is a script, not a second model. It cannot be talked
into approving a score, and a keyword the scorer invented fails on a substring check
— it recomputes the matches from the domain's own module and never reads the candidate
list or the weight table `dedupe` handed the scorer.

**The counter:** `12 + Σ(score × 0.5^(age_days / 7)) / DIVISOR` over the last 30 days,
below 50. `DIVISOR` is the domain's — calibrated from a feed set's measured score per
day — because that straight line is what an ordinary week has to land mid-gauge on. The
7-day half-life is what makes radio silence walk the number back down to the floor on
its own — there is no separate decay rule to keep in sync.

Above 50 the line stops being straight (STU-1270). A divisor picked so an ordinary week
reads mid-gauge leaves the top of the range covering barely more than a doubled week
before it runs off the end and pegs at 100 — a tripled week and a five-times week both
read the same number, which is the one thing a gauge cannot afford to do at the loud
end. Past `HEADROOM_KNEE` (50), the excess is compressed toward 100 by an exponential
that never quite reaches it, so a crisis three times as loud as normal and one five
times as loud stay legible as different readings instead of both being "100". The
compression is built so its slope matches the straight line's exactly at 50 — no visible
kink where the gauge starts leaning on the brake.

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

The site re-checks that number on its own. Once every one of a domain's sources has a
couple of weeks of its own history, `/<slug>` projects the measured rate to steady state
at the live divisor and prints `DIVISOR /n SATURATED` under the gauge when an ordinary
week no longer leaves room for one half again as busy — the failure that pegged
cybersecurity at 94.6 the day three feeds were added to it. It only ever complains in
that direction: a domain reading near the floor is a quiet beat, not a bad constant.

## AIID trend page

`/aiid` is not a gauge: no divisor, no keyword scoring, no 0-100 range. It plots the
[AI Incident Database](https://incidentdatabase.ai)'s yearly count of reported AI
incidents as a bar per year, unfiltered by tag or category. The five gauges are
relative-anomaly detectors, calibrated against their own recent history; this page
exists because a genuine multi-year trend does not show up on any of them, however
loud it gets.

Two ingestion mechanisms, both outside the hourly feed pattern:

- **Backfill (one-time):** `make backfill-aiid` downloads AIID's latest full-export
  snapshot and loads every incident's own date into `aiid_incidents`. Rerun it any
  time; it upserts on AIID's own `incident_id`, so a rerun refreshes rather than
  duplicates.
- **Sync (ongoing):** `docker/run-loop.sh` runs `scripts/aiid-sync.ts` on its own
  schedule (`AIID_SYNC_INTERVAL`, default weekly), reading AIID's public RSS feed
  and adding only incidents not already known. AIID's GraphQL API is origin-gated,
  so the RSS feed is the only reachable source for new incidents; a newly
  discovered incident is dated by the report that surfaced it, not AIID's own
  incident date, since that field is unreachable without the gated API.

The trailing ~6 months are always excluded from the chart. AIID backfills past
years continuously as reports come in, so the current window reads artificially
low while that backfill is ongoing, not because incidents actually slowed down.

## Scheduling

Studio has no scheduler. Two ways to give it one:

**Docker (self-contained, the default):**

```bash
docker compose up -d
```

The `pipeline` service is the scheduler — there is no cron and no systemd timer. It
sweeps each domain on its own period, set by `SKYNET_SCHEDULE` as whitespace-separated
`slug:seconds` pairs (default `cybersecurite:3600`, every registered domain named —
`tests/docker/schedule-default.test.ts` fails if one is missing), sharing the
`skynet-data` volume
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

### Deploying itself

`make deploy` is the manual trip. The server can also make it on its own, for every
commit CI has already proved:

```bash
make install-watcher     # one sudo on the server, once
make watcher-log         # what it has been doing
```

The server **pulls**; GitHub never connects to it. Nothing is exposed to the internet,
and no key or tunnel credential is stored in a GitHub secret — the only failure mode
that trade buys is a deploy landing up to one poll (five minutes) late.

The two halves:

- **`.github/workflows/ci.yml`** moves a `green` branch to the commit it just tested,
  on a push to `main` that passed. `green` is main's history with the untested commits
  left off.
- **[docker/deploy-watcher.sh](docker/deploy-watcher.sh)** fetches `green` every five
  minutes, fast-forwards to it and runs `docker compose up -d --build`. It never
  resets: a checkout that has diverged — someone debugging on the server — stops the
  deploy rather than losing their work. A commit whose build fails is not recorded, so
  the next pass retries it instead of reporting a server that is current when it is not.

It also waits out a sweep in flight. `docker compose up` recreates the `pipeline`
container, and a scoring stage that gets SIGTERM has already been billed for the tokens
it will never write; `run-loop.sh` stamps `/data/schedule/sweeping` for exactly as long
as a sweep runs.

`make deploy` still works and still deploys `main` directly, untested commits included.
That is the point of keeping it: a human asking for one is a different act from the
loop doing it silently.

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
`counter.ts`. Both summary routes set `access-control-allow-origin`, because a
desktop widget fetches from a `file://` document and sends `Origin: null`.

`GET /api/skynet/<domain>` and `GET /api/skynet/<domain>/summary` serve those two
payloads for any slug the registry defines — `/api/skynet/environment`,
`/api/skynet/ai-business/summary`. The two paths above stay pinned to the default
domain so a bookmark or a widget config does not break; an unregistered slug is a
404 rather than an empty snapshot, because a counter of 0 with no articles is what a
quiet week looks like and a domain that does not exist must not be able to publish
one.

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
words mark an *event* rather than the beat. `ai-business` reads the money the same
way — an acquisition, a term sheet, a compute contract are events; "startup",
"investor" and "billion" are the beat. `frontend` also carries
`polarity: 'progress'` — its events are the web platform doing well, not doing harm,
so its bands and accent read the opposite way (see CLAUDE.md's Polarity section). The
validator recomputes from each domain's own module; the scorer is handed the same
table through the `dedupe` stage output, so neither carries a copy of its own.

`ai-business` is the one table here that was **reasoned rather than measured** —
the probe needs live feeds and the sandbox it was added from had no egress to them,
so its weights and its divisor are a first pass to be replaced by
`bun run calibrate` once it has swept for a couple of weeks. Its one finding worth
reading anyway: `valuation` cannot be a keyword, because the matcher scans by
substring and *evaluation* contains it.

A domain may also carry a **subject list**, and `environment` and `ai-business` do.
A keyword table measures how bad a story is; it can only do that inside a subject it
is allowed to assume, and four of `environment`'s feeds are general climate press.
So an oil spill naming an `aquifer`, and farms going under on fuel prices naming the
`ratepayer` and the `energy demand` behind them, both scored in the twenties on a
counter whose subject is AI compute. An article naming none of the subject's terms
now scores nothing, whatever else it contains — applied when the article is scored
and again when the counter is read, so correcting the list corrects the history with
it. Domains whose feed list is already the filter carry no subject list and are
unaffected. The half of that list that answers "is this about AI at all?" lives
once, in [ai-subject.ts](src/lib/domains/ai-subject.ts), and both gated domains
extend it rather than copying it — `environment` adds the physical plant (a campus,
a GPU, a training run) because a buildout story can name the buildout and never the
technology; `ai-business` deliberately does not, since a data-centre REIT on the
funding wire is a real story on the wrong beat.

`environment` is also the first domain reading a second language: Radio-Canada's
fils environnement and techno, with French mirrors of the keyword table at the same
weights. Nothing in the pipeline is language-aware — a second language is entirely
what the two lists carry, plus two normalisation rules: accents fold, and a subject
term written with a capital (`AI`, `IA`) is matched case-sensitively, so the French
verb in *j'ai* does not open the gate.

The environment page also carries [TheAIMeters](https://www.theaimeters.com)' live
totals under the counter, in a sandboxed frame. The gauge measures how loudly the
press is reporting the cost of AI compute; the meters measure the cost itself, and
neither derives from the other.

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
| reward hacking | 10 | | vulnerabilit | 5 |
| privilege escalation | 9 | | agentic | 4 |
| prompt injection | 9 | | account takeover | 4 |

## License

[AGPL-3.0-or-later](LICENSE). Same as [Studio](https://github.com/studio-foundation/studio),
which this pipeline runs on.
