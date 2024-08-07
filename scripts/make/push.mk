CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)
TAG := dev

## prevents collisions of make target names with possible file names
.PHONY: push-dockerhub push-iqb-registry

## Build and tag all docker images
.build:
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--progress plain\
				--pull\
				--no-cache\
				--rm\
				--file $(CODING_BOX_BASE_DIR)/database/Postgres.Dockerfile\
				--tag iqbberlin/coding-box-db:$(TAG)\
				--tag scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-db:$(TAG)\
			.
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--progress plain\
				--pull\
				--no-cache\
				--rm\
				--file $(CODING_BOX_BASE_DIR)/database/Liquibase.Dockerfile\
				--tag iqbberlin/coding-box-liquibase:$(TAG)\
				--tag scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-liquibase:$(TAG)\
			.
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--progress plain\
				--pull\
				--no-cache\
				--rm\
				--tag coding-box-base:$(TAG)\
			.
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--progress plain\
				--no-cache\
				--rm\
				--target=prod\
				--build-arg PROJECT=backend\
				--build-arg BASE_IMAGE_NAME=coding-box-base:$(TAG)\
				--file $(CODING_BOX_BASE_DIR)/apps/backend/Dockerfile\
				--tag iqbberlin/coding-box-backend:$(TAG)\
				--tag scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-backend:$(TAG)\
			.
	cd $(CODING_BOX_BASE_DIR) &&\
		docker build\
				--progress plain\
				--no-cache\
				--rm\
				--target=prod\
				--build-arg PROJECT=frontend\
				--build-arg BASE_IMAGE_NAME=coding-box-base:$(TAG)\
				--file $(CODING_BOX_BASE_DIR)/apps/frontend/Dockerfile\
				--tag iqbberlin/coding-box-frontend:$(TAG)\
				--tag scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-frontend:$(TAG)\
			.

## Push all docker images to 'hub.docker.com'
push-dockerhub: .build
	docker login
	docker push iqbberlin/coding-box-db:$(TAG)
	docker push iqbberlin/coding-box-liquibase:$(TAG)
	docker push iqbberlin/coding-box-backend:$(TAG)
	docker push iqbberlin/coding-box-frontend:$(TAG)
	docker logout

## Push all docker images to 'scm.cms.hu-berlin.de:4567/iqb/coding-box'
push-iqb-registry: .build
	docker login scm.cms.hu-berlin.de:4567
	docker push scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-db:$(TAG)
	docker push scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-liquibase:$(TAG)
	docker push scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-backend:$(TAG)
	docker push scm.cms.hu-berlin.de:4567/iqb/coding-box/iqbberlin/coding-box-frontend:$(TAG)
	docker logout
