#!/usr/bin/env bash

declare TARGET_VERSION="2.0.0"
declare APP_NAME='coding-box'

is_weak_jwt_secret() {
  local value="$1"

  # Normalize whitespace and dotenv quoting to recognize the shipped placeholder.
  value="${value%%[[:space:]]#*}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  case "${value}" in
    \"*\") value="${value:1:${#value}-2}" ;;
    \'*\') value="${value:1:${#value}-2}" ;;
  esac
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  if [[ "${value}" == *'${'*'random_string'*'}'* ]]; then
    return 0
  fi
  [[ -z "${value}" || "${value}" == 'random_string' ]]
}

ensure_secure_jwt_secret() {
  local env_file="$1"
  local has_jwt_secret=false
  local rotate_jwt_secret=false
  local current_secret

  if [[ $# -ge 2 ]] && is_weak_jwt_secret "$2"; then
    rotate_jwt_secret=true
  fi

  while IFS= read -r current_secret; do
    has_jwt_secret=true
    if is_weak_jwt_secret "${current_secret}"; then
      rotate_jwt_secret=true
    fi
  done < <(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?JWT_SECRET[[:space:]]*=[[:space:]]*//p' "${env_file}")

  if [[ "${has_jwt_secret}" == true && "${rotate_jwt_secret}" == false ]]; then
    return 0
  fi

  local jwt_secret
  jwt_secret=$(openssl rand -hex 32) || return 1
  if [[ ! "${jwt_secret}" =~ ^[a-f0-9]{64}$ ]]; then
    printf >&2 "Failed to generate a secure JWT secret for '%s'.\n" "${env_file}"
    return 1
  fi

  if [[ "${has_jwt_secret}" == true ]]; then
    sed -E -i.bak "s|^([[:space:]]*(export[[:space:]]+)?)JWT_SECRET[[:space:]]*=.*|\1JWT_SECRET=${jwt_secret}|" "${env_file}" || return 1
    rm -f "${env_file}.bak"
    printf "    Replaced an insecure JWT_SECRET; reissue any workspace tokens signed with the old key.\n"
  else
    printf '\nJWT_SECRET=%s\n' "${jwt_secret}" >>"${env_file}" || return 1
    printf "    Generated a missing JWT_SECRET.\n"
  fi
  JWT_SECRET="${jwt_secret}"
  export JWT_SECRET
}

ensure_oauth2_redirect_url() {
  local env_file="$1"
  local server_name="$2"

  if ! grep -q '^OAUTH2_REDIRECT_URL=' "${env_file}"; then
    printf '\nOAUTH2_REDIRECT_URL=//%s/api/auth/callback\n' "${server_name}" >>"${env_file}" || return 1
  fi
}

# Only add missing settings. Existing provider/realm/client configuration is owned
# by the operator; upgrading application configuration never imports a realm.
has_env_key() {
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?${2}[[:space:]]*=" "$1"
}

append_env_value() {
  local env_file="$1" key="$2" value="$3"
  if ! has_env_key "${env_file}" "${key}"; then
    # Values are resolved above. Quote literally for both Bash and Compose dotenv.
    # A single quote requires an explicit operator setting rather than unsafe output.
    if [[ "${value}" == *"'"* || "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
      printf >&2 'Cannot safely migrate %s; configure it explicitly.\n' "${key}"
      return 1
    fi
    printf "\n%s='%s'\n" "${key}" "${value}" >>"${env_file}" || return 1
  fi
}

validate_unique_auth_keys() {
  awk '
    /^[[:space:]]*(export[[:space:]]+)?(JWT_SECRET|OIDC_[A-Z0-9_]+|OAUTH2_[A-Z0-9_]+|KEYCLOAK_[A-Z0-9_]+)[[:space:]]*=/ {
      key=$0; sub(/=.*/, "", key); sub(/^[[:space:]]*export[[:space:]]+/, "", key)
      gsub(/[[:space:]]/, "", key)
      if (++seen[key] > 1) { printf "Duplicate Auth setting: %s. Correct it before upgrading.\n", key > "/dev/stderr"; failed=1 }
    }
    END { exit failed }
  ' "$1"
}

prepare_oidc_settings() {
  local env_file="$1" key issuer
  if ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?OIDC_[A-Z0-9_]+[[:space:]]*=' "${env_file}"; then
    # Translate an explicitly configured legacy Keycloak installation, including
    # its context path and realm. Do not guess a new provider or create a client.
    if [[ ! "${KEYCLOAK_URL-}" =~ ^https?:// || -z "${KEYCLOAK_REALM-}" || -z "${KEYCLOAK_CLIENT_ID-}" ]]; then
      printf >&2 'Configure complete OIDC settings or legacy KEYCLOAK_URL/REALM/CLIENT_ID before upgrading.\n'
      return 1
    fi
    issuer="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}"
    append_env_value "${env_file}" OIDC_PROVIDER_URL "${KEYCLOAK_URL%/}" || return 1
    append_env_value "${env_file}" OIDC_ISSUER "${issuer}" || return 1
    append_env_value "${env_file}" OIDC_ACCOUNT_ENDPOINT "${issuer}/account" || return 1
    append_env_value "${env_file}" OIDC_AUTHORIZATION_ENDPOINT "${issuer}/protocol/openid-connect/auth" || return 1
    append_env_value "${env_file}" OIDC_TOKEN_ENDPOINT "${issuer}/protocol/openid-connect/token" || return 1
    append_env_value "${env_file}" OIDC_USERINFO_ENDPOINT "${issuer}/protocol/openid-connect/userinfo" || return 1
    append_env_value "${env_file}" OIDC_END_SESSION_ENDPOINT "${issuer}/protocol/openid-connect/logout" || return 1
    append_env_value "${env_file}" OIDC_JWKS_URI "${issuer}/protocol/openid-connect/certs" || return 1
    append_env_value "${env_file}" OAUTH2_CLIENT_ID "${KEYCLOAK_CLIENT_ID}" || return 1
    if ! has_env_key "${env_file}" OAUTH2_CLIENT_SECRET; then
      if ! has_env_key "${env_file}" KEYCLOAK_CLIENT_SECRET; then
        printf >&2 'Configure OAUTH2_CLIENT_SECRET (explicitly empty for a public client) before upgrading.\n'
        return 1
      fi
      append_env_value "${env_file}" OAUTH2_CLIENT_SECRET "${KEYCLOAK_CLIENT_SECRET-}" || return 1
    fi
  fi

  if ! has_env_key "${env_file}" OAUTH2_REDIRECT_URL; then
    if [[ -z "${SERVER_NAME-}" ]]; then
      printf >&2 'Configure OAUTH2_REDIRECT_URL or SERVER_NAME before upgrading.\n'
      return 1
    fi
    append_env_value "${env_file}" OAUTH2_REDIRECT_URL "//${SERVER_NAME}/api/auth/callback" || return 1
  fi

  # Resolve appended legacy entries before checking the complete login contract.
  # As before, the operator-provided environment file must be trusted Bash input.
  source "${env_file}" || return 1
  for key in OIDC_ISSUER OIDC_JWKS_URI OIDC_AUTHORIZATION_ENDPOINT OIDC_TOKEN_ENDPOINT \
    OIDC_USERINFO_ENDPOINT OIDC_END_SESSION_ENDPOINT OAUTH2_CLIENT_ID OAUTH2_REDIRECT_URL; do
    if ! has_env_key "${env_file}" "${key}" || [[ -z "${!key-}" ]]; then
      printf >&2 'Missing %s; complete the existing provider configuration before upgrading.\n' "${key}"
      return 1
    fi
  done
  for key in OIDC_ISSUER OIDC_JWKS_URI OIDC_AUTHORIZATION_ENDPOINT OIDC_TOKEN_ENDPOINT \
    OIDC_USERINFO_ENDPOINT OIDC_END_SESSION_ENDPOINT; do
    if [[ ! "${!key}" =~ ^https?://[^/[:space:]]+ ]]; then
      printf >&2 'Invalid HTTP(S) endpoint: %s.\n' "${key}"
      return 1
    fi
  done
  if ! has_env_key "${env_file}" OAUTH2_CLIENT_SECRET; then
    printf >&2 'Configure OAUTH2_CLIENT_SECRET (explicitly empty for a public client).\n'
    return 1
  fi
}

update_environment_file() (
  # Stage in the same filesystem. Failed validation never changes the live file.
  umask 077
  local env_file=".env.${APP_NAME}" backup_dir candidate original
  if [[ ! -f "${env_file}" || -L "${env_file}" ]]; then
    printf >&2 'Expected a regular .env.%s file; resolve symlinks explicitly before upgrading.\n' "${APP_NAME}"
    return 1
  fi
  validate_unique_auth_keys "${env_file}" || return 1
  backup_dir=$(mktemp -d "./.auth-upgrade-${TARGET_VERSION}.XXXXXX") || return 1
  candidate="${backup_dir}/candidate"
  original="${backup_dir}/original"
  trap 'rm -f "${candidate}" "${candidate}.bak" "${original}"; rmdir "${backup_dir}" 2>/dev/null || true' EXIT
  cp "${env_file}" "${original}" || return 1
  cp "${original}" "${candidate}" || return 1
  source "${candidate}" || return 1
  # Legacy templates reference SERVER_NAME before its assignment. Resolve those
  # forward references using the now loaded installation values before deriving URLs.
  source "${candidate}" || return 1
  prepare_oidc_settings "${candidate}" || return 1
  ensure_secure_jwt_secret "${candidate}" "${JWT_SECRET-}" || return 1

  if cmp -s "${env_file}" "${candidate}"; then
    printf '    Auth configuration already migrated; no changes.\n'
    return 0
  fi
  if ! cmp -s "${env_file}" "${original}"; then
    printf >&2 'Environment changed during migration; leaving it untouched. Retry after coordinating the change.\n'
    return 1
  fi
  # Retain the exact pre-upgrade file, with credentials restricted to its owner.
  cp "${original}" "${backup_dir}/.env.${APP_NAME}" || return 1
  mv "${candidate}" "${env_file}" || return 1
  printf '    Auth configuration upgraded. Private backup: %s/.env.%s\n' "${backup_dir}" "${APP_NAME}"
)

main() {
  printf '    Applying Auth configuration patch: %s ...\n' "${TARGET_VERSION}"
  update_environment_file || return 1
  printf '    Existing Realm, clients, users and sessions were not imported or changed.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
