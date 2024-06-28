CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)

include $(CODING_BOX_BASE_DIR)/.env.dev

## exports all variables (especially those of the included .env.dev file!)
.EXPORT_ALL_VARIABLES:

## prevents collisions of make target names with possible file names
.PHONY: dev-test-app dev-test-backend dev-test-frontend

## Run all tests (only in combination with 'make dev-up')
dev-test-app: dev-test-backend dev-test-frontend

## Run backend tests (only in combination with 'make dev-up')
dev-test-backend:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec -it backend bash -c "nx test backend"

## Run frontend tests (only in combination with 'make dev-up')
dev-test-frontend:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec -it frontend bash -c "nx test frontend"
