#!/usr/bin/env bash
set -euo pipefail

# Use the development targets of the same Dockerfiles as the production images.
for project in backend frontend; do
  docker build --target dev --build-arg "PROJECT=$project" --build-arg BASE_IMAGE_NAME=coding-box-base:ci \
    --file "apps/$project/Dockerfile" --tag "coding-box-$project:test" .
  mkdir -p "coverage/image-tests/$project"
done

network="ci-pr-image-tests-${GITHUB_RUN_ID:-local}-$$"
docker network create "$network" >/dev/null
cleanup() {
  docker rm --force "$network-redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$network-redis" --network "$network" --network-alias bullmq-redis \
  redis:7.4-alpine --save '' --appendonly no
timeout 60 bash -c 'until docker exec "$1" redis-cli ping | grep -qx PONG; do sleep 1; done' _ "$network-redis"

backend=(docker run --rm --network "$network" -e CI=true -e NX_DAEMON=false -e NX_NO_CLOUD=true
  -e BULLMQ_TEST_REDIS_HOST=bullmq-redis -e BULLMQ_TEST_REDIS_PORT=6379
  -v "$PWD/coverage/image-tests/backend:/usr/src/coding-box-base/coverage/apps/backend"
  coding-box-backend:test)
frontend=(docker run --rm -e CI=true -e NX_DAEMON=false -e NX_NO_CLOUD=true
  -v "$PWD/coverage/image-tests/frontend:/usr/src/coding-box-base/coverage/apps/frontend"
  coding-box-frontend:test)

"${backend[@]}" run backend:typecheck
"${backend[@]}" run backend:verify-runtime-package
"${backend[@]}" test backend --configuration=ci --maxWorkers=2 --passWithNoTests=false
"${backend[@]}" lint backend

"${frontend[@]}" run frontend:test-quality-gates
"${frontend[@]}" test frontend --configuration=ci --maxWorkers=2
"${frontend[@]}" lint frontend

# Both test images contain the same root lockfile.
docker run --rm --entrypoint npm coding-box-backend:test audit --audit-level critical
docker run --rm --entrypoint npm coding-box-frontend:test audit --audit-level critical
