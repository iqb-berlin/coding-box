#!/usr/bin/env bash

has_keycloak_theme_mount() {
  awk '
    /^  [^[:space:]]/ { keycloak = ($1 == "keycloak:"); volumes = 0 }
    keycloak && /^    [^[:space:]]/ { volumes = ($1 == "volumes:") }
    volumes && /^      - / { bind = source = target = read_only = 0 }
    volumes && /^(      - |        )type: bind$/ { bind = 1 }
    volumes && /^(      - |        )source: \.\/config\/keycloak\/themes(\/kodierbox)?$/ {
      source = $NF; sub(/^\.\/config/, "/opt", source)
    }
    volumes && /^(      - |        )target: \/opt\/keycloak\/themes(\/kodierbox)?$/ { target = $NF }
    volumes && /^(      - |        )read_only: true$/ { read_only = 1 }
    volumes && bind && source && source == target && read_only { found = 1 }
    END { exit !found }
  '
}

ensure_keycloak_theme_mount() (
  cd "$1" || return 1
  local compose_file=docker-compose.traefik.yaml
  local -a compose=(docker compose --env-file .env.traefik)
  local config staged_compose
  config=$("${compose[@]}" --file "${compose_file}" --file docker-compose.traefik.prod.yaml \
    config --no-path-resolution keycloak) || return 1
  if has_keycloak_theme_mount <<<"${config}"; then
    return 0
  fi

  # Keep the bind mount in the local file used by the regular Traefik start commands.
  staged_compose=$(mktemp .compose-theme.XXXXXXXX) || return 1
  trap 'rm -f "${staged_compose}"' EXIT
  cp -p "${compose_file}" "${staged_compose}" || return 1
  awk '
    /^  [^[:space:]]/ { keycloak = ($1 == "keycloak:") }
    { print }
    keycloak && /^    volumes:[[:space:]]*$/ {
      print "      - \"./config/keycloak/themes/kodierbox:/opt/keycloak/themes/kodierbox:ro\""
      mounts++
    }
    END { if (mounts != 1) exit 1 }
  ' "${compose_file}" >"${staged_compose}" || return 1

  config=$("${compose[@]}" --file "${staged_compose}" --file docker-compose.traefik.prod.yaml \
    config --no-path-resolution keycloak) || return 1
  has_keycloak_theme_mount <<<"${config}" || return 1
  mv "${staged_compose}" "${compose_file}"
)

traefik_update_with_keycloak_theme() (
  local update_status=0
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." || return 1
  export KODIERBOX_TRAEFIK_DIR="$PWD"
  export TRAEFIK_BASE_DIR="$PWD"

  docker() {
    if [[ "${1:-}" == compose && "$PWD" == "${KODIERBOX_TRAEFIK_DIR}" ]]; then
      local arg uses_traefik_compose=false starts_services=false
      for arg in "$@"; do
        case "${arg}" in
          "${KODIERBOX_TRAEFIK_DIR}/docker-compose.traefik.yaml"|./docker-compose.traefik.yaml|docker-compose.traefik.yaml)
            uses_traefik_compose=true ;;
          up|start)
            starts_services=true ;;
        esac
      done
      if ${uses_traefik_compose} && ${starts_services}; then
        ensure_keycloak_theme_mount "${KODIERBOX_TRAEFIK_DIR}" || return 1
      fi
    fi
    command docker "$@"
  }

  # Traefik can restart services itself or run the selected release's updater in a child Bash.
  export -f docker ensure_keycloak_theme_mount has_keycloak_theme_mount
  bash scripts/update_traefik.sh "$@" || update_status=$?

  # The operator can also leave the stack stopped after the update.
  if ! ensure_keycloak_theme_mount "${KODIERBOX_TRAEFIK_DIR}"; then
    printf 'Could not restore the local Kodierbox theme mount after the Traefik update.\n' >&2
    return 1
  fi
  return "${update_status}"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  traefik_update_with_keycloak_theme "$@"
fi
