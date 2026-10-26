#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
set -- test-target
source "${repo_root}/scripts/install.sh"
source "${repo_root}/scripts/migration/2.0.0.sh"

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
