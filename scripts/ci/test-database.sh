#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?This check needs a runner temporary directory}"
case "${DB_IMAGE:?Set DB_IMAGE to db or db-pg17}" in
  db|db-pg17) ;;
  *) echo "Unknown database image: $DB_IMAGE" >&2; exit 2 ;;
esac

for image in "$DB_IMAGE" liquibase; do
  zstd --decompress --stdout "$RUNNER_TEMP/images/$image.tar.zst" | docker load
done

network="ci-migrations-${GITHUB_RUN_ID:-local}-$$"
docker network create "$network" >/dev/null
cleanup() {
  docker logs "$network-db" > "$RUNNER_TEMP/database-test.log" 2>&1 || true
  docker rm --force "$network-db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$network-db" --network "$network" --network-alias db \
  --env POSTGRES_DB=ci --env POSTGRES_USER=ci --env POSTGRES_PASSWORD=ci \
  "coding-box-$DB_IMAGE:ci"

for ((attempt = 1; attempt <= 120; attempt++)); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$network-db")" == healthy ]]; then
    break
  fi
  if ((attempt == 120)); then
    echo 'Disposable PostgreSQL did not become healthy.' >&2
    exit 1
  fi
  sleep 1
done

for command in status validate updateSQL updateTestingRollback history; do
  docker run --rm --network "$network" coding-box-liquibase:ci \
    liquibase --changelogFile coding-box.changelog-root.xml \
    --url jdbc:postgresql://db:5432/ci --username ci --password ci \
    --classpath changelog "$command"
done
