#!/bin/sh
# The pipeline's own scheduler. Studio has no cron of its own, and a run that
# fails (a flaky feed, a DNS blip) must not take the loop down with it.
set -eu

export STUDIO_NODE_BIN="$(command -v bun)"
[ -f .studio/config.yaml ] || cp .studio/config.example.yaml .studio/config.yaml

# One `slug:seconds` pair per domain, whitespace separated. A domain sweeps on
# its own period: cybersecurity publishes several scoring stories a day, design
# will not, and paying for an hourly scoring stage on a feed set that produces
# one article a week is the cost this exists to avoid (STU-1215).
#
# Required rather than defaulted to a slug: a default here would be a second copy
# of DEFAULT_DOMAIN that shell cannot read from TypeScript, and a stale one would
# sweep a domain nothing serves. `docker-compose.yml` supplies it.
if [ -z "${SKYNET_SCHEDULE:-}" ]; then
  echo "SKYNET_SCHEDULE is unset — expected '<slug>:<seconds>' pairs, e.g. 'cybersecurite:3600'" >&2
  exit 1
fi
SCHEDULE="$SKYNET_SCHEDULE"

# The domains sweep in turn rather than in a container each. Four concurrent
# sweeps would be four `claude` sessions sharing one login through a read-write
# `~/.claude` mount, refreshing the same token file against each other — and four
# scoring stages billing at once rather than spread across the hour.
#
# Taking turns costs the isolation of separate processes, so the two ways one
# domain could hold up another are closed here instead: a sweep that *fails*
# cannot stop the loop, and a sweep that *hangs* is bounded.
SWEEP_TIMEOUT="${SWEEP_TIMEOUT:-1800}"

# Survives a container restart, so a bounce does not re-sweep every domain at
# once and does not reset a slow domain's clock to zero.
STATE="${SKYNET_STATE_DIR:-/data/schedule}"
mkdir -p "$STATE"

# Stamped while a sweep runs, so the deploy watcher can hold a rebuild back
# rather than SIGTERM a scoring stage it has already paid for. Cleared here
# because a container killed mid-sweep leaves its stamp behind, and a marker
# nothing clears would defer every deploy from then on.
SWEEP_MARKER="$STATE/sweeping"
rm -f "$SWEEP_MARKER"

# Never sleep longer than this in one go, so a schedule change on restart is
# picked up without waiting out the longest interval.
MAX_SLEEP="${MAX_SLEEP:-900}"

# The AIID trend page's own schedule, separate from the domains above: a plain
# script, not a Studio pipeline, so it shares this loop's due-file bookkeeping
# without going through `studio run`. Weekly by default, since this data does
# not need hourly freshness the way the gauge feeds do.
AIID_SYNC_INTERVAL="${AIID_SYNC_INTERVAL:-604800}"
AIID_DUE_FILE="$STATE/aiid.due"

while true; do
  now=$(date +%s)
  wake=$((now + MAX_SLEEP))

  for entry in $SCHEDULE; do
    domain=${entry%%:*}
    interval=${entry##*:}
    due_file="$STATE/$domain.due"
    due=$(cat "$due_file" 2>/dev/null || echo 0)

    if [ "$now" -ge "$due" ]; then
      echo "--- $(date -u +%FT%TZ) $domain sweep start"
      date +%s > "$SWEEP_MARKER"
      # The interval is counted from the end of the sweep, not its start: a
      # scoring stage can run for minutes, and an interval measured from the
      # start would compound that drift into a domain sweeping early.
      if SKYNET_DOMAIN="$domain" timeout "$SWEEP_TIMEOUT" \
        studio run skynet-counter --input-file ".studio/inputs/$domain.input.yaml"; then
        :
      else
        echo "--- $domain sweep failed, next attempt in ${interval}s" >&2
      fi
      rm -f "$SWEEP_MARKER"
      due=$(( $(date +%s) + interval ))
      echo "$due" > "$due_file"
    fi

    if [ "$due" -lt "$wake" ]; then
      wake=$due
    fi
  done

  aiid_due=$(cat "$AIID_DUE_FILE" 2>/dev/null || echo 0)
  if [ "$now" -ge "$aiid_due" ]; then
    echo "--- $(date -u +%FT%TZ) aiid sync start"
    # Unlike a domain sweep, this touches no $SWEEP_MARKER: it is a cheap,
    # idempotent script with no billed tokens to lose from a SIGTERM mid-run,
    # so there is nothing here for the deploy watcher to hold a rebuild back
    # for.
    if timeout "$SWEEP_TIMEOUT" bun scripts/aiid-sync.ts; then
      :
    else
      echo "--- aiid sync failed, next attempt in ${AIID_SYNC_INTERVAL}s" >&2
    fi
    aiid_due=$(( $(date +%s) + AIID_SYNC_INTERVAL ))
    echo "$aiid_due" > "$AIID_DUE_FILE"
  fi
  if [ "$aiid_due" -lt "$wake" ]; then
    wake=$aiid_due
  fi

  now=$(date +%s)
  if [ "$wake" -gt "$now" ]; then
    sleep $((wake - now))
  else
    sleep 1
  fi
done
