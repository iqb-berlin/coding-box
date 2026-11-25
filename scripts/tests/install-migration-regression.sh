#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
set -- test-target
source "${repo_root}/scripts/install.sh"

test_dir=$(mktemp -d)
trap 'rm -rf "${test_dir}"' EXIT
env_file="${test_dir}/.env.coding-box"

cat >"${env_file}" <<'EOF'
POSTGRES_USER=root
POSTGRES_PASSWORD=change_me
POSTGRES_DB=coding-box
JWT_SECRET=random_string
EOF

set_env_value "${env_file}" "$(uppercase_env_key postgres_user)" selected-user
jwt_secret=$(generate_jwt_secret)
[[ "${jwt_secret}" =~ ^[a-f0-9]{64}$ ]]
set_env_value "${env_file}" JWT_SECRET "${jwt_secret}"
grep -Fxq 'POSTGRES_USER=selected-user' "${env_file}"
grep -Fxq "JWT_SECRET=${jwt_secret}" "${env_file}"
! grep -Fq 'JWT_SECRET=random_string' "${env_file}"

print_keycloak_theme_mount() {
  cat <<EOF
services:
  keycloak:
    volumes:
      - type: bind
        source: ./config/keycloak/themes${1:-}
        target: /opt/keycloak/themes${1:-}
        read_only: ${2:-true}
EOF
}

# Only a new installation using the bundled Keycloak creates a pending marker.
(
  mkdir -p "${test_dir}/infrastructure-discovery"
  cd "${test_dir}/infrastructure-discovery"
  TRAEFIK_DIR=
  EXISTING_TRAEFIK_CONFIGS=("$PWD/existing/.env.traefik")
  APP_DIR="$PWD/coding-box"
  mkdir -p "${APP_DIR}/config/keycloak"
  pending_theme="${APP_DIR}/${KEYCLOAK_THEME_PENDING_FILE}"

  read() {
    case "${*: -1}" in
      identity_provider_choice) identity_provider_choice="${provider_answer}"; return ;;
      release) release= ;;
      *) builtin read "$@"; return ;;
    esac
  }

  curl() {
    case "$*" in
      */releases/latest) printf '{"tag_name": "2.6.2"}\n' ;;
      */2.6.2/scripts/install.sh)
        cat >"$5" <<'EOF'
#!/usr/bin/env bash
set -e
[[ "$#" -eq 1 ]]
mkdir -p new/config/keycloak
touch new/.env.traefik
printf '%s\n' "$1" >new/selected-tag
EOF
        ;;
      *) return 99 ;;
    esac
  }

  find() {
    printf '%s\0' "${EXISTING_TRAEFIK_CONFIGS[0]}" "$PWD/new/.env.traefik"
  }

  install_application_infrastructure true
  [[ "${TRAEFIK_DIR}" == "$PWD/new" ]]
  grep -Fxq '2.6.2' new/selected-tag
  grep -Fxq "${TRAEFIK_DIR}" "${pending_theme}"

  check_prerequisites() { :; }
  prepare_installation_dir() { :; }
  download_files() { exit 91; }
  customize_settings() {
    [[ "$1" == "${expected_keycloak}" && "${setup_status:-0}" == 0 ]]
  }
  application_start() { touch "${test_dir}/application-started"; }
  provider_answer=y
  expected_keycloak=true
  if (main); then
    printf 'A failed application download should abort installation.\n' >&2
    exit 1
  fi
  has_pending_keycloak_theme
  if TRAEFIK_DIR="$PWD/different" has_pending_keycloak_theme; then
    printf 'The marker should match the selected infrastructure.\n' >&2
    exit 1
  fi

  download_files() { :; }
  if (setup_status=1 main); then
    printf 'A failed Keycloak setup should abort installation.\n' >&2
    exit 1
  fi
  [[ ! -e "${test_dir}/application-started" ]]
  has_pending_keycloak_theme

  # External OIDC must leave a pending bundled Keycloak setup available for retry.
  (
    provider_answer=n
    expected_keycloak=false
    main
    has_pending_keycloak_theme
  )
  (main)
  [[ ! -e "${pending_theme}" ]]

  mkdir -p "${test_dir}/external-infrastructure"
  cd "${test_dir}/external-infrastructure"
  TRAEFIK_DIR=
  APP_DIR="$PWD/coding-box"
  mkdir -p "${APP_DIR}/config/keycloak"
  provider_answer=n
  expected_keycloak=false
  (main)
  grep -Fxq '2.6.2' new/selected-tag
  [[ ! -e "${APP_DIR}/${KEYCLOAK_THEME_PENDING_FILE}" ]]
)

# Validate both the released Traefik mount layout and a preconfigured shared mount.
(
  TRAEFIK_DIR="${test_dir}/theme-infra"
  mkdir -p "${TRAEFIK_DIR}/config/keycloak"
  cd "${test_dir}"
  read() { APP_DIR=theme-app; }
  prepare_installation_dir
  unset -f read
  [[ "${APP_DIR}" == "$(pwd -P)/theme-app" ]]
  cd "${APP_DIR}"
  realm_file="${APP_DIR}/config/keycloak/coding-box-realm.json"
  compose_file="${TRAEFIK_DIR}/docker-compose.traefik.yaml"
  themes_dir="${TRAEFIK_DIR}/config/keycloak/themes"
  pending_theme="${APP_DIR}/${KEYCLOAK_THEME_PENDING_FILE}"
  makefile="${TRAEFIK_DIR}/Makefile"
  printf 'include scripts/make/traefik.mk\n' >"${makefile}"
  cp "${repo_root}/config/keycloak/realm/coding-box-realm.json" "${realm_file}"
  cat >"${compose_file}" <<'EOF'
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.4
    volumes:
      - "./config/keycloak/themes/iqb:/opt/keycloak/themes/iqb"
EOF
  download_file() {
    cp "${repo_root}/$2" "$1"
  }

  docker() {
    [[ "${PWD}" == "${TRAEFIK_DIR}" && "$1 $2 $3 $4" == 'compose --env-file .env.traefik --file' &&
      "${*:6}" == '--file docker-compose.traefik.prod.yaml config --no-path-resolution keycloak' ]] ||
      return 99
    if [[ "$5" == .compose-theme.* && "${reject_candidate:-false}" == true ]]; then return 99; fi
    if command grep -Fq 'themes/kodierbox:/opt/keycloak/themes/kodierbox:ro' "$5"; then
      print_keycloak_theme_mount /kodierbox
    elif command grep -Fq 'themes:/opt/keycloak/themes:ro' "$5"; then
      print_keycloak_theme_mount
    else
      print_keycloak_theme_mount /iqb false
    fi
  }

  cp "${compose_file}" "${compose_file}.before"
  cp "${realm_file}" "${realm_file}.before"

  printf '%s\n' "${TRAEFIK_DIR}" >"${pending_theme}"
  if reject_candidate=true import_keycloak_realm; then
    printf 'An invalid staged Compose file must abort the pending setup.\n' >&2
    exit 1
  fi
  [[ -f "${pending_theme}" && ! -e "${themes_dir}/kodierbox" ]]
  cmp "${compose_file}" "${compose_file}.before"
  cmp "${realm_file}" "${realm_file}.before"

  mkdir -p "${themes_dir}/iqb"
  printf 'iqb\n' >"${themes_dir}/iqb/original"
  install_keycloak_theme_files
  cp "${compose_file}" "${compose_file}.configured"
  cp "${makefile}" "${makefile}.configured"
  install_keycloak_theme_files
  cmp "${compose_file}" "${compose_file}.configured"
  cmp "${makefile}" "${makefile}.configured"
  diff -r "${repo_root}/config/keycloak/themes/kodierbox" "${themes_dir}/kodierbox"
  grep -Fxq 'iqb' "${themes_dir}/iqb/original"
  sed '/themes\/kodierbox:\/opt\/keycloak\/themes\/kodierbox:ro/d' "${compose_file}" |
    cmp - "${compose_file}.before"
  sed 's/"login_theme": "kodierbox"/"login_theme": "iqb"/' "${realm_file}" | cmp - "${realm_file}.before"
  grep -Fq '"login_theme": "kodierbox"' "${realm_file}"

  sed 's@themes/iqb:/opt/keycloak/themes/iqb@themes:/opt/keycloak/themes:ro@' "${compose_file}.before" >"${compose_file}"
  cp "${compose_file}" "${compose_file}.shared"
  install_keycloak_theme_files
  cmp "${compose_file}" "${compose_file}.shared"

  # The released updater rewrites both Compose files and can call a new updater.
  cd "${TRAEFIK_DIR}"
  mkdir -p scripts/make bin
  printf 'TRAEFIK_BASE_DIR := %s\n' "$PWD" >scripts/make/traefik.mk
  cat >>scripts/make/traefik.mk <<'EOF'
.PHONY: traefik-update traefik-config
traefik-update:
	bash $(TRAEFIK_BASE_DIR)/scripts/update_traefik.sh
traefik-config:
	@printf '%s\n' '$(TRAEFIK_BASE_DIR)'
EOF
  cat >scripts/update-source.sh <<'EOF'
#!/usr/bin/env bash
set -e
cp docker-compose.traefik.yaml.before docker-compose.traefik.yaml
printf 'services: {}\n' >docker-compose.traefik.prod.yaml
cp scripts/update-selected.sh scripts/update-next.sh
mv scripts/update-next.sh scripts/update_traefik.sh
bash scripts/update_traefik.sh
EOF
  cat >scripts/update-selected.sh <<'EOF'
#!/usr/bin/env bash
set -e
if [[ ${FIXTURE_UPDATE_MODE} == restart ]]; then
  docker compose --env-file "$PWD/.env.traefik" --file "$PWD/docker-compose.traefik.yaml" \
    --file "$PWD/docker-compose.traefik.prod.yaml" up -d
elif [[ ${FIXTURE_UPDATE_MODE} == fail ]]; then
  exit 37
fi
EOF
  cat >bin/docker <<'EOF'
#!/usr/bin/env bash
set -e
[[ "$1 $2 $3 $4" == "compose --env-file $3 --file" ]]
case "$8" in
  up)
    grep -Fq 'themes/kodierbox:/opt/keycloak/themes/kodierbox:ro' "$5"
    printf 'mounted before up\n' >>compose-up.log
    ;;
  config)
    suffix=/iqb
    if grep -Fq 'themes/kodierbox:/opt/keycloak/themes/kodierbox:ro' "$5"; then suffix=/kodierbox; fi
    cat <<CONFIG
services:
  keycloak:
    volumes:
      - type: bind
        source: ./config/keycloak/themes${suffix}
        target: /opt/keycloak/themes${suffix}
        read_only: true
CONFIG
    ;;
  *) exit 99 ;;
esac
EOF
  chmod +x bin/docker
  export PATH="$PWD/bin:${PATH}"
  update_wrapper=config/keycloak/kodierbox-update/scripts/update_traefik.sh

  cp scripts/update-source.sh scripts/update_traefik.sh
  FIXTURE_UPDATE_MODE=restart make -s traefik-update
  grep -Fxq 'mounted before up' compose-up.log
  cmp "${compose_file}" "${compose_file}.configured"
  [[ "$(make -s traefik-config)" == "${TRAEFIK_DIR}" ]]

  cp scripts/update-source.sh scripts/update_traefik.sh
  FIXTURE_UPDATE_MODE=stopped make -s traefik-update
  cmp "${compose_file}" "${compose_file}.configured"
  [[ $(wc -l <compose-up.log) -eq 1 ]]

  cp scripts/update-source.sh scripts/update_traefik.sh
  update_status=0
  FIXTURE_UPDATE_MODE=fail bash "${update_wrapper}" || update_status=$?
  [[ "${update_status}" -eq 37 ]]
  cmp "${compose_file}" "${compose_file}.configured"
  [[ $(wc -l <compose-up.log) -eq 1 ]]
  cmp "${makefile}" "${makefile}.configured"
)

source "${repo_root}/scripts/migration/2.0.0.sh"

migration_legacy_env="${test_dir}/.env.legacy"
printf 'JWT_SECRET=random_string\n' >"${migration_legacy_env}"
ensure_secure_jwt_secret "${migration_legacy_env}"
migrated_jwt_secret=$(sed -n 's/^JWT_SECRET=//p' "${migration_legacy_env}")
[[ "${migrated_jwt_secret}" =~ ^[a-f0-9]{64}$ ]]
! grep -Fq 'JWT_SECRET=random_string' "${migration_legacy_env}"
ensure_secure_jwt_secret "${migration_legacy_env}"
grep -Fxq "JWT_SECRET=${migrated_jwt_secret}" "${migration_legacy_env}"

quoted_legacy_env="${test_dir}/.env.quoted-legacy"
printf 'JWT_SECRET="random_string" # shipped default\n' >"${quoted_legacy_env}"
ensure_secure_jwt_secret "${quoted_legacy_env}"
quoted_migrated_jwt_secret=$(sed -n 's/^JWT_SECRET=//p' "${quoted_legacy_env}")
[[ "${quoted_migrated_jwt_secret}" =~ ^[a-f0-9]{64}$ ]]

interpolated_default_env="${test_dir}/.env.interpolated-default"
printf 'JWT_SECRET=${JWT_SECRET:-random_string}\n' >"${interpolated_default_env}"
ensure_secure_jwt_secret "${interpolated_default_env}" random_string
interpolated_default_secret=$(sed -n 's/^JWT_SECRET=//p' "${interpolated_default_env}")
[[ "${interpolated_default_secret}" =~ ^[a-f0-9]{64}$ ]]

interpolated_alias_env="${test_dir}/.env.interpolated-alias"
printf 'JWT_SECRET=${CUSTOM_SECRET}\n' >"${interpolated_alias_env}"
ensure_secure_jwt_secret "${interpolated_alias_env}" random_string
resolved_alias_secret=$(sed -n 's/^JWT_SECRET=//p' "${interpolated_alias_env}")
[[ "${resolved_alias_secret}" =~ ^[a-f0-9]{64}$ ]]

custom_env="${test_dir}/.env.custom"
printf 'JWT_SECRET=operator-configured-secret\n' >"${custom_env}"
ensure_secure_jwt_secret "${custom_env}"
grep -Fxq 'JWT_SECRET=operator-configured-secret' "${custom_env}"

custom_interpolation_env="${test_dir}/.env.custom-interpolation"
printf 'JWT_SECRET=${CUSTOM_SECRET}\n' >"${custom_interpolation_env}"
ensure_secure_jwt_secret "${custom_interpolation_env}" operator-configured-secret
grep -Fxq 'JWT_SECRET=${CUSTOM_SECRET}' "${custom_interpolation_env}"

missing_secret_env="${test_dir}/.env.missing-secret"
printf 'POSTGRES_USER=root\n' >"${missing_secret_env}"
ensure_secure_jwt_secret "${missing_secret_env}"
appended_jwt_secret=$(sed -n 's/^JWT_SECRET=//p' "${missing_secret_env}")
[[ "${appended_jwt_secret}" =~ ^[a-f0-9]{64}$ ]]

empty_secret_env="${test_dir}/.env.empty-secret"
printf 'JWT_SECRET=\n' >"${empty_secret_env}"
ensure_secure_jwt_secret "${empty_secret_env}"
replaced_empty_secret=$(sed -n 's/^JWT_SECRET=//p' "${empty_secret_env}")
[[ "${replaced_empty_secret}" =~ ^[a-f0-9]{64}$ ]]

legacy_oidc_env="${test_dir}/.env.legacy-oidc"
printf 'KEYCLOAK_URL=https://keycloak.old.example.test/\n' >"${legacy_oidc_env}"
ensure_oauth2_redirect_url "${legacy_oidc_env}" app.example.test
grep -Fxq 'OAUTH2_REDIRECT_URL=//app.example.test/api/auth/callback' "${legacy_oidc_env}"
ensure_oauth2_redirect_url "${legacy_oidc_env}" other.example.test
[[ $(grep -c '^OAUTH2_REDIRECT_URL=' "${legacy_oidc_env}") -eq 1 ]]
grep -Fxq 'OAUTH2_REDIRECT_URL=//app.example.test/api/auth/callback' "${legacy_oidc_env}"

custom_oidc_env="${test_dir}/.env.custom-oidc"
printf 'OAUTH2_REDIRECT_URL=//custom.example.test/coding/api/auth/callback\n' >"${custom_oidc_env}"
ensure_oauth2_redirect_url "${custom_oidc_env}" app.example.test
grep -Fxq 'OAUTH2_REDIRECT_URL=//custom.example.test/coding/api/auth/callback' "${custom_oidc_env}"

migration_script="${repo_root}/scripts/migration/2.0.0.sh"

# Exercise the migration entry point against files, rather than grep its source.
mkdir -p "${test_dir}/bin" "${test_dir}/external" "${test_dir}/legacy"
for command in docker curl; do
  printf '#!/usr/bin/env bash\nprintf "Unexpected external call\\n" >&2\nexit 99\n' >"${test_dir}/bin/${command}"
  chmod +x "${test_dir}/bin/${command}"
done
export PATH="${test_dir}/bin:${PATH}"
cat >"${test_dir}/external/.env.coding-box" <<'EOF'
SERVER_NAME=operator-app.example
TRAEFIK_DIR=/operator/custom/infrastructure
TLS_CERTIFICATE_RESOLVER=custom-resolver
JWT_SECRET=operator-configured-secret
OIDC_PROVIDER_URL=https://operator-login.example
OIDC_ISSUER=https://operator-login.example/research
OIDC_AUTHORIZATION_ENDPOINT=https://operator-login.example/authorize
OIDC_TOKEN_ENDPOINT=http://private-provider:8080/token
OIDC_USERINFO_ENDPOINT=http://private-provider:8080/userinfo
OIDC_END_SESSION_ENDPOINT=http://private-provider:8080/logout
OIDC_JWKS_URI=http://private-provider:8080/jwks
OAUTH2_CLIENT_ID=operator-client
OAUTH2_CLIENT_SECRET='test-only-$literal-&-secret'
OAUTH2_REDIRECT_URL=//operator-app.example/coding/api/auth/callback
EOF
cp "${test_dir}/external/.env.coding-box" "${test_dir}/external-before"
(cd "${test_dir}/external"; bash "${migration_script}" </dev/null)
cmp "${test_dir}/external-before" "${test_dir}/external/.env.coding-box"
(cd "${test_dir}/external"; bash "${migration_script}" </dev/null)
cmp "${test_dir}/external-before" "${test_dir}/external/.env.coding-box"

cat >"${test_dir}/legacy/.env.coding-box" <<'EOF'
SERVER_NAME=operator-app.example
JWT_SECRET=operator-configured-secret
KEYCLOAK_URL=https://operator-login.example/custom/auth/
KEYCLOAK_REALM=research
KEYCLOAK_CLIENT_ID=operator-client
KEYCLOAK_CLIENT_SECRET='test-only-$literal-&-secret'
OAUTH2_REDIRECT_URL=//operator-app.example/coding/api/auth/callback
EOF
cp "${test_dir}/legacy/.env.coding-box" "${test_dir}/legacy-before"
(cd "${test_dir}/legacy"; bash "${migration_script}" </dev/null)
(
  source "${test_dir}/legacy/.env.coding-box"
  [[ "${OIDC_ISSUER}" == https://operator-login.example/custom/auth/realms/research ]]
  [[ "${OIDC_TOKEN_ENDPOINT}" == "${OIDC_ISSUER}/protocol/openid-connect/token" ]]
  [[ "${OAUTH2_CLIENT_ID}" == operator-client ]]
  [[ "${OAUTH2_CLIENT_SECRET}" == 'test-only-$literal-&-secret' ]]
  [[ "${OAUTH2_REDIRECT_URL}" == //operator-app.example/coding/api/auth/callback ]]
  [[ "${JWT_SECRET}" == operator-configured-secret ]]
)
backup_count=0
for backup_dir in "${test_dir}/legacy"/.auth-upgrade-*; do
  [[ -d "${backup_dir}" ]]
  cmp "${test_dir}/legacy-before" "${backup_dir}/.env.coding-box"
  [[ $(ls -ld "${backup_dir}" | cut -c1-10) == drwx------ ]]
  [[ $(ls -l "${backup_dir}/.env.coding-box" | cut -c1-10) == -rw------- ]]
  backup_count=$((backup_count + 1))
done
[[ "${backup_count}" -eq 1 ]]
cp "${test_dir}/legacy/.env.coding-box" "${test_dir}/legacy-after"
(cd "${test_dir}/legacy"; bash "${migration_script}" </dev/null)
cmp "${test_dir}/legacy-after" "${test_dir}/legacy/.env.coding-box"

# Partial generic OIDC and duplicate settings require operator intervention.
# In every failure case even a weak signing key must remain untouched.
for invalid_case in duplicate partial invalid-endpoint missing-legacy missing-secret; do
  mkdir "${test_dir}/${invalid_case}"
  cp "${test_dir}/external-before" "${test_dir}/${invalid_case}/.env.coding-box"
  case "${invalid_case}" in
    duplicate) printf '\n export OIDC_ISSUER=https://second.example\n' >>"${test_dir}/${invalid_case}/.env.coding-box" ;;
    partial) sed -i.bak '/^OIDC_JWKS_URI=/d' "${test_dir}/${invalid_case}/.env.coding-box" ;;
    invalid-endpoint) sed -i.bak 's|^OIDC_ISSUER=.*|OIDC_ISSUER=file:///invalid|' "${test_dir}/${invalid_case}/.env.coding-box" ;;
    missing-legacy) printf 'JWT_SECRET=random_string\nSERVER_NAME=example.test\n' >"${test_dir}/${invalid_case}/.env.coding-box" ;;
    missing-secret) sed -i.bak '/^OAUTH2_CLIENT_SECRET=/d' "${test_dir}/${invalid_case}/.env.coding-box" ;;
  esac
  sed -i.bak 's|^JWT_SECRET=.*|JWT_SECRET=random_string|' "${test_dir}/${invalid_case}/.env.coding-box"
  cp "${test_dir}/${invalid_case}/.env.coding-box" "${test_dir}/${invalid_case}/before"
  if (cd "${test_dir}/${invalid_case}"; bash "${migration_script}" </dev/null); then
    printf >&2 'Expected migration failure: %s\n' "${invalid_case}"
    exit 1
  fi
  cmp "${test_dir}/${invalid_case}/before" "${test_dir}/${invalid_case}/.env.coding-box"
done

mkdir "${test_dir}/weak-key"
sed 's/^JWT_SECRET=.*/JWT_SECRET=random_string/' "${test_dir}/external-before" >"${test_dir}/weak-key/.env.coding-box"
(cd "${test_dir}/weak-key"; bash "${migration_script}" </dev/null)
rotated_key=$(sed -n 's/^JWT_SECRET=//p' "${test_dir}/weak-key/.env.coding-box")
[[ "${rotated_key}" =~ ^[a-f0-9]{64}$ ]]
cp "${test_dir}/weak-key/.env.coding-box" "${test_dir}/weak-after"
(cd "${test_dir}/weak-key"; bash "${migration_script}" </dev/null)
cmp "${test_dir}/weak-after" "${test_dir}/weak-key/.env.coding-box"

# Exported dotenv assignments must retain a valid signing key and rotate only
# the insecure placeholder, without adding a second JWT_SECRET definition.
for exported_case in strong weak; do
  mkdir "${test_dir}/exported-${exported_case}"
  if [[ "${exported_case}" == strong ]]; then value=operator-configured-secret; else value=random_string; fi
  sed "s/^JWT_SECRET=.*/export JWT_SECRET=${value}/" "${test_dir}/external-before" >"${test_dir}/exported-${exported_case}/.env.coding-box"
  cp "${test_dir}/exported-${exported_case}/.env.coding-box" "${test_dir}/exported-${exported_case}/before"
  (cd "${test_dir}/exported-${exported_case}"; bash "${migration_script}" </dev/null)
  [[ $(grep -Ec '^(export[[:space:]]+)?JWT_SECRET=' "${test_dir}/exported-${exported_case}/.env.coding-box") -eq 1 ]]
  if [[ "${exported_case}" == strong ]]; then
    cmp "${test_dir}/exported-${exported_case}/before" "${test_dir}/exported-${exported_case}/.env.coding-box"
  else
    (source "${test_dir}/exported-${exported_case}/.env.coding-box"; [[ "${JWT_SECRET}" =~ ^[a-f0-9]{64}$ ]])
  fi
  cp "${test_dir}/exported-${exported_case}/.env.coding-box" "${test_dir}/exported-${exported_case}/after"
  (cd "${test_dir}/exported-${exported_case}"; bash "${migration_script}" </dev/null)
  cmp "${test_dir}/exported-${exported_case}/after" "${test_dir}/exported-${exported_case}/.env.coding-box"
done

# Shipped legacy templates put KEYCLOAK_URL before SERVER_NAME.
mkdir "${test_dir}/forward-reference"
cat >"${test_dir}/forward-reference/.env.coding-box" <<'EOF'
JWT_SECRET=operator-configured-secret
KEYCLOAK_URL=https://keycloak.${SERVER_NAME}/custom/auth/
KEYCLOAK_REALM=research
KEYCLOAK_CLIENT_ID=operator-client
KEYCLOAK_CLIENT_SECRET=
SERVER_NAME=operator.example
EOF
(cd "${test_dir}/forward-reference"; bash "${migration_script}" </dev/null)
(
  # Inspect using the same dotenv/Bash semantics as the migration entry point.
  set +u
  source "${test_dir}/forward-reference/.env.coding-box"
  [[ "${OIDC_ISSUER}" == https://keycloak.operator.example/custom/auth/realms/research ]]
  [[ "${OAUTH2_REDIRECT_URL}" == //operator.example/api/auth/callback ]]
  [[ -z "${OAUTH2_CLIENT_SECRET}" ]]
)
cp "${test_dir}/forward-reference/.env.coding-box" "${test_dir}/forward-after"
(cd "${test_dir}/forward-reference"; bash "${migration_script}" </dev/null)
cmp "${test_dir}/forward-after" "${test_dir}/forward-reference/.env.coding-box"

mkdir "${test_dir}/symlink" "${test_dir}/concurrent"
ln -s "${test_dir}/legacy-before" "${test_dir}/symlink/.env.coding-box"
if (cd "${test_dir}/symlink"; bash "${migration_script}" </dev/null); then exit 1; fi
[[ -L "${test_dir}/symlink/.env.coding-box" ]]
cmp "${test_dir}/legacy-before" "${test_dir}/symlink/.env.coding-box"
cp "${test_dir}/external-before" "${test_dir}/concurrent/.env.coding-box"
(
  cd "${test_dir}/concurrent"
  source "${migration_script}"
  # Simulate an operator edit while the candidate is being prepared.
  ensure_secure_jwt_secret() {
    printf '\nOPERATOR_CHANGE=retained\n' >>.env.coding-box
    printf '\nSTAGED_CHANGE=discarded\n' >>"$1"
  }
  if update_environment_file; then exit 1; fi
  grep -Fxq 'OPERATOR_CHANGE=retained' .env.coding-box
  ! grep -q '^STAGED_CHANGE=' .env.coding-box
)

printf 'Installer and upgrade regression checks passed.\n'
