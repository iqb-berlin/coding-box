CODING_BOX_BASE_DIR ?= $(shell git rev-parse --show-toplevel)
PG17_DIRECTORY ?= $(CODING_BOX_BASE_DIR)
PG17_MIGRATION_DIR ?=
PG17_WAIT_SECONDS ?= 180
PG17_PREPARE_ONLY ?= 0
PG17_ARGS = --directory "$(PG17_DIRECTORY)" --wait-seconds "$(PG17_WAIT_SECONDS)" $(if $(PG17_MIGRATION_DIR),--migration-dir "$(PG17_MIGRATION_DIR)")

.PHONY: coding-box-postgres17-migrate coding-box-postgres17-finish coding-box-postgres17-rollback coding-box-postgres17-status

# Explicit maintenance command; it never runs as a dependency of ordinary startup.
coding-box-postgres17-migrate:
	python3 "$(CODING_BOX_BASE_DIR)/scripts/postgres17_migration.py" migrate $(PG17_ARGS) $(if $(filter 1,$(PG17_PREPARE_ONLY)),--prepare-only)

coding-box-postgres17-finish:
	python3 "$(CODING_BOX_BASE_DIR)/scripts/postgres17_migration.py" finish $(PG17_ARGS)

coding-box-postgres17-rollback:
	python3 "$(CODING_BOX_BASE_DIR)/scripts/postgres17_migration.py" rollback $(PG17_ARGS)

coding-box-postgres17-status:
	python3 "$(CODING_BOX_BASE_DIR)/scripts/postgres17_migration.py" status $(PG17_ARGS)
