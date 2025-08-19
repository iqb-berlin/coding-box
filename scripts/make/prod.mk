CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)
CMD ?= status

include $(CODING_BOX_BASE_DIR)/.env.coding-box

# exports all variables (especially those of the included .env.coding-box file!)
.EXPORT_ALL_VARIABLES:

# prevents collisions of make target names with possible file names
.PHONY: coding-box-up coding-box-down coding-box-start coding-box-stop coding-box-status coding-box-logs\
	coding-box-config coding-box-system-prune coding-box-volumes-prune coding-box-images-clean\
	coding-box-liquibase-status coding-box-connect-db coding-box-dump-all coding-box-restore-all coding-box-dump-db\
	coding-box-restore-db coding-box-dump-db-data-only coding-box-restore-db-data-only coding-box-export-backend-vol\
	coding-box-import-backend-vol coding-box-redis-monitor coding-box-redis-info coding-box-redis-stats\
	coding-box-redis-ping coding-box-redis-flush-all coding-box-redis-flush-db coding-box-redis-cli coding-box-update

# disables printing the recipe of a make target before executing it
.SILENT: prod-images-clean

# Pull newest images, create and start docker containers
coding-box-up:
	@if [ ! -f $(CODING_BOX_BASE_DIR)/config/frontend/default.conf.template ]; then\
		cp\
			$(CODING_BOX_BASE_DIR)/config/frontend/default.conf.http-template\
			$(CODING_BOX_BASE_DIR)/config/frontend/default.conf.template;\
	fi
	@if ! test $(shell docker network ls -q --filter name=app-net);\
		then docker network create app-net;\
	fi
	@if test $(REGISTRY_PATH); then printf "Login %s\n" $(REGISTRY_PATH); docker login $(REGISTRY_PATH); fi
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		pull
	@if test $(REGISTRY_PATH); then docker logout $(REGISTRY_PATH); fi
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d

# Stop and remove docker containers
coding-box-down:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# Start docker containers
## Param (optional): SERVICE - Start the specified service only, e.g. `make coding-box-start SERVICE=db`
coding-box-start:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		start $(SERVICE)

# Stop docker containers
## Param (optional): SERVICE - Stop the specified service only, e.g. `make coding-box-stop SERVICE=db`
coding-box-stop:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		stop $(SERVICE)

# Show status of containers
## Param (optional): SERVICE - Show status of the specified service only, e.g. `make coding-box-status SERVICE=db`
coding-box-status:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		ps -a $(SERVICE)

# Show service logs
## Param (optional): SERVICE - Show log of the specified service only, e.g. `make coding-box-logs SERVICE=db`
coding-box-logs:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		logs -f $(SERVICE)

# Show services configuration
## Param (optional): SERVICE - Show config of the specified service only, e.g. `make coding-box-config SERVICE=db`
coding-box-config:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		config $(SERVICE)

# Remove unused dangling images, containers, networks, etc. Data volumes will stay untouched!
coding-box-system-prune:
	docker system prune

# Remove all anonymous local volumes not used by at least one container.
coding-box-volumes-prune:
	docker volume prune

# Remove all unused (not just dangling) images!
coding-box-images-clean: .EXPORT_ALL_VARIABLES
	if test "$(shell docker images -f reference=${REGISTRY_PATH}iqbberlin/coding-box-* -q)";\
		then docker rmi $(shell docker images -f reference=${REGISTRY_PATH}iqbberlin/coding-box-* -q);\
	fi

# Outputs the count of changesets that have not been deployed
## (https://docs.liquibase.com/commands/status/status.html)
coding-box-liquibase-status: .EXPORT_ALL_VARIABLES
	cd $(CODING_BOX_BASE_DIR) &&\
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		run --rm liquibase\
			liquibase\
					--changelogFile=coding-box.changelog-root.xml\
					--url=jdbc:postgresql://db:5432/$(POSTGRES_DB)\
					--username=$(POSTGRES_USER)\
					--password=$(POSTGRES_PASSWORD)\
					--classpath=changelog\
					--logLevel=info\
				$(CMD)

# Open DB console
coding-box-connect-db: .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			psql --username=$(POSTGRES_USER) --dbname=$(POSTGRES_DB)

# Extract a database cluster into a script file
## (https://www.postgresql.org/docs/current/app-pg-dumpall.html)
coding-box-dump-all: coding-box-down .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d db
	sleep 5 ## wait until db startup is completed
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			pg_dumpall --verbose --username=$(POSTGRES_USER) > $(CODING_BOX_BASE_DIR)/backup/temp/all.sql
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# PostgreSQL interactive terminal reads commands from the dump file all.sql
## (https://www.postgresql.org/docs/14/app-psql.html)
## Before restoring, delete the DB volume and any existing block storage.
## Check whether the database already exists and drop it if necessary.
coding-box-restore-all: coding-box-down .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d db
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		cp $(CODING_BOX_BASE_DIR)/backup/temp/all.sql db:/tmp/
	sleep 10	## wait until file upload is completed
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			psql --username=$(POSTGRES_USER) --file=/tmp/all.sql postgres
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# Extract a database into a script file or other archive file
## (https://www.postgresql.org/docs/current/app-pgdump.html)
coding-box-dump-db: coding-box-down .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d db
	sleep 5 ## wait until db startup is completed
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			pg_dump\
					--verbose\
					--username=$(POSTGRES_USER)\
					--format=c\
				$(POSTGRES_DB) > $(CODING_BOX_BASE_DIR)/backup/temp/$(POSTGRES_DB)_dump
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# Restore a database from an archive file created by pg_dump
## (https://www.postgresql.org/docs/current/app-pgrestore.html)
## Before restoring, delete the DB volume and any existing block storage.
coding-box-restore-db: coding-box-down .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d db
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		cp $(CODING_BOX_BASE_DIR)/backup/temp/$(POSTGRES_DB)_dump db:/tmp/
	sleep 10	## wait until file upload is completed
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			pg_restore\
					--verbose\
					--single-transaction\
					--username=$(POSTGRES_USER)\
					--dbname=$(POSTGRES_DB)\
					--clean\
					--if-exists\
				/tmp/$(POSTGRES_DB)_dump
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# Extract a database data into a script file or other archive file
## (https://www.postgresql.org/docs/current/app-pgdump.html)
coding-box-dump-db-data-only: coding-box-down .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d db liquibase
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			pg_dump\
					--verbose\
					--data-only\
					--exclude-table=public.databasechangelog\
					--exclude-table=public.databasechangeloglock\
					--username=$(POSTGRES_USER)\
					--format=c\
			$(POSTGRES_DB) > $(CODING_BOX_BASE_DIR)/backup/temp/$(POSTGRES_DB)_data_dump
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# Restore a database data from an archive file created by pg_dump
## (https://www.postgresql.org/docs/current/app-pgrestore.html)
coding-box-restore-db-data-only: coding-box-down .EXPORT_ALL_VARIABLES
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d db liquibase
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		cp $(CODING_BOX_BASE_DIR)/backup/temp/$(POSTGRES_DB)_data_dump db:/tmp/
	sleep 10	## wait until file upload is completed
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		exec -it db\
			pg_restore\
					--verbose\
					--data-only\
					--single-transaction\
					--disable-triggers\
					--username=$(POSTGRES_USER)\
					--dbname=$(POSTGRES_DB)\
				/tmp/$(POSTGRES_DB)_data_dump
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		down

# Creates a gzip'ed tarball in temporary backup directory from backend data (backend has to be up!)
coding-box-export-backend-vol:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d backend
	sleep 5 ## wait until backend startup is completed
	docker run --rm\
			--volumes-from $(notdir $(CURDIR))-backend-1\
			--volume $(CODING_BOX_BASE_DIR)/backup/temp:/tmp\
		busybox tar cvzf /tmp/backend_vol.tar.gz /usr/src/coding-box-api/packages

# Extracts a gzip'ed tarball from temporary backup directory into backend data volume (backend has to be up!)
coding-box-import-backend-vol:
	docker compose\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
		up -d backend
	sleep 5 ## wait until backend startup is completed
	docker run --rm\
			--volumes-from $(notdir $(CURDIR))-backend-1\
			--volume $(CODING_BOX_BASE_DIR)/backup/temp:/tmp\
		busybox sh\
			-c "cd /usr/src/coding-box-api/packages && tar xvzf /tmp/backend_vol.tar.gz --strip-components 4"

# Monitor Redis in real-time
coding-box-redis-monitor:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec redis redis-cli monitor

# Display Redis server information
coding-box-redis-info:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec redis redis-cli info

# Display Redis statistics
coding-box-redis-stats:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec redis redis-cli info stats

# Check Redis connection status
coding-box-redis-ping:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec redis redis-cli ping

# Flush all Redis databases
coding-box-redis-flush-all:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec redis redis-cli flushall

# Flush the current Redis database
coding-box-redis-flush-db:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec redis redis-cli flushdb

# Open Redis CLI
coding-box-redis-cli:
	docker compose\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.yaml\
			--file $(CODING_BOX_BASE_DIR)/docker-compose.coding-box.prod.yaml\
			--env-file $(CODING_BOX_BASE_DIR)/.env.coding-box\
		exec -it redis redis-cli

# Start application update procedure
coding-box-update:
	bash $(CODING_BOX_BASE_DIR)/scripts/update.sh
