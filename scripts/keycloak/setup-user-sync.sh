#!/usr/bin/env bash
set -euo pipefail

# Docker-only installations do not need a host Node.js or jq installation.
env_file=$(realpath "${1:?Usage: setup-user-sync.sh APP_ENV [ADMIN_ENV] [--auto]}")
shift
admin_file=""
mode=""
start_managed=false
for argument in "$@"; do
  case "$argument" in
    --auto) mode=--auto ;;
    --start-managed) start_managed=true ;;
    --*) printf 'Unknown setup option.\n' >&2; exit 1 ;;
    *)
      if [[ -n "$admin_file" ]]; then printf 'Only one admin env file is supported.\n' >&2; exit 1; fi
      admin_file="$argument"
      ;;
  esac
done
if "$start_managed"; then
  if [[ -z "$admin_file" || ! -f "$admin_file" ]]; then
    printf 'Starting managed Keycloak requires the infrastructure env file.\n' >&2
    exit 1
  fi
  admin_file=$(realpath "$admin_file")
  infrastructure_dir=$(dirname "$admin_file")
  (
    # The application Makefile exports its own database and port settings.
    # Let the infrastructure env file supply those settings to its Compose project.
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^([a-zA-Z_][a-zA-Z0-9_]*)= ]]; then
        unset "${BASH_REMATCH[1]}"
      fi
    done < "$admin_file"
    docker compose --env-file "$admin_file" \
      --file "$infrastructure_dir/docker-compose.traefik.yaml" \
      --file "$infrastructure_dir/docker-compose.traefik.prod.yaml" \
      up -d --no-recreate traefik keycloak
  )
fi
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
  if [[ ${!key+x} ]]; then args+=(--env "$key"); fi
done
if [[ "$mode" == --auto ]]; then node_args+=(--auto); fi
docker run "${args[@]}" "${KEYCLOAK_SETUP_NODE_IMAGE:-node:24-alpine}" \
  node /setup/setup-user-sync.mjs "${node_args[@]}"
