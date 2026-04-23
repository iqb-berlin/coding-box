CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)

WORKSPACE_ID ?=
LIMIT ?=
RESPONSE_IDS ?=
OUTPUT ?= tmp/replay-health-ws$(WORKSPACE_ID).json
BASE_URL ?=
AUTH_TOKEN ?=
AUTH_IDENTITY ?=
AUTH_TOKEN_DAYS ?= 1
BROWSER_CONCURRENCY ?= 1
BROWSER_TIMEOUT_MS ?= 30000
SCREENSHOTS_DIR ?= tmp/replay-health-prod-ws$(WORKSPACE_ID)
HEADED ?= 0

## exports all variables to subshells
.EXPORT_ALL_VARIABLES:

## prevents collisions of make target names with possible file names
.PHONY: replay-health-help replay-health replay-health-prod replay-health-prod-full

## Show replay-health help and examples
replay-health-help:
	@printf "Replay Health Make Targets\n\n"
	@printf "Targets:\n"
	@printf "  make replay-health WORKSPACE_ID=12\n"
	@printf "  make replay-health-prod WORKSPACE_ID=12 BASE_URL=https://coding.example.org AUTH_TOKEN=<jwt>\n"
	@printf "  make replay-health-prod WORKSPACE_ID=12 BASE_URL=https://coding.example.org AUTH_IDENTITY=my-identity\n"
	@printf "  make replay-health-prod-full WORKSPACE_ID=12 BASE_URL=https://coding.example.org AUTH_TOKEN=<jwt>\n\n"
	@printf "Variables:\n"
	@printf "  WORKSPACE_ID          required\n"
	@printf "  LIMIT                 optional, default empty for replay-health and 20 for replay-health-prod\n"
	@printf "  RESPONSE_IDS          optional comma-separated response ids\n"
	@printf "  OUTPUT                optional JSON report path, default tmp/replay-health-ws<id>.json\n"
	@printf "  BASE_URL              required for browser targets\n"
	@printf "  AUTH_TOKEN            optional existing JWT for browser targets\n"
	@printf "  AUTH_IDENTITY         optional identity for locally signed JWTs\n"
	@printf "  AUTH_TOKEN_DAYS       default 1\n"
	@printf "  BROWSER_CONCURRENCY   default 1 for safe production runs\n"
	@printf "  BROWSER_TIMEOUT_MS    default 30000\n"
	@printf "  SCREENSHOTS_DIR       default tmp/replay-health-prod-ws<id>\n"
	@printf "  HEADED=1              runs Chromium visible instead of headless\n"

## Run backend payload replay health check
replay-health:
	@if [ -z "$(WORKSPACE_ID)" ]; then\
		printf "ERROR: WORKSPACE_ID is required.\n" >&2;\
		exit 1;\
	fi
	@set -eu; \
	ARGS="--workspaceId=$(WORKSPACE_ID)"; \
	if [ -n "$(LIMIT)" ]; then ARGS="$$ARGS --limit=$(LIMIT)"; fi; \
	if [ -n "$(RESPONSE_IDS)" ]; then ARGS="$$ARGS --responseIds=$(RESPONSE_IDS)"; fi; \
	if [ -n "$(OUTPUT)" ]; then ARGS="$$ARGS --output=$(OUTPUT)"; fi; \
	printf "Running replay health check: npx nx run backend:replay-health %s\n" "$$ARGS"; \
	cd $(CODING_BOX_BASE_DIR) && npx nx run backend:replay-health $$ARGS

## Run a safe production browser replay health check with conservative defaults
replay-health-prod:
	@if [ -z "$(WORKSPACE_ID)" ]; then\
		printf "ERROR: WORKSPACE_ID is required.\n" >&2;\
		exit 1;\
	fi
	@if [ -z "$(BASE_URL)" ]; then\
		printf "ERROR: BASE_URL is required.\n" >&2;\
		exit 1;\
	fi
	@if [ -n "$(AUTH_TOKEN)" ] && [ -n "$(AUTH_IDENTITY)" ]; then\
		printf "ERROR: Set either AUTH_TOKEN or AUTH_IDENTITY, not both.\n" >&2;\
		exit 1;\
	fi
	@if [ -z "$(AUTH_TOKEN)" ] && [ -z "$(AUTH_IDENTITY)" ]; then\
		printf "ERROR: AUTH_TOKEN or AUTH_IDENTITY is required.\n" >&2;\
		exit 1;\
	fi
	@set -eu; \
	SAFE_LIMIT="$${LIMIT:-20}"; \
	ARGS="--workspaceId=$(WORKSPACE_ID) --browser --baseUrl=$(BASE_URL)"; \
	ARGS="$$ARGS --limit=$$SAFE_LIMIT --browserConcurrency=$${BROWSER_CONCURRENCY:-1}"; \
	ARGS="$$ARGS --browserTimeoutMs=$${BROWSER_TIMEOUT_MS:-30000} --authTokenDays=$${AUTH_TOKEN_DAYS:-1}"; \
	if [ -n "$(RESPONSE_IDS)" ]; then ARGS="$$ARGS --responseIds=$(RESPONSE_IDS)"; fi; \
	if [ -n "$(OUTPUT)" ]; then ARGS="$$ARGS --output=$(OUTPUT)"; fi; \
	if [ -n "$(SCREENSHOTS_DIR)" ]; then ARGS="$$ARGS --screenshotsDir=$(SCREENSHOTS_DIR)"; fi; \
	if [ "$(HEADED)" = "1" ]; then ARGS="$$ARGS --headed"; fi; \
	if [ -n "$(AUTH_TOKEN)" ]; then ARGS="$$ARGS --authToken=$(AUTH_TOKEN)"; fi; \
	if [ -n "$(AUTH_IDENTITY)" ]; then ARGS="$$ARGS --authIdentity=$(AUTH_IDENTITY)"; fi; \
	printf "Running safe production replay health check: npx nx run backend:replay-health %s\n" "$$ARGS"; \
	cd $(CODING_BOX_BASE_DIR) && npx nx run backend:replay-health $$ARGS

## Run a full production browser replay health check without the safe default limit
replay-health-prod-full:
	@if [ -z "$(WORKSPACE_ID)" ]; then\
		printf "ERROR: WORKSPACE_ID is required.\n" >&2;\
		exit 1;\
	fi
	@if [ -z "$(BASE_URL)" ]; then\
		printf "ERROR: BASE_URL is required.\n" >&2;\
		exit 1;\
	fi
	@if [ -n "$(AUTH_TOKEN)" ] && [ -n "$(AUTH_IDENTITY)" ]; then\
		printf "ERROR: Set either AUTH_TOKEN or AUTH_IDENTITY, not both.\n" >&2;\
		exit 1;\
	fi
	@if [ -z "$(AUTH_TOKEN)" ] && [ -z "$(AUTH_IDENTITY)" ]; then\
		printf "ERROR: AUTH_TOKEN or AUTH_IDENTITY is required.\n" >&2;\
		exit 1;\
	fi
	@set -eu; \
	ARGS="--workspaceId=$(WORKSPACE_ID) --browser --baseUrl=$(BASE_URL)"; \
	ARGS="$$ARGS --browserConcurrency=$${BROWSER_CONCURRENCY:-1}"; \
	ARGS="$$ARGS --browserTimeoutMs=$${BROWSER_TIMEOUT_MS:-30000} --authTokenDays=$${AUTH_TOKEN_DAYS:-1}"; \
	if [ -n "$(LIMIT)" ]; then ARGS="$$ARGS --limit=$(LIMIT)"; fi; \
	if [ -n "$(RESPONSE_IDS)" ]; then ARGS="$$ARGS --responseIds=$(RESPONSE_IDS)"; fi; \
	if [ -n "$(OUTPUT)" ]; then ARGS="$$ARGS --output=$(OUTPUT)"; fi; \
	if [ -n "$(SCREENSHOTS_DIR)" ]; then ARGS="$$ARGS --screenshotsDir=$(SCREENSHOTS_DIR)"; fi; \
	if [ "$(HEADED)" = "1" ]; then ARGS="$$ARGS --headed"; fi; \
	if [ -n "$(AUTH_TOKEN)" ]; then ARGS="$$ARGS --authToken=$(AUTH_TOKEN)"; fi; \
	if [ -n "$(AUTH_IDENTITY)" ]; then ARGS="$$ARGS --authIdentity=$(AUTH_IDENTITY)"; fi; \
	printf "Running full production replay health check: npx nx run backend:replay-health %s\n" "$$ARGS"; \
	cd $(CODING_BOX_BASE_DIR) && npx nx run backend:replay-health $$ARGS
