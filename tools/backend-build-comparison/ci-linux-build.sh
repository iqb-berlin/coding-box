#!/bin/sh
# Run only inside the CI job's fresh Docker-in-Docker daemon.
set -eu
proof=dist/backend-build-comparison-ci
mkdir -p "$proof"
trap 'rm -f "$proof"/.stream-*' EXIT
printf '%s\n' 'Collecting Docker diagnostics (bounded; no build has started yet)'
timeout 30 docker version > "$proof/docker-version.txt"
timeout 30 docker info > "$proof/docker-info.txt"
# Disk-usage introspection must never indefinitely block the measured build.
if timeout 30 docker system df > "$proof/docker-before.txt" 2>&1; then
  cat "$proof/docker-before.txt"
else
  printf '%s\n' 'Docker disk-usage introspection unavailable within 30 seconds' | tee -a "$proof/docker-before.txt"
fi
printf 'step\tstarted_epoch\tfinished_epoch\telapsed_seconds\tstatus\n' > "$proof/timings.tsv"
measure() {
  step="$1"; shift
  started=$(date +%s)
  printf 'BEGIN %s at %s\n' "$step" "$started"
  fifo="$proof/.stream-$step"
  mkfifo "$fifo"
  tee "$proof/$step.log" < "$fifo" &
  logger_pid=$!
  set +e
  "$@" > "$fifo" 2>&1
  status=$?
  wait "$logger_pid"
  logger_status=$?
  if [ "$status" -eq 0 ] && [ "$logger_status" -ne 0 ]; then status="$logger_status"; fi
  set -e
  rm "$fifo"
  finished=$(date +%s)
  printf 'END %s at %s (status %s)\n' "$step" "$finished" "$status"
  printf '%s\t%s\t%s\t%s\t%s\n' "$step" "$started" "$finished" "$((finished-started))" "$status" >> "$proof/timings.tsv"
  return "$status"
}
# Sourced by GitLab. Actual build commands remain visible in the CI job so
# the existing functional quality gate continues to inspect their contract.
capture_production_image() {
docker image inspect "coding-box-backend:ci-${CI_JOB_ID}" > "$proof/image-inspect.json"
docker run --rm --entrypoint node "coding-box-backend:ci-${CI_JOB_ID}" --input-type=module -e '
  import fs from "node:fs";
  import crypto from "node:crypto";
  import path from "node:path";
  const files=[];
  function walk(dir) { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(entry.name === "node_modules" || entry.name === "vendor") continue;
    const name=path.join(dir,entry.name); if(entry.isDirectory()) walk(name); else files.push(name);
  }}
  walk(".");
  const hash=crypto.createHash("sha256");
  for(const name of files.sort()) { hash.update(name); hash.update("\0"); hash.update(fs.readFileSync(name)); }
  console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
    artifactSha256:hash.digest("hex"),files:files.sort()},null,2));
' > "$proof/production-artifact.json"
printf '%s\n' "${CI_COMMIT_SHA}" > "$proof/commit-sha.txt"
printf '%s\n' "${CI_PIPELINE_URL}" > "$proof/pipeline-url.txt"
cat "$proof/timings.tsv" "$proof/production-artifact.json"

# Capture the actual image's entity metadata, before any database connection.
# The probe is copied into a disposable container, never into the built image.
container="build-comparison-metadata-${CI_JOB_ID}"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -f "$proof"/.stream-*' EXIT
sed "s#../../scripts/quality/entity-metadata-snapshot.cjs#./entity-metadata-snapshot.cjs#" \
  tools/backend-build-comparison/capture-metadata.mjs > "$proof/capture-metadata.mjs"
docker create --name "$container" --network none --entrypoint node \
  -e BUILD_COMPARISON_METADATA_FILE=/tmp/entity-metadata.json \
  -e APP_ROLE=api -e POSTGRES_HOST=fixture.invalid -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=proof -e POSTGRES_PASSWORD=disposable_test_only -e POSTGRES_DB=proof \
  -e REDIS_HOST=fixture.invalid -e REDIS_PORT=6379 \
  -e JWT_SECRET=disposable-build-comparison-metadata -e OAUTH2_CLIENT_ID=proof \
  -e OIDC_ISSUER=http://fixture.invalid/realm -e OIDC_JWKS_URI=http://fixture.invalid/certs \
  "coding-box-backend:ci-${CI_JOB_ID}" --import ./capture-metadata.mjs ./main.mjs >/dev/null
docker cp "$proof/capture-metadata.mjs" "$container:/usr/src/coding-box-backend/capture-metadata.mjs"
docker cp scripts/quality/entity-metadata-snapshot.cjs "$container:/usr/src/coding-box-backend/entity-metadata-snapshot.cjs"
docker start -a "$container" > "$proof/metadata.log" 2>&1
cat "$proof/metadata.log"
[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" -eq 0 ]
docker cp "$container:/tmp/entity-metadata.json" "$proof/entity-metadata.json"

}
