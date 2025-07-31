SHELL:=/bin/bash -O extglob
CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)

include $(CODING_BOX_BASE_DIR)/.env.dev

## exports all variables (especially those of the included .env.dev file!)
.EXPORT_ALL_VARIABLES:

## prevents collisions of make target names with possible file names
.PHONY: dev-redis-registry-login dev-redis-registry-logout dev-redis-build dev-redis-up dev-redis-down dev-redis-volumes-clean\
	dev-redis-images-clean dev-redis-monitor dev-redis-info dev-redis-stats dev-redis-ping dev-redis-flush-all dev-redis-flush-db dev-redis-cli

## disables printing the recipe of a make target before executing it
.SILENT: dev-redis-registry-login dev-redis-registry-logout dev-redis-volumes-clean dev-redis-images-clean

## Log in to selected registry (see .env.dev file)
dev-redis-registry-login:
	if test $(REGISTRY_PATH); then printf "Login %s\n" $(REGISTRY_PATH); docker login $(REGISTRY_PATH); fi

## Log out of selected registry (see .env.dev file)
dev-redis-registry-logout:
	if test $(REGISTRY_PATH); then docker logout $(REGISTRY_PATH); fi

## Pull redis docker image
dev-redis-build:
	docker compose --progress plain --env-file $(CODING_BOX_BASE_DIR)/.env.dev pull redis

## Start redis container (e.g. for a localhost dev environment with non containerized frontend and backend servers)
dev-redis-up:
	@if ! test $(shell docker network ls -q --filter name=app-net);\
		then docker network create app-net;\
	fi
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev up --no-build --pull never -d redis

## Stop and remove redis container
dev-redis-down:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev down
	@if test $(shell docker network ls -q --filter name=app-net);\
		then docker network rm $(shell docker network ls -q -f name=app-net);\
	fi

## Remove all unused redis volumes
# Be very careful, all data could be lost!!!
dev-redis-volumes-clean:
	if test "$(shell docker volume ls -f name=coding-box_redis_data -q)";\
		then docker volume rm $(shell docker volume ls -f name=coding-box_redis_data -q);\
	fi

## Remove all unused (not just dangling) redis images!
dev-redis-images-clean:
	if test "$(shell docker images -f reference=redis:alpine -q)";\
		then docker rmi $(shell docker images -f reference=redis:alpine -q);\
	fi

## Monitor Redis in real-time
dev-redis-monitor:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec redis redis-cli monitor

## Display Redis server information
dev-redis-info:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec redis redis-cli info

## Check Redis connection status
dev-redis-ping:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec redis redis-cli ping

## Display Redis statistics
dev-redis-stats:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec redis redis-cli info stats

## Flush all Redis databases
dev-redis-flush-all:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec redis redis-cli flushall

## Flush the current Redis database
dev-redis-flush-db:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec redis redis-cli flushdb

## Open Redis CLI
dev-redis-cli:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec -it redis redis-cli
