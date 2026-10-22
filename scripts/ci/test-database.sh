#!/usr/bin/env bash
set -euo pipefail

# Only disposable resources owned by this job are removed by the trap.
project="ci-db-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup() {
  docker logs "$project-db" > "${RUNNER_TEMP:?}/database-test.log" 2>&1 || true
  docker rm --force "$project-db" >/dev/null 2>&1 || true
  docker network rm "$project" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for image in db liquibase; do
  zstd --decompress --stdout "$RUNNER_TEMP/images/$image.tar.zst" | docker load
done
docker network create "$project"
docker run --detach --rm --name "$project-db" --network "$project" --network-alias db \
  --env POSTGRES_DB=ci --env POSTGRES_USER=ci --env POSTGRES_PASSWORD=ci \
  iqbberlin/coding-box-db:ci

ready=false
for ((attempt = 0; attempt < 120; attempt++)); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$project-db")" == healthy ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Disposable PostgreSQL did not become healthy.' >&2
  exit 1
fi

# Match GitLab's migration validation, SQL preview and rollback test.
for command in status validate updateSQL updateTestingRollback history; do
  docker run --rm --network "$project" iqbberlin/coding-box-liquibase:ci \
    liquibase --changelogFile coding-box.changelog-root.xml \
    --url jdbc:postgresql://db:5432/ci --username ci --password ci \
    --classpath changelog "$command"
done
