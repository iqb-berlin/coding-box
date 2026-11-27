#!/usr/bin/env bash
set -euo pipefail

version=$(node -p "require('./package.json').version")
prerelease="$version-beta.2"

assert_compose_images() {
  local registry_path=$1 image_prefix=$2 postgres_suffix=$3
  REGISTRY_PATH="$registry_path" POSTGRES_IMAGE_SUFFIX="$postgres_suffix" \
    TAG="$version" SERVER_NAME=kodierbox.invalid docker compose \
    --env-file .env.coding-box.template -f docker-compose.yaml -f docker-compose.coding-box.prod.yaml \
    config --format json |
    jq -e --arg prefix "$image_prefix" --arg tag "$version" --arg suffix "$postgres_suffix" '
      .services |
      [.db.image, .liquibase.image, .backend.image, ."backend-export-worker".image, .frontend.image] == [
        ($prefix + "coding-box-db:" + $tag + $suffix),
        ($prefix + "coding-box-liquibase:" + $tag),
        ($prefix + "coding-box-backend:" + $tag),
        ($prefix + "coding-box-backend:" + $tag),
        ($prefix + "coding-box-frontend:" + $tag)
      ]
    ' >/dev/null
}

assert_compose_images '' 'ghcr.io/iqb-berlin/' ''
assert_compose_images '' 'ghcr.io/iqb-berlin/' '-pg17'
assert_compose_images 'docker.io/' 'docker.io/iqbberlin/' '-pg17'
echo 'Production Compose image references verified.'

images=(db db-pg17 liquibase backend frontend)
for image in "${images[@]}"; do
  if docker image inspect "coding-box-$image:ci" >/dev/null 2>&1; then
    echo "Run this test in a Docker environment without coding-box-$image:ci." >&2
    exit 1
  fi
done

temp=$(mktemp -d)
container=''
registry=''
cleanup() {
  if [[ -n "$container" ]]; then
    docker stop "$container" >/dev/null
  fi
  if [[ -n "$registry" ]]; then
    docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$registry/iqb-berlin/*" |
      while IFS= read -r ref; do docker image rm "$ref" >/dev/null; done
  fi
  for image in "${images[@]}"; do
    docker image rm "coding-box-$image:ci" >/dev/null 2>&1 || true
  done
  rm -rf -- "$temp"
}
trap cleanup EXIT

container=$(docker run --detach --rm --publish 127.0.0.1::5000 \
  registry:3@sha256:82f6ff4a7f982960c8aa51617fea3aabc485df6e55cce80d22deb1de36f1bc3c)
registry=$(docker port "$container" 5000/tcp)
curl --fail --silent --show-error --retry 20 --retry-delay 1 --retry-connrefused \
  "http://$registry/v2/" >/dev/null

mkdir "$temp/archives" "$temp/partial" "$temp/fixture"
for image in "${images[@]}"; do
  source="coding-box-$image:ci"
  printf '%s\n' "$image" > "$temp/fixture/image"
  tar --format ustar -cf - -C "$temp/fixture" image | docker image import - "$source"
  docker image inspect --format '{{.Id}}' "$source" > "$temp/$image.id"
  docker image save "$source" | zstd -q -o "$temp/archives/$image.tar.zst"
  docker image rm "$source" >/dev/null
done

for image in db db-pg17 liquibase backend; do
  ln "$temp/archives/$image.tar.zst" "$temp/partial/"
done
if bash scripts/ci/publish-release-images.sh "$version" "$temp/partial" "$registry"; then
  echo 'Publishing must fail when a checked image is missing.' >&2
  exit 1
fi
curl -fsS "http://$registry/v2/_catalog" | jq -e '.repositories == []' >/dev/null

assert_tags() {
  local repo=$1
  shift
  curl -fsS "http://$registry/v2/iqb-berlin/coding-box-$repo/tags/list" |
    jq -e --args '(.tags | sort) == ($ARGS.positional | sort)' "$@" >/dev/null
}

assert_image() {
  local ref="$registry/iqb-berlin/coding-box-$1" image=$2
  docker image pull --quiet "$ref"
  [[ "$(docker image inspect --format '{{.Id}}' "$ref")" == "$(cat "$temp/$image.id")" ]]
}

bash scripts/ci/publish-release-images.sh "$prerelease" "$temp/archives" "$registry"
assert_tags db "$prerelease" "$prerelease-pg17"
assert_image "db:$prerelease" db
assert_image "db:$prerelease-pg17" db-pg17
for image in liquibase backend frontend; do
  assert_tags "$image" "$prerelease"
  assert_image "$image:$prerelease" "$image"
done

bash scripts/ci/publish-release-images.sh "$version" "$temp/archives" "$registry"
assert_tags db "$prerelease" "$prerelease-pg17" "$version" "$version-pg17" latest latest-pg17
assert_image "db:$version" db
assert_image "db:$version-pg17" db-pg17
assert_image db:latest db
assert_image db:latest-pg17 db-pg17
for image in liquibase backend frontend; do
  assert_tags "$image" "$prerelease" "$version" latest
  assert_image "$image:$version" "$image"
  assert_image "$image:latest" "$image"
done
echo 'Prerelease tags, stable tags and all published image identities verified.'
