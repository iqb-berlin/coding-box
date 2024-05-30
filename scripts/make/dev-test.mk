CODING_BOX_BASE_DIR := $(shell git rev-parse --show-toplevel)

include $(CODING_BOX_BASE_DIR)/.env.dev

## exports all variables (especially those of the included .env.dev file!)
.EXPORT_ALL_VARIABLES:

## prevents collisions of make target names with possible file names
.PHONY: dev-test-app dev-test-backend dev-test-frontend \
dev-test-build-e2e dev-test-e2e dev-test-e2e-api dev-test-e2e-ui-chrome dev-test-e2e-ui-chrome-mobile \
dev-test-e2e-ui-firefox dev-test-e2e-ui-firefox-mobile dev-test-e2e-ui-edge dev-test-e2e-ui-edge-mobile

## Run all tests (only in combination with 'make dev-up')
dev-test-app: dev-test-backend dev-test-frontend

## Run backend tests (only in combination with 'make dev-up')
dev-test-backend:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec -it backend bash -c "nx test api"

## Run frontend tests (only in combination with 'make dev-up')
dev-test-frontend:
	docker compose --env-file $(CODING_BOX_BASE_DIR)/.env.dev exec -it frontend bash -c "nx test frontend"

### Build docker e2e test image (e.g. at nx workspace updates)
#dev-test-build-e2e:
#	@if test $(REGISTRY_PATH); then printf "Login %s\n" $(REGISTRY_PATH); docker login $(REGISTRY_PATH); fi
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker build\
#				--progress plain\
#				--pull\
#				--build-arg REGISTRY_PATH=$(REGISTRY_PATH)\
#				-f $(CODING_BOX_BASE_DIR)/apps/frontend-e2e/Dockerfile\
#				-t studio-lite-frontend-e2e:$(TAG)\
#			.
#	@if test $(REGISTRY_PATH); then docker logout $(REGISTRY_PATH); fi
#
### Run all e2e tests in dev environment (only in combination with 'make dev-up')
#dev-test-e2e:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=chrome
#
### Run all e2e api tests in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-api:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=chrome\
#				--spec="./apps/frontend-e2e/src/e2e/api/*"
#
### Run all e2e ui tests with chrome browser in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-ui-chrome:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=chrome\
#				--spec="./apps/frontend-e2e/src/e2e/ui/*"
#
### Run all e2e ui tests with chrome browser for mobiles in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-ui-chrome-mobile:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=chrome\
#				--spec="./apps/frontend-e2e/src/e2e/ui/*"\
#				--config="viewportWidth=375,viewportHeight=667"
#
### Run all e2e ui tests with firefox browser in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-ui-firefox:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=firefox\
#				--spec="./apps/frontend-e2e/src/e2e/ui/*"\
#
### Run all e2e ui tests with firefox browser for mobiles in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-ui-firefox-mobile:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=firefox\
#				--spec="./apps/frontend-e2e/src/e2e/ui/*"\
#				--config="viewportWidth=375,viewportHeight=667"
#
### Run all e2e ui tests with edge browser in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-ui-edge:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=edge\
#				--spec="./apps/frontend-e2e/src/e2e/ui/*"
#
### Run all e2e ui tests with edge browser for mobiles in dev environment (only in combination with 'make dev-up')
#dev-test-e2e-ui-edge-mobile:
#	cd $(CODING_BOX_BASE_DIR) &&\
#		docker run\
#				--rm\
#				--pull never\
#				-v ./apps/frontend-e2e:/studio-lite/apps/frontend-e2e\
#				--network app-net\
#			studio-lite-frontend-e2e:$(TAG) e2e frontend-e2e --baseUrl=http://frontend:80\
#				--browser=edge\
#				--spec="./apps/frontend-e2e/src/e2e/ui/*"\
#				--config="viewportWidth=375,viewportHeight=667"
