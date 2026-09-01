-include .env

DEPLOY_PATH ?= skynet-counter

.PHONY: deploy

# Pulling without rebuilding leaves the old image serving, so this is one target.
deploy:
	@test -n "$(DEPLOY_HOST)" || { echo "DEPLOY_HOST is unset — cp .env.example .env and fill it in"; exit 1; }
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && git pull --ff-only && docker compose up -d --build'
