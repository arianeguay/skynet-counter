-include .env

DEPLOY_PATH ?= skynet-counter

.PHONY: deploy run-pipeline

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
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && docker compose exec -T pipeline sh -c '\''STUDIO_NODE_BIN=$$(command -v bun) studio run skynet-counter --input-file .studio/inputs/default.input.yaml'\'''
