#!/usr/bin/env bash

declare TARGET_VERSION="2.0.0"
declare APP_NAME='coding-box'
declare REPO_URL="https://raw.githubusercontent.com/iqb-berlin/${APP_NAME}"

update_environment_file() {
  printf "    Upgrading docker environment file '%s' ...\n" .env.${APP_NAME}

  # Rename 'Version' comment
  sed -i.bak 's|^## Version.*|# Version|' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  # Rename 'Image Registry Path' comment
  sed -i.bak 's|^## Image Registry Path.*|# Image Registry Path|' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  ## Rename 'Docker Hub:' sub comment
  sed -i.bak 's|# Docker Hub:|## Docker Hub:|' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  ## Rename 'Docker Hub Proxy:' sub comment
  sed -i.bak 's|# Docker Hub Proxy:|## Docker Hub Proxy:|' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  ## Rename 'GitLab:' sub comment
  sed -i.bak 's|# GitLab:|## GitLab:|' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  # Move 'Infrastructure' block and rename it
  ## Delete old entries
  sed -i.bak '\|^## Infrastructure.*|d' .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak '\|^SERVER_NAME=.*|d' .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak '\|^TRAEFIK_DIR=.*|d' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  ## Create new entries
  declare infrastructure_comment
  declare tls_certificates_resolvers_comment
  declare tls_cert_resolver

  infrastructure_comment="## The Server Name and the TLS Certificates Resolvers are defined and configured in the "
  infrastructure_comment+="Traefik project.\n## 'SERVER_NAME' and 'TLS_CERTIFICATE_RESOLVER' have to be in sync with "
  infrastructure_comment+="the 'SERVER_NAME' and 'TLS_CERTIFICATE_RESOLVER'\n## in the '.env.traefik' file located at "
  infrastructure_comment+="TRAEFIK_DIR (see below)!"

  tls_certificates_resolvers_comment="\n## TLS_CERTIFICATE_RESOLVER Settings:\n### Leave it empty for user-defined "
  tls_certificates_resolvers_comment+="certificates, or choose\n### 'acme', if you want to use an acme-provider, like "
  tls_certificates_resolvers_comment+="'Let's Encrypt' or 'Sectigo'\nTLS_CERTIFICATE_RESOLVER="

  if [ -n "${TRAEFIK_DIR}" ]; then
    tls_cert_resolver=$(grep -oP 'TLS_CERTIFICATE_RESOLVER=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  fi

  sed -i.bak '\|^REGISTRY_PATH=.*|a \\n# Ingress' .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak "/^# Ingress/a ${infrastructure_comment}" .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak "\|^## in the.*|a SERVER_NAME=${SERVER_NAME}" .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak "\|^SERVER_NAME=.*|a TRAEFIK_DIR=${TRAEFIK_DIR}" .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak "/^TRAEFIK_DIR=.*/a \\${tls_certificates_resolvers_comment}" .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak "s|TLS_CERTIFICATE_RESOLVER=.*|TLS_CERTIFICATE_RESOLVER=${tls_cert_resolver}|" .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  # Delete 'JWT_SECRET' lines
  sed -i.bak '/^## Backend.*/d' .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak '/^JWT_SECRET=.*/d' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  # Rename 'Database' comment
  sed -i.bak 's|^## Database|# Database|' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  # Replace multiple empty lines with on empty line
  sed -i.bak '\|^$|N;\|^\n$|D' .env.${APP_NAME} && rm .env.${APP_NAME}.bak

  # Add OpenId Connect configuration
  oidc_configuration="# OpenID Connect (OIDC)\n"
  oidc_configuration+="OIDC_PROVIDER_URL=https://keycloak.${SERVER_NAME}\n"
  oidc_configuration+="OIDC_ISSUER=https://keycloak.${SERVER_NAME}/auth/realms/iqb\n"
  oidc_configuration+="OIDC_ACCOUNT_ENDPOINT=https://keycloak.${SERVER_NAME}/auth/realms/iqb/account\n"
  oidc_configuration+="OIDC_AUTHORIZATION_ENDPOINT=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/auth\n"
  oidc_configuration+="OIDC_TOKEN_ENDPOINT=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/token\n"
  oidc_configuration+="OIDC_USERINFO_ENDPOINT=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/userinfo\n"
  oidc_configuration+="OIDC_END_SESSION_ENDPOINT=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/logout\n"
  oidc_configuration+="OIDC_JWKS_URI=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/certs\n"
  oidc_configuration+="OAUTH2_CLIENT_ID=coding-box\n"
  oidc_configuration+="OAUTH2_CLIENT_SECRET=change_me\n"
  printf "%b" "${oidc_configuration}" >>.env.${APP_NAME}

  printf "    Docker environment file '%s' successfully upgraded.\n" .env.${APP_NAME}
}

import_keycloak_realm() {
  declare are_keycloak_services_up=false

  # Copy Coding Box realm
  declare realm_file="${TRAEFIK_DIR}/config/keycloak/${APP_NAME}-realm.json"
  if test -e "${realm_file}"; then
    declare is_realm_override
    read -p "    Keycloak realm (${realm_file}) already exists! Do you want to replace it? [Y/n] " -er -n 1 is_realm_override
    if [[ ! ${is_realm_override} =~ ^[nN]$ ]]; then
      printf "    - " && rm -v "${realm_file}"
      printf "    - " && cp -v config/keycloak/${APP_NAME}-realm.json "${realm_file}"
    fi
  else
    cp config/keycloak/${APP_NAME}-realm.json "${realm_file}"
  fi

  # Copy Coding Box realm configuration
  declare realm_config="${TRAEFIK_DIR}/config/keycloak/${APP_NAME}-realm.config"
  if test -e "${realm_config}"; then
    declare is_config_override
    read -p "    Keycloak realm configuration (${realm_config}) already exists! Do you want to replace it? [Y/n] " -er -n 1 is_config_override
    if [[ ! ${is_config_override} =~ ^[nN]$ ]]; then
      printf "    - " && rm -v "${realm_config}"
      printf "    - " && cp -v config/keycloak/${APP_NAME}-realm.config "${realm_config}"
    fi
  else
    cp config/keycloak/${APP_NAME}-realm.config "${realm_config}"
  fi

  # Start/Stop Keycloak Services
  if [ "$(docker compose \
      --env-file "${TRAEFIK_DIR}/.env.traefik" \
      --file "${TRAEFIK_DIR}/docker-compose.traefik.yaml" \
      --file "${TRAEFIK_DIR}/docker-compose.traefik.prod.yaml" \
    ps -q keycloak keycloak-db | wc -l)" != 2 ]; then
    printf "\n    One or more Keycloak services are down ...\n"

    printf "    - Starting Keycloak DB\n"
    docker compose \
        --progress quiet \
        --env-file "${TRAEFIK_DIR}/.env.traefik" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.yaml" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.prod.yaml" \
      up --detach keycloak-db
    sleep 15 # waiting keycloak started completely
    printf "    Keycloak DB is up.\n\n"
  else
    printf "    Keycloak services are up ...\n"
    are_keycloak_services_up=true

    # Stop Keycloak
    printf "    - Shutting down all Keycloak services except Keycloak DB\n"
    docker compose \
        --progress quiet \
        --env-file "${TRAEFIK_DIR}/.env.traefik" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.yaml" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.prod.yaml" \
      down keycloak
    printf "    Only Keycloak DB is up.\n\n"
  fi

  # Import Coding Box Realm
  printf "    Import Keycloak realm ...\n\n"
  declare keycloak_version keycloak_admin_name keycloak_admin_password keycloak_db_name keycloak_db_root \
    keycloak_db_root_password keycloak_container_realm_file

  keycloak_version=$(grep -oP 'quay.io/keycloak/keycloak:\K[^*]*' "${TRAEFIK_DIR}/docker-compose.traefik.yaml")
  keycloak_admin_name=$(grep -oP 'ADMIN_NAME=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_admin_password=$(grep -oP 'ADMIN_PASSWORD=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_db_name=$(grep -oP 'POSTGRES_DB=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_db_root=$(grep -oP 'POSTGRES_USER=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_db_root_password=$(grep -oP 'POSTGRES_PASSWORD=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_container_realm_file="/opt/keycloak/data/import/${APP_NAME}-realm.json"

  docker run \
      --rm \
      --name keycloak-coding-box-realm-import \
      --env KC_DB=postgres \
      --env KC_DB_URL="jdbc:postgresql://keycloak-db/${keycloak_db_name}" \
      --env KC_DB_USERNAME="${keycloak_db_root}" \
      --env KC_DB_PASSWORD="${keycloak_db_root_password}" \
      --env KC_HOSTNAME="keycloak.${SERVER_NAME}" \
      --env KEYCLOAK_ADMIN_USERNAME="${keycloak_admin_name}" \
      --env KEYCLOAK_ADMIN_PASSWORD="${keycloak_admin_password}" \
      --env JAVA_OPTS_APPEND="-Dkeycloak.migration.replace-placeholders=true" \
      --env-file "${realm_config}" \
      --volume "${realm_file}:${keycloak_container_realm_file}" \
      --network app-net \
    "quay.io/keycloak/keycloak:${keycloak_version}" import --file "${keycloak_container_realm_file}"

  printf "\n    Keycloak realm imported.\n\n"

  # Start/Stop Keycloak Services
  if ! ${are_keycloak_services_up}; then
    printf "    Shutting down Keycloak DB ...\n"
    docker compose \
        --progress quiet \
        --env-file "${TRAEFIK_DIR}/.env.traefik" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.yaml" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.prod.yaml" \
      down keycloak-db
    printf "    Keycloak DB is down again.\n\n"
  else
    printf "    Starting Keycloak Services ...\n"
    docker compose \
        --progress quiet \
        --env-file "${TRAEFIK_DIR}/.env.traefik" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.yaml" \
        --file "${TRAEFIK_DIR}/docker-compose.traefik.prod.yaml" \
      up --detach keycloak
    printf "    All Keycloak Services are up again.\n\n"
  fi
}

download_file() {
  declare local_file="${1}"
  declare remote_file="${REPO_URL}/${TARGET_VERSION}/${2}"

  if curl --silent --fail --output "${local_file}" "${remote_file}"; then
    printf "    - File '%s' successfully downloaded.\n" "${1}"
  else
    printf "    - File '%s' download failed.\n\n" "${1}"
    printf "    '%s' installation script finished with error.\n\n" "${APP_NAME}"

    exit 1
  fi
}

configure_oidc() {
  printf "\n    Configure OpenID Connect with OAuth2 Authentication ...\n"
  declare -A env_vars_oidc
  declare env_vars_order_oidc=(oidc_provider_url oidc_issuer oidc_account_endpoint oidc_authorization_endpoint
    oidc_token_endpoint oidc_userinfo_endpoint oidc_end_session_endpoint oidc_jwks_uri oauth2_client_id
    oauth2_client_secret oauth2_redirect_url)

  env_vars_oidc[oauth2_client_id]=coding-box
  env_vars_oidc[oauth2_client_secret]=$(tr -dc 'a-zA-Z0-9' </dev/urandom | fold -w 16 | head -n 1)
  env_vars_oidc[oauth2_redirect_url]="//${SERVER_NAME}/api/auth/callback"

  declare is_keycloak
  read -p "    Do you want to use the Keycloak identity provider included in the infrastructure? [Y/n] " -er -n 1 is_keycloak

  if [[ ! ${is_keycloak} =~ [nN] ]]; then
    # Realm Admin
    printf "\n    Keycloak Realm Admin\n"

    # Init coding box realm configuration
    printf "    Downloading Keycloak realm files:\n"
    mkdir -p "config/keycloak"
    download_file "config/keycloak/${APP_NAME}-realm.json" "config/keycloak/realm/${APP_NAME}-realm.json"
    download_file "config/keycloak/${APP_NAME}-realm.config.template" "config/keycloak/realm/${APP_NAME}-realm.config.template"
    cp config/keycloak/${APP_NAME}-realm.config.template config/keycloak/${APP_NAME}-realm.config
    printf "    Downloads done!\n\n"

    declare -A env_vars_realm_admin
    declare realm_admin_created_timestamp
    declare env_vars_order_realm_admin=(coding_box_admin_name coding_box_admin_email coding_box_admin_password)

    env_vars_realm_admin[coding_box_admin_name]=coding-box-admin
    env_vars_realm_admin[coding_box_admin_email]=coding-box-admin@iqb.hu-berlin.de
    env_vars_realm_admin[coding_box_admin_password]=$(tr -dc 'a-zA-Z0-9' </dev/urandom | fold -w 16 | head -n 1)

    sed -i.bak "s|^SERVER_NAME=.*|SERVER_NAME=${SERVER_NAME}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"

    declare env_var_realm_admin
    for env_var_realm_admin in "${env_vars_order_realm_admin[@]}"; do
      declare admin_env_var_name admin_env_var_value
      admin_env_var_name=$(printf %s "${env_var_realm_admin}" | tr '[:lower:]' '[:upper:]')
      admin_env_var_value="${env_vars_realm_admin[${env_var_realm_admin}]}"

      read -p "    ${admin_env_var_name}: " -er -i "${admin_env_var_value}" admin_env_var_value
      sed -i.bak "s|^${admin_env_var_name}=.*|${admin_env_var_name}=${admin_env_var_value}|" \
        "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"
    done

    realm_admin_created_timestamp=$(date --utc +"%s%3N")
    sed -i.bak \
      "s|CODING_BOX_ADMIN_CREATED_TIMESTAMP=.*|CODING_BOX_ADMIN_CREATED_TIMESTAMP=${realm_admin_created_timestamp}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"

    # OpenID Connect
    printf "\n    OpenID Connect Configuration\n"

    env_vars_oidc[oidc_provider_url]=https://keycloak.${SERVER_NAME}
    env_vars_oidc[oidc_issuer]=https://keycloak.${SERVER_NAME}/auth/realms/coding-box
    env_vars_oidc[oidc_account_endpoint]=https://keycloak.${SERVER_NAME}/auth/realms/iqb/account
    env_vars_oidc[oidc_authorization_endpoint]=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/auth
    env_vars_oidc[oidc_token_endpoint]=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/token
    env_vars_oidc[oidc_userinfo_endpoint]=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/userinfo
    env_vars_oidc[oidc_end_session_endpoint]=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/logout
    env_vars_oidc[oidc_jwks_uri]=https://keycloak.${SERVER_NAME}/auth/realms/iqb/protocol/openid-connect/certs

    declare env_var_oidc
    for env_var_oidc in "${env_vars_order_oidc[@]}"; do
      declare oidc_env_var_name oidc_env_var_value
      oidc_env_var_name=$(printf %s "${env_var_oidc}" | tr '[:lower:]' '[:upper:]')
      oidc_env_var_value="${env_vars_oidc[${env_var_oidc}]}"

      read -p "    ${oidc_env_var_name}: " -er -i "${oidc_env_var_value}" oidc_env_var_value
      sed -i.bak "s|^${oidc_env_var_name}=.*|${oidc_env_var_name}=${oidc_env_var_value}|" \
        ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"
    done

    sed -i.bak "s|CODING_BOX_CLIENT_ID=.*|CODING_BOX_CLIENT_ID=${env_vars_oidc[oauth2_client_id]}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"
    sed -i.bak "s|CODING_BOX_CLIENT_SECRET=.*|CODING_BOX_CLIENT_SECRET=${env_vars_oidc[oauth2_client_secret]}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"

    printf "\n    Keycloak Realm Import\n"
    import_keycloak_realm

  else
    env_vars_oidc[oidc_provider_url]=https://oidc_provider_url
    env_vars_oidc[oidc_issuer]=https://oidc_provider_url/oidc_issuer_path
    env_vars_oidc[oidc_account_endpoint]=https://oidc_provider_url/oidc_account_path
    env_vars_oidc[oidc_authorization_endpoint]=https://oidc_provider_url/oidc_authorization_path
    env_vars_oidc[oidc_token_endpoint]=https://oidc_provider_url/oidc_token_path
    env_vars_oidc[oidc_userinfo_endpoint]=https://oidc_provider_url/oidc_userinfo_path
    env_vars_oidc[oidc_end_session_endpoint]=https://oidc_provider_url/oidc_end_session_path
    env_vars_oidc[oidc_jwks_uri]=https://oidc_provider_url/oidc_jwks_path

    declare env_var_oidc
    for env_var_oidc in "${env_vars_order_oidc[@]}"; do
      declare oidc_env_var_name oidc_env_var_value
      oidc_env_var_value="${env_vars_oidc[${env_var_oidc}]}"
      oidc_env_var_name=$(printf %s "${env_var_oidc}" | tr '[:lower:]' '[:upper:]')

      read -p "    ${oidc_env_var_name}: " -er -i "${oidc_env_var_value}" oidc_env_var_value
      sed -i.bak "s|^${oidc_env_var_name}=.*|${oidc_env_var_name}=${oidc_env_var_value}|" \
        ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"
    done
  fi
  printf "    OpenID Connect with OAuth2 Authentication done.\n"
}

main() {
  printf "    Applying patch: %s ...\n" ${TARGET_VERSION}

  # Load current environment variables
  # shellcheck source=.env.coding-box
  source .env.${APP_NAME}

  update_environment_file
  configure_oidc

  printf "    Patch %s applied.\n" ${TARGET_VERSION}
}

main
