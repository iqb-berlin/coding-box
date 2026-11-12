#!/usr/bin/env bash
set -euo pipefail

# Docker-only installations do not need a host Node.js or jq installation.
env_file=$(realpath "${1:?Usage: setup-user-sync.sh APP_ENV [ADMIN_ENV] [--auto]}")
shift
admin_file=""
mode=""
for argument in "$@"; do
  case "$argument" in
    --auto) mode=--auto ;;
    --*) printf 'Unknown setup option.\n' >&2; exit 1 ;;
    *)
      if [[ -n "$admin_file" ]]; then printf 'Only one admin env file is supported.\n' >&2; exit 1; fi
      admin_file="$argument"
      ;;
  esac
done
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
args=(--rm --user "$(id -u):$(id -g)" --network "${KEYCLOAK_SETUP_NETWORK:-app-net}"
  --mount "type=bind,src=$(dirname "$env_file"),dst=/configuration"
  --mount "type=bind,src=$script_dir,dst=/setup,readonly")
node_args=(--env "/configuration/$(basename "$env_file")")
if [[ -n "$admin_file" && -f "$admin_file" ]]; then
  args+=(--mount "type=bind,src=$(realpath "$admin_file"),dst=/run/keycloak-admin.env,readonly")
  node_args+=(--admin-env /run/keycloak-admin.env)
fi
for key in KEYCLOAK_SETUP_ADMIN_USERNAME KEYCLOAK_SETUP_ADMIN_PASSWORD KEYCLOAK_SETUP_ADMIN_REALM; do
  if [[ -v $key ]]; then args+=(--env "$key"); fi
done
if [[ "$mode" == --auto ]]; then node_args+=(--auto); fi
docker run "${args[@]}" "${KEYCLOAK_SETUP_NODE_IMAGE:-node:24-alpine}" \
  node /setup/setup-user-sync.mjs "${node_args[@]}"
