#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Release tag required}
archive_dir=${2:?Image archive directory required}
registry=${3:?Target registry required}

if [[ "$registry" != docker.io && ! "$registry" =~ ^127\.0\.0\.1:[0-9]+$ ]]; then
  echo "Unsupported release registry: $registry" >&2
  exit 1
fi
node scripts/ci/check-release-version.mjs "$tag"

images=(db db-pg17 liquibase backend frontend)
version_refs=()
latest_refs=()

# Load all five checked images before the first push.
for image in "${images[@]}"; do
  docker image load --input "$archive_dir/$image.tar.zst"

  suffix=''
  if [[ "$image" == db-pg17 ]]; then
    suffix='-pg17'
  fi
  repository="$registry/iqbberlin/coding-box-${image%-pg17}"
  source="coding-box-$image:ci"
  version_ref="$repository:$tag$suffix"
  docker image tag "$source" "$version_ref"
  version_refs+=("$version_ref")

  if [[ "$tag" != *-* ]]; then
    latest_ref="$repository:latest$suffix"
    docker image tag "$source" "$latest_ref"
    latest_refs+=("$latest_ref")
  fi
done

# Advance the stable aliases only after the complete versioned set is pushed.
for ref in "${version_refs[@]}"; do
  docker image push "$ref"
done
if [[ "$tag" != *-* ]]; then
  for ref in "${latest_refs[@]}"; do
    docker image push "$ref"
  done
fi
