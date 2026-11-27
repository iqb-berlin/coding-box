#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?This check needs a runner temporary directory}"
: "${TRIVY_IMAGE:?Set TRIVY_IMAGE to the scanner image}"
image="${1:?Specify the built image to scan}"
case "$image" in
  db|db-pg17|liquibase|backend|frontend)
    zstd --decompress --stdout "$RUNNER_TEMP/images/$image.tar.zst" | docker load
    target="coding-box-$image:ci"
    ;;
  traefik)
    target=traefik:v2.11
    docker pull "$target"
    ;;
  *) echo "Unknown scan target: $image" >&2; exit 2 ;;
esac

mkdir -p "$RUNNER_TEMP/trivy"
trivy=(docker run --rm --volume /var/run/docker.sock:/var/run/docker.sock
  --volume "$RUNNER_TEMP/trivy:/reports" --env TRIVY_CACHE_DIR=/reports/cache
  "$TRIVY_IMAGE" image --timeout 20m --scanners vuln --no-progress)
"${trivy[@]}" --exit-code 0 --format json --output /reports/report.json "$target"
"${trivy[@]}" --exit-code 1 --ignore-unfixed --severity CRITICAL "$target"
