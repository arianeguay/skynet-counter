#!/bin/sh
# The pipeline's own scheduler. Studio has no cron of its own, and a run that
# fails (a flaky feed, a DNS blip) must not take the loop down with it.
set -eu

export STUDIO_NODE_BIN="$(command -v bun)"
[ -f .studio/config.yaml ] || cp .studio/config.example.yaml .studio/config.yaml

INTERVAL="${PIPELINE_INTERVAL:-3600}"

while true; do
  echo "--- $(date -u +%FT%TZ) sweep start"
  studio run skynet-counter --input-file .studio/inputs/default.input.yaml \
    || echo "--- sweep failed, retrying in ${INTERVAL}s" >&2
  sleep "$INTERVAL"
done
