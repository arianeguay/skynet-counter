#!/bin/sh
# The pipeline's own scheduler. Studio has no cron of its own, and a run that
# fails (a flaky feed, a DNS blip) must not take the loop down with it.
set -eu

export STUDIO_NODE_BIN="$(command -v bun)"
[ -f .studio/config.yaml ] || cp .studio/config.example.yaml .studio/config.yaml

INTERVAL="${PIPELINE_INTERVAL:-3600}"
# Which domain this loop sweeps. One container runs one domain: its input file,
# its keyword table and its slice of every table are all keyed off this
# (STU-1213).
DOMAIN="${SKYNET_DOMAIN:-cybersecurite}"
export SKYNET_DOMAIN="$DOMAIN"

while true; do
  echo "--- $(date -u +%FT%TZ) ${DOMAIN} sweep start"
  studio run skynet-counter --input-file ".studio/inputs/${DOMAIN}.input.yaml" \
    || echo "--- sweep failed, retrying in ${INTERVAL}s" >&2
  sleep "$INTERVAL"
done
