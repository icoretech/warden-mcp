.PHONY: build up down bootstrap test logs ps up-org bootstrap-org test-org down-org ps-org

COMPOSE := docker compose
COMPOSE_ORG := docker compose -p keychain-mcp-org -f docker-compose.org.yml

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d vaultwarden vaultwarden-https
	$(COMPOSE) run --rm bootstrap
	$(COMPOSE) up mcp

down:
	$(COMPOSE) down

bootstrap:
	$(COMPOSE) run --rm bootstrap

up-org:
	$(COMPOSE_ORG) up -d vaultwarden-org vaultwarden-org-https

bootstrap-org:
	$(COMPOSE_ORG) run --rm bootstrap-org

test-org:
	$(COMPOSE_ORG) up -d vaultwarden-org vaultwarden-org-https
	$(COMPOSE_ORG) run --rm bootstrap-org
	$(COMPOSE_ORG) run --rm tests-org

down-org:
	$(COMPOSE_ORG) down

test:
	$(COMPOSE) run --rm tests

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

ps-org:
	$(COMPOSE_ORG) ps
