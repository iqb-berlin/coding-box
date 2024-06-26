CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)
TRIVY_VERSION := aquasec/trivy:0.50.1

## prevents collisions of make target names with possible file names
.PHONY: scan-app scan-db scan-liquibase scan-backend scan-frontend

## scans application images for security vulnerabilities
scan-app: scan-db scan-liquibase scan-backend scan-frontend

## scans db image for security vulnerabilities
scan-db:
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--pull\
				-f $(CODING_BOX_BASE_DIR)/database/Postgres.Dockerfile\
				--no-cache\
				--rm\
				-t iqbberlin/coding-box-db:scan\
			.
		docker run\
				--rm\
				-v /var/run/docker.sock:/var/run/docker.sock\
				-v ${HOME}/Library/Caches:/root/.cache/\
			$(TRIVY_VERSION)\
				image\
						--scanners vuln\
						--ignore-unfixed\
						--severity CRITICAL\
					iqbberlin/coding-box-db:scan

## scans liquibase image for security vulnerabilities
scan-liquibase:
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--pull\
				-f $(CODING_BOX_BASE_DIR)/database/Liquibase.Dockerfile\
				--no-cache\
				--rm\
				-t iqbberlin/coding-box-liquibase:scan\
			.
		docker run\
				--rm\
				-v /var/run/docker.sock:/var/run/docker.sock\
				-v ${HOME}/Library/Caches:/root/.cache/\
			$(TRIVY_VERSION)\
				image\
						--scanners vuln\
						--ignore-unfixed\
						--severity CRITICAL\
					iqbberlin/coding-box-liquibase:scan

## scans backend image for security vulnerabilities
scan-backend:
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--pull\
				-f $(CODING_BOX_BASE_DIR)/apps/backend/Dockerfile\
				--build-arg PROJECT=api\
				--target=prod\
				--no-cache\
				--rm\
				-t iqbberlin/coding-box-backend:scan\
			.
		docker run\
				--rm\
				-v /var/run/docker.sock:/var/run/docker.sock\
				-v ${HOME}/Library/Caches:/root/.cache/\
			$(TRIVY_VERSION)\
				image\
						--scanners vuln\
						--ignore-unfixed\
						--severity CRITICAL\
					iqbberlin/coding-box-backend:scan

## scans frontend image for security vulnerabilities
scan-frontend:
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--pull\
				-f $(CODING_BOX_BASE_DIR)/apps/frontend/Dockerfile\
				--build-arg PROJECT=frontend\
				--target=prod\
				--no-cache\
				--rm\
				-t iqbberlin/coding-box-frontend:scan\
			.
		docker run\
 				--rm\
 				-v /var/run/docker.sock:/var/run/docker.sock\
 				-v ${HOME}/Library/Caches:/root/.cache/\
 			$(TRIVY_VERSION)\
 				image\
 						--scanners vuln\
 						--ignore-unfixed\
 						--severity CRITICAL\
 					iqbberlin/coding-box-frontend:scan
