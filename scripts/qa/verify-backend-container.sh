#!/bin/sh
# Run against a locally built production image and disposable, private services.
set -eu
: "${BACKEND_IMAGE:?Set BACKEND_IMAGE to the production image under test}"
prefix="backend-esm-$(date +%s)-$$"
network="$prefix-net"
proof="${BACKEND_CONTAINER_PROOF_DIR:-dist/backend-container-proof}"
postgres_image="${POSTGRES_TEST_IMAGE:-postgres:14.22-alpine3.22@sha256:7161c8e7347ed8b4cdefc26087702336da5f467137cc964e611c85d745df6112}"
redis_image="${REDIS_TEST_IMAGE:-redis:7.4-alpine}"
mkdir -p "$proof"
cleanup() {
  for role in api export-worker db redis; do
    docker logs "$prefix-$role" > "$proof/$role.log" 2>&1 || true
    docker rm -f "$prefix-$role" >/dev/null 2>&1 || true
  done
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker network create --internal "$network" >/dev/null
docker run -d --name "$prefix-db" --network "$network" --network-alias test-db \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_USER=esm_test -e POSTGRES_PASSWORD=disposable_test_only \
  -e POSTGRES_DB=esm_test "$postgres_image" >/dev/null
docker run -d --name "$prefix-redis" --network "$network" --network-alias test-redis \
  --tmpfs /data:rw,size=64m "$redis_image" redis-server --save '' --appendonly no >/dev/null
wait_for() {
  count=0
  until "$@"; do
    count=$((count + 1))
    if [ "$count" -ge 60 ]; then echo "Readiness failed: $*" >&2; return 1; fi
    sleep 1
  done
}
wait_for docker exec "$prefix-db" pg_isready -U esm_test -d esm_test
wait_for docker exec "$prefix-redis" redis-cli ping
# Execute the same SQL changesets used by the integration gate, in root order.
sed -n 's/.*<include file="\([^"]*\)".*/\1/p' database/changelog/coding-box.changelog-root.xml |
while IFS= read -r file; do
  docker exec -i "$prefix-db" psql -U esm_test -d esm_test -X -q -v ON_ERROR_STOP=1 \
    < "database/changelog/$file"
done
connections_closed() {
  pg=$(docker exec "$prefix-db" psql -U esm_test -d esm_test -X -A -t -c \
    'SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')
  redis=$(docker exec "$prefix-redis" redis-cli CLIENT LIST | wc -l | tr -d ' ')
  [ "$pg" = 0 ] && [ "$redis" = 1 ]
}
api_ready() {
  docker exec "$prefix-api" node -e \
    "fetch('http://127.0.0.1:3333/api/health',{signal:AbortSignal.timeout(2000)}).then(async r=>{console.log(r.status,await r.text());process.exit(r.status===200?0:1)}).catch(()=>process.exit(1))"
}
worker_ready() {
  docker logs "$prefix-export-worker" 2>&1 | grep -F 'Export worker started'
}
for role in api export-worker; do
  docker run -d --name "$prefix-$role" --network "$network" \
    -e APP_ROLE="$role" -e API_HOST=0.0.0.0 \
    -e POSTGRES_HOST=test-db -e POSTGRES_PORT=5432 -e POSTGRES_USER=esm_test \
    -e POSTGRES_PASSWORD=disposable_test_only -e POSTGRES_DB=esm_test \
    -e REDIS_HOST=test-redis -e REDIS_PORT=6379 -e REDIS_PREFIX="$prefix" \
    -e JWT_SECRET=esm-disposable-container-proof -e OAUTH2_CLIENT_ID=esm-proof \
    -e OIDC_ISSUER=http://fixture.invalid/realms/proof \
    -e OIDC_JWKS_URI=http://fixture.invalid/realms/proof/certs \
    "$BACKEND_IMAGE" >/dev/null
  if [ "$role" = api ]; then wait_for api_ready; else wait_for worker_ready; fi
  docker exec "$prefix-db" psql -U esm_test -d esm_test -X -A -t -c \
    "SELECT count(*)>0 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()" | grep -x t
  clients=$(docker exec "$prefix-redis" redis-cli CLIENT LIST | wc -l | tr -d ' ')
  [ "$clients" -gt 1 ]
  docker stop --time 9 "$prefix-$role" >/dev/null
  code=$(docker inspect --format '{{.State.ExitCode}}' "$prefix-$role")
  case "$code" in 0|143) ;; *) echo "Unexpected $role shutdown: $code" >&2; exit 1 ;; esac
  wait_for connections_closed
  printf '%s start, connections and SIGTERM shutdown passed (exit %s)\n' "$role" "$code"
done
