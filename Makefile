CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)
MK_FILE_DIR := $(CODING_BOX_BASE_DIR)/scripts/make

audit-app:
	$(MAKE) -f $(MK_FILE_DIR)/audit.mk -C $(MK_FILE_DIR) $@
audit-backend:
	$(MAKE) -f $(MK_FILE_DIR)/audit.mk -C $(MK_FILE_DIR) $@
audit-frontend:
	$(MAKE) -f $(MK_FILE_DIR)/audit.mk -C $(MK_FILE_DIR) $@

dev-registry-login:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-registry-logout:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-build:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-up:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-down:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-start:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-stop:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-status:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-logs:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-config:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-system-prune:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-volumes-prune:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-volumes-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-images-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-clean-all:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@

dev-db-registry-login:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-registry-logout:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-build:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-up:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-down:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-volumes-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-images-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-update-status:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-update-history:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-validate-changelog:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-update-display-sql:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-update-testing-rollback:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-update:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-rollback-lastchangeset:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@
dev-db-generate-docs:
	$(MAKE) -f $(MK_FILE_DIR)/dev-db.mk -C $(MK_FILE_DIR) $@

dev-redis-registry-login:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-registry-logout:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-build:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-up:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-down:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-volumes-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-images-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-monitor:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-info:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-stats:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-ping:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-flush-all:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-flush-db:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@
dev-redis-cli:
	$(MAKE) -f $(MK_FILE_DIR)/dev-redis.mk -C $(MK_FILE_DIR) $@

dev-test-app:
	$(MAKE) -f $(MK_FILE_DIR)/dev-test.mk -C $(MK_FILE_DIR) $@
dev-test-backend:
	$(MAKE) -f $(MK_FILE_DIR)/dev-test.mk -C $(MK_FILE_DIR) $@
dev-test-frontend:
	$(MAKE) -f $(MK_FILE_DIR)/dev-test.mk -C $(MK_FILE_DIR) $@

lint-app:
	$(MAKE) -f $(MK_FILE_DIR)/lint.mk -C $(MK_FILE_DIR) $@
lint-backend:
	$(MAKE) -f $(MK_FILE_DIR)/lint.mk -C $(MK_FILE_DIR) $@
lint-frontend:
	$(MAKE) -f $(MK_FILE_DIR)/lint.mk -C $(MK_FILE_DIR) $@
lint-frontend-e2e:
	$(MAKE) -f $(MK_FILE_DIR)/lint.mk -C $(MK_FILE_DIR) $@

coding-box-up:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-down:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-start:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-stop:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-status:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-logs:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-config:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-system-prune:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-volumes-prune:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-images-clean:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-liquibase-status:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-connect-db:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-dump-all:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-restore-all:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-dump-db:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-restore-db:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-dump-db-data-only:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-restore-db-data-only:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-update:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@

coding-box-redis-monitor:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-redis-info:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-redis-stats:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-redis-ping:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-redis-flush-all:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-redis-flush-db:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
coding-box-redis-cli:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@

push-dockerhub:
	$(MAKE) -f $(MK_FILE_DIR)/push.mk -C $(MK_FILE_DIR) $@
push-iqb-registry:
	$(MAKE) -f $(MK_FILE_DIR)/push.mk -C $(MK_FILE_DIR) $@

scan-registry-login:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-registry-logout:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-app:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-db:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-liquibase:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-backend:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-frontend:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
