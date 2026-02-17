#!/usr/bin/env bash

declare TARGET_VERSION="2.0.0"
declare APP_NAME='coding-box'

update_environment_file() {
  printf "    Upgrading docker environment file '%s' ...\n" .env.${APP_NAME}

  # Load current environment variables
  # shellcheck source=.env.coding-box
  source .env.${APP_NAME}.bak

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

  # Add Keycloak Realm configuration
  keycloak_configuration="\n# Keycloak Coding Box Realm Admin\n"
  keycloak_configuration+="REALM_ADMIN_NAME=coding-box-admin\n"
  keycloak_configuration+="REALM_ADMIN_EMAIL=coding-box-admin@${SERVER_NAME}\n"
  keycloak_configuration+="REALM_ADMIN_PASSWORD=change_me\n"
  keycloak_configuration+="REALM_ADMIN_CREATED_TIMESTAMP=\n"
  printf "%b" "${keycloak_configuration}" >>.env.${APP_NAME}

  printf "    Docker environment file '%s' successfully upgraded.\n" .env.${APP_NAME}
}

main() {
  printf "    Applying patch: %s ...\n" ${TARGET_VERSION}

  update_environment_file

  printf "    Patch %s applied.\n" ${TARGET_VERSION}
}

main
