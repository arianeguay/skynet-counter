#!/bin/sh
# Brings the server to the newest commit CI has already proved, without anything
# on the internet being able to reach in. GitHub never connects here: the CI
# workflow moves a `green` ref to the SHA it tested, and this loop pulls it.
#
# That direction is the whole design. A push-based deploy needs sshd exposed to
# GitHub's runners, or a tunnel credential living in a GitHub secret; this needs
# neither, and its worst failure is a deploy that happens a poll late.
set -eu

REPO="${DEPLOY_REPO:-$PWD}"
# The ref CI writes, never `main` — main carries every commit, green carries only
# the ones that passed. Deploying main directly is `make deploy`, on purpose: a
# human asking for an untested commit is a different act from the loop doing it.
REF="${DEPLOY_REF:-green}"
POLL="${DEPLOY_POLL_SECONDS:-300}"
STATE_DIR="${DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/skynet-deploy}"

# Written by run-loop.sh inside the pipeline container, so it is read through
# `docker compose exec` rather than from the host — the volume behind it is
# root-owned under /var/lib/docker.
SWEEP_MARKER="${SWEEP_MARKER:-/data/schedule/sweeping}"
# Longer than run-loop.sh's own SWEEP_TIMEOUT, so a sweep that is bounded but
# slow is waited out rather than deployed over.
SWEEP_LOCK_MAX_AGE="${SWEEP_LOCK_MAX_AGE:-1860}"

cd "$REPO"
mkdir -p "$STATE_DIR"
DEPLOYED="$STATE_DIR/deployed"

log() { echo "--- $(date -u +%FT%TZ) $*"; }

# `docker compose up` recreates the pipeline container, and a scoring stage that
# gets SIGTERM has already been billed for the tokens it will not deliver. The
# marker's age is what keeps a container killed mid-sweep from holding a deploy
# back forever: run-loop.sh clears the marker at startup too, but a stopped
# container never reaches that.
sweeping() {
  started=$(docker compose exec -T pipeline cat "$SWEEP_MARKER" 2>/dev/null | tr -dc '0-9')
  if [ -z "$started" ]; then
    return 1
  fi
  [ $(( $(date +%s) - started )) -lt "$SWEEP_LOCK_MAX_AGE" ]
}

# Every failure path here returns 0. The loop is the only thing keeping the
# server current, so a dead feed of a fetch, a diverged checkout or a broken
# build must all cost one poll rather than the watcher.
deploy_pass() {
  if ! git fetch --quiet origin "$REF" 2>/dev/null; then
    log "could not fetch origin/$REF — retrying in ${POLL}s"
    return 0
  fi
  target=$(git rev-parse FETCH_HEAD)

  deployed=''
  if [ -f "$DEPLOYED" ]; then
    deployed=$(cat "$DEPLOYED")
  fi
  if [ "$target" = "$deployed" ]; then
    return 0
  fi

  # The checkout already carries it: a `make deploy` got there first, or a
  # re-run moved green backwards. Recording it stops the log repeating.
  if git merge-base --is-ancestor "$target" HEAD; then
    log "$target is already in the checkout"
    echo "$target" > "$DEPLOYED"
    return 0
  fi

  if sweeping; then
    log "a sweep is in flight — holding $target back"
    return 0
  fi

  log "deploying $target"
  # --ff-only, never a reset: a checkout that has diverged is someone debugging
  # on the server, and throwing that away silently is worse than not deploying.
  if ! git merge --ff-only --quiet "$target"; then
    log "cannot fast-forward to $target — the checkout has diverged, deploying nothing"
    return 0
  fi

  # Both services build the tree into an image, so a pull without a rebuild
  # leaves the old code serving — the same reason `make deploy` is one target.
  if docker compose up -d --build; then
    echo "$target" > "$DEPLOYED"
    log "deployed $target"
  else
    # Deliberately not recorded, so the next pass retries this same commit
    # instead of treating a failed build as delivered.
    log "build failed for $target — retrying in ${POLL}s"
  fi
}

while true; do
  deploy_pass
  if [ -n "${DEPLOY_ONCE:-}" ]; then
    break
  fi
  sleep "$POLL"
done
