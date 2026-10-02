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

migration_script="${repo_root}/scripts/migration/2.0.0.sh"
grep -Fq 'ensure_secure_jwt_secret ".env.${APP_NAME}"' "${migration_script}"
grep -Fq 'OIDC_ISSUER=https://keycloak.${SERVER_NAME}/realms/coding-box' "${migration_script}"
grep -Fq 'OIDC_TOKEN_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/token' "${migration_script}"
! grep -Fq '/auth/realms/iqb' "${migration_script}"

printf 'Installer and upgrade regression checks passed.\n'
