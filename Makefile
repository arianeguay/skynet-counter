-include .env

DEPLOY_PATH ?= skynet-counter
# Which domain `run-pipeline` sweeps. The container's own loop reads it from the
# compose environment; an ad-hoc sweep has to name it, since the input file and
# the rows it writes are both keyed off it.
DOMAIN ?= cybersecurite

.PHONY: deploy run-pipeline backfill-aiid install-watcher watcher-log

require-host = @test -n "$(DEPLOY_HOST)" || { echo "DEPLOY_HOST is unset — cp .env.example .env and fill it in"; exit 1; }

pull:
	$(require-host)
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && git pull --ff-only'

# Pulling without rebuilding leaves the old image serving, so this is one target.
deploy:
	$(require-host)
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && git pull --ff-only && docker compose up -d --build'

# A sweep now, instead of waiting out the container's hourly sleep. It runs in
# the pipeline container, so it writes the live volume — a host run would not.
# STUDIO_NODE_BIN is exported by run-loop.sh, not by the image, so exec sets it.
run-pipeline:
	$(require-host)
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && docker compose exec -T pipeline sh -c '\''STUDIO_NODE_BIN=$$(command -v bun) SKYNET_DOMAIN=$(DOMAIN) studio run skynet-counter --input-file .studio/inputs/$(DOMAIN).input.yaml'\'''

# The AIID trend page's one-time load, run once after this ships and never on
# a schedule: `docker/run-loop.sh` handles the ongoing RSS sync on its own.
backfill-aiid:
	$(require-host)
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && docker compose exec -T pipeline bun scripts/aiid-backfill.ts'

# Installs the auto-deploy watcher: from here on the server brings itself to
# every commit CI pushed to `green`, and `make deploy` is only for jumping the
# queue with an untested one. Needs sudo on the server, once.
install-watcher:
	$(require-host)
	scp docker/skynet-deploy.service $(DEPLOY_HOST):/tmp/skynet-deploy.service
	ssh -t $(DEPLOY_HOST) 'sed -e "s|__USER__|$$(id -un)|g" -e "s|__REPO__|$$HOME/$(DEPLOY_PATH)|g" /tmp/skynet-deploy.service | sudo tee /etc/systemd/system/skynet-deploy.service >/dev/null && rm -f /tmp/skynet-deploy.service && sudo systemctl daemon-reload && sudo systemctl enable --now skynet-deploy && systemctl status --no-pager skynet-deploy'

watcher-log:
	$(require-host)
	ssh $(DEPLOY_HOST) 'journalctl -u skynet-deploy -n 50 --no-pager'
