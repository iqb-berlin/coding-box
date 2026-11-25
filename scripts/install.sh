#!/usr/bin/env bash
set -e

declare APP_DIR
declare APP_NAME='coding-box'
declare REPO_URL="https://raw.githubusercontent.com/iqb-berlin/${APP_NAME}"
declare REPO_API="https://api.github.com/repos/iqb-berlin/${APP_NAME}"

declare INSTALL_SCRIPT_NAME="${0}"
declare TARGET_VERSION="${1}"
declare MAKE_BASE_DIR_NAME='CODING_BOX_BASE_DIR'
declare REQUIRED_PACKAGES=("docker -v" "docker compose version")
declare OPTIONAL_PACKAGES=("make -v")

declare TRAEFIK_DIR
declare -a EXISTING_TRAEFIK_CONFIGS=()
declare TRAEFIK_REPO_URL="https://raw.githubusercontent.com/iqb-berlin/traefik"
declare TRAEFIK_REPO_API="https://api.github.com/repos/iqb-berlin/traefik"
declare KEYCLOAK_THEME_PENDING_FILE='config/keycloak/.kodierbox-theme-pending'

set_env_value() {
  local env_file="$1"
  local env_key="$2"
  local env_value="$3"
  sed -i.bak "s|^${env_key}=.*|${env_key}=${env_value}|" "${env_file}" && rm "${env_file}.bak"
}

uppercase_env_key() {
  printf %s "$1" | tr '[:lower:]' '[:upper:]'
}

generate_jwt_secret() {
  openssl rand -hex 32
}

get_release_version() {
  declare latest_release
  latest_release=$(curl --silent "${REPO_API}/releases/latest" |
    grep tag_name |
    cut -d : -f 2,3 |
    tr -d \" |
    tr -d , |
    tr -d " ")

  while read -p '1. Please name the desired release tag: ' -er -i "${latest_release}" TARGET_VERSION; do
    if ! curl --head --silent --fail --output /dev/null "${REPO_URL}/${TARGET_VERSION}/README.md" 2>/dev/null; then
      printf "This version tag does not exist.\n"
    else
      break
    fi
  done

  # Check install script matches the selected release ...
  declare new_install_script="${REPO_URL}/${TARGET_VERSION}/scripts/install.sh"
  if ! curl --stderr /dev/null "${new_install_script}" | diff -q - "${INSTALL_SCRIPT_NAME}" &>/dev/null; then
    printf -- '- Current install script does not match the selected release install script!\n'
    printf '  Downloading a new install script for the selected release ...\n'
    mv "${INSTALL_SCRIPT_NAME}" "${INSTALL_SCRIPT_NAME}_old"
    if curl --silent --fail --output "install_${APP_NAME}.sh" "${new_install_script}"; then
      chmod +x "install_${APP_NAME}.sh"
      printf '  Download successful!\n\n'
    else
      printf '  Download failed!\n\n'
      printf "  '%s' install script finished with error.\n" "${APP_NAME}"
      exit 1
    fi

    printf "  The current install process will now execute the downloaded install script and terminate itself.\n"
    declare is_continue
    read -p "  Do you want to continue? [Y/n] " -er -n 1 is_continue
    if [[ ${is_continue} =~ ^[nN]$ ]]; then
      printf "\n  You can check the the new install script (e.g.: 'less %s') or " "install_${APP_NAME}.sh"
      printf "compare it with the old one (e.g.: 'diff %s %s').\n\n" \
        "install_${APP_NAME}.sh" "${INSTALL_SCRIPT_NAME}_old"

      printf "  If you want to resume this install process, please type: 'bash install_%s.sh %s'\n\n" \
        "${APP_NAME}" "${TARGET_VERSION}"

      printf "'%s' install script finished.\n" "${APP_NAME}"
      exit 0
    fi

    bash "install_${APP_NAME}.sh" "${TARGET_VERSION}"

    # remove old install script
    if [ -f "${INSTALL_SCRIPT_NAME}_old" ]; then
      rm "${INSTALL_SCRIPT_NAME}_old"
    fi

    exit ${?}
  fi

  printf "\n"
}

check_prerequisites() {
  printf "2. Checking prerequisites:\n\n"

  printf "2.1 Checking required packages ...\n"
  # Check required packages are installed
  declare req_package
  for req_package in "${REQUIRED_PACKAGES[@]}"; do
    if ${req_package} >/dev/null 2>&1; then
      printf -- "- '%s' is working.\n" "${req_package}"
    else
      printf "'%s' not working, please install the corresponding package before running!\n" "${req_package}"
      exit 1
    fi
  done
  printf "Required packages successfully checked.\n\n"

  # Check optional packages are installed
  declare opt_package
  printf "2.2 Checking optional packages ...\n"
  for opt_package in "${OPTIONAL_PACKAGES[@]}"; do
    if ${opt_package} >/dev/null 2>&1; then
      printf -- "- '%s' is working.\n" "${opt_package}"
    else
      printf "%s not working! It is recommended to have the corresponding package installed.\n" "${opt_package}"
      declare is_continue
      read -p 'Continue anyway? [y/N] ' -er -n 1 is_continue

      if [[ ! ${is_continue} =~ ^[yY]$ ]]; then
        exit 1
      fi
    fi
  done
  printf "Optional packages successfully checked.\n\n"

  printf "2.3 Checking application infrastructure software is installed ...\n"
  # Check edge router (traefik) is already installed
  readarray -d '' EXISTING_TRAEFIK_CONFIGS < <(find / -name ".env.traefik" -print0 2>/dev/null)

  declare traefik_dir_count=${#EXISTING_TRAEFIK_CONFIGS[*]}
  if [ "${traefik_dir_count}" -eq 0 ]; then
    printf -- "- No 'Traefik' installation found.\n"
    TRAEFIK_DIR=""

  elif [ "${traefik_dir_count}" -eq 1 ]; then
    printf -- "- 'Traefik' installation found:\n"
    printf -- "  [1] %s\n" "$(dirname "${EXISTING_TRAEFIK_CONFIGS[0]}")"
    printf -- "  [2] Additional Installation\n\n"
    declare choice
    while read -p "Which one do you want to choose? [1/2] " -er choice; do
      if [ "${choice}" = 1 ]; then
        TRAEFIK_DIR=$(dirname "${EXISTING_TRAEFIK_CONFIGS[0]}")
        break

      elif [ "${choice}" = 2 ]; then
        TRAEFIK_DIR=""
        break

      fi
    done

  else
    printf -- "- Multiple 'Traefik' installations found:\n"
    for ((i = 0; i < traefik_dir_count; i++)); do
      printf -- "  [%d] %s\n" $((i + 1)) "$(dirname "${EXISTING_TRAEFIK_CONFIGS[i]}")"
    done
    printf -- "  [%d] Additional Installation\n\n" $((traefik_dir_count + 1))

    while read -p "Which one do you want to choose? [1-$((traefik_dir_count + 1))] " -er choice; do
      if [ "${choice}" -gt 0 ] && [ "${choice}" -le "${traefik_dir_count}" ]; then
        TRAEFIK_DIR=$(dirname "${EXISTING_TRAEFIK_CONFIGS[$((choice - 1))]}")
        break

      elif [ "${choice}" -eq $((traefik_dir_count + 1)) ]; then
        TRAEFIK_DIR=""
        break
      fi
    done
  fi

  printf "\nPrerequisites check finished successfully.\n\n"
}

install_application_infrastructure() {
  local use_infrastructure_keycloak="$1"
  if [ -z "${TRAEFIK_DIR}" ]; then
    printf "3.1 Installing missing application infrastructure software:\n"
    local latest_release release installer
    local selected_release=''
    latest_release=$(curl --silent "${TRAEFIK_REPO_API}/releases/latest" |
      sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')
    installer=$(mktemp) || return 1
    while read -er -i "${latest_release}" -p 'Please name the desired Traefik release tag: ' release; do
      release="${release:-${latest_release}}"
      if [[ -z "${release}" ]]; then
        continue
      fi
      printf "Downloading Traefik installation script version %s ...\n" "${release}"
      if curl --fail --silent --show-error --output "${installer}" \
        "${TRAEFIK_REPO_URL}/${release}/scripts/install.sh"; then
        selected_release="${release}"
        break
      fi
      printf 'Traefik release %s could not be downloaded. Select another release.\n' "${release}" >&2
    done
    if [[ -z "${selected_release}" ]]; then
      rm "${installer}"
      printf 'No Traefik release selected.\n' >&2
      return 1
    fi

    printf 'Downloaded installation script will be started now.\n\n'
    if ! bash "${installer}" "${selected_release}"; then
      rm "${installer}"
      printf 'Traefik installation script finished with error\n' >&2
      return 1
    fi
    rm "${installer}"

    printf '\nChecking Infrastructure installation ...\n'
    declare -a traefik_dir_array=()
    declare config_path existing_path
    while IFS= read -r -d '' config_path; do
      for existing_path in "${EXISTING_TRAEFIK_CONFIGS[@]}"; do
        if [ "${existing_path}" = "${config_path}" ]; then
          continue 2
        fi
      done
      traefik_dir_array+=("${config_path}")
    done < <(find / -name ".env.traefik" -print0 2>/dev/null)

    declare traefik_dir_count=${#traefik_dir_array[*]}
    if [ "${traefik_dir_count}" -eq 0 ]; then
      printf -- '- No application infrastructure settings found.\n'
      printf 'Install script finished with error\n'
      exit 1

    elif [ "${traefik_dir_count}" -eq 1 ]; then
      TRAEFIK_DIR=$(dirname "${traefik_dir_array[0]}")

    else
      printf -- "- Multiple 'Traefik' installations found:\n"
      for ((i = 0; i < traefik_dir_count; i++)); do
        printf -- "  [%d] %s\n" $((i + 1)) "$(dirname "${traefik_dir_array[i]}")"
      done

      declare choice
      while read -p "Which one do you want to choose? [1-${traefik_dir_count}] " -er choice; do
        if [ "${choice}" -gt 0 ] && [ "${choice}" -le "${traefik_dir_count}" ]; then
          TRAEFIK_DIR="$(dirname "${traefik_dir_array[$((choice - 1))]}")"
          break
        fi
      done
    fi

    if [[ -z "${TRAEFIK_DIR}" ]]; then
      printf 'No Traefik installation selected.\n' >&2
      return 1
    fi
    if ${use_infrastructure_keycloak}; then
      printf '%s\n' "${TRAEFIK_DIR}" >"${APP_DIR}/${KEYCLOAK_THEME_PENDING_FILE}" || return 1
    fi
    printf "Infrastructure installation checked.\n"
    printf "\n"
    printf "Missing application infrastructure successfully installed.\n"
    printf "\n"
    printf "\n"
    printf -- "------------------------------------------------------------\n"
    printf "Proceed with the original '%s' installation ...\n" "${APP_NAME}"
    printf -- "------------------------------------------------------------\n"
    printf "\n"
  fi
}

prepare_installation_dir() {
  while read -p '3. Determine installation directory: ' -er -i "${PWD}/${APP_NAME}" APP_DIR; do
    if [ ! -e "${APP_DIR}" ]; then
      break

    elif [ -d "${APP_DIR}" ] && [ -z "$(find "${APP_DIR}" -maxdepth 0 -type d -empty 2>/dev/null)" ]; then
      declare is_continue
      read -p "You have selected a non empty directory. Continue anyway? [y/N] " -er -n 1 is_continue
      if [[ ! ${is_continue} =~ ^[yY]$ ]]; then
        printf "'%s' installation script finished.\n" "${APP_NAME}"
        exit 0
      fi

      break

    else
      printf "'%s' is not a directory!\n\n" "${APP_DIR}"
    fi

  done

  printf "\n"

  mkdir -p "${APP_DIR}/backup/release"
  mkdir -p "${APP_DIR}/backup/temp"
  mkdir -p "${APP_DIR}/config/frontend"
  mkdir -p "${APP_DIR}/config/keycloak"
  mkdir -p "${APP_DIR}/scripts/make"
  mkdir -p "${APP_DIR}/scripts/migration"

  APP_DIR=$(cd "${APP_DIR}" && pwd -P)
}

download_file() {
  declare local_file="${1}"
  declare remote_file="${REPO_URL}/${TARGET_VERSION}/${2}"

  if curl --silent --fail --output "${local_file}" "${remote_file}"; then
    printf -- "- File '%s' successfully downloaded.\n" "${1}"
  else
    printf -- "- File '%s' download failed.\n\n" "${1}"
    printf "'%s' installation script finished with error.\n\n" "${APP_NAME}"

    exit 1
  fi
}

download_files() {
  printf "4. Downloading files:\n"

  download_file "docker-compose.${APP_NAME}.yaml" docker-compose.yaml
  download_file "docker-compose.${APP_NAME}.prod.yaml" "docker-compose.${APP_NAME}.prod.yaml"
  download_file ".env.${APP_NAME}.template" ".env.${APP_NAME}.template"
  download_file "config/frontend/default.conf.http-template" "config/frontend/default.conf.http-template"
  download_file "config/keycloak/${APP_NAME}-realm.json" "config/keycloak/realm/${APP_NAME}-realm.json"
  download_file "config/keycloak/${APP_NAME}-realm.config.template" "config/keycloak/realm/${APP_NAME}-realm.config.template"
  download_file "scripts/make/${APP_NAME}.mk" scripts/make/prod.mk
  download_file "scripts/update_${APP_NAME}.sh" scripts/update.sh
  chmod +x "scripts/update_${APP_NAME}.sh"

  printf "Downloads done!\n\n"
}

install_keycloak_theme_files() {
  local theme_path=config/keycloak/themes/kodierbox
  local theme_dir="${TRAEFIK_DIR}/${theme_path}"
  local update_script="${TRAEFIK_DIR}/config/keycloak/kodierbox-update/scripts/update_traefik.sh"
  local makefile="${TRAEFIK_DIR}/Makefile"
  local update_target='traefik-update: TRAEFIK_BASE_DIR := $(TRAEFIK_BASE_DIR)/config/keycloak/kodierbox-update'
  local realm_file="${APP_DIR}/config/keycloak/${APP_NAME}-realm.json"
  local -a theme_files=(
    login/theme.properties
    login/messages/messages_de.properties
    login/messages/messages_en.properties
    login/resources/css/kodierbox.css
    login/resources/img/iqb-logo.png
    login/resources/img/favicon.ico
    admin/theme.properties
    admin/resources/css/kodierbox-admin.css
  )
  local theme_file

  if ! grep -Eq '"login_theme": "(iqb|kodierbox)"' "${realm_file}"; then
    printf "Could not find the login theme setting for the Kodierbox client in %s.\n" "${realm_file}" >&2
    return 1
  fi

  install -d -m 0755 "$(dirname "${update_script}")" || return 1
  download_file "${update_script}" scripts/update-traefik-with-kodierbox.sh
  if ! (source "${update_script}" && ensure_keycloak_theme_mount "${TRAEFIK_DIR}"); then
    printf 'Could not configure the read-only Kodierbox theme mount in %s.\n' "${TRAEFIK_DIR}" >&2
    return 1
  fi

  printf "Installing the Kodierbox login and administration themes for the new Keycloak.\n"
  for theme_file in "${theme_files[@]}"; do
    install -d -m 0755 "${theme_dir}/$(dirname "${theme_file}")" || return 1
    download_file "${theme_dir}/${theme_file}" "${theme_path}/${theme_file}"
    chmod 0644 "${theme_dir}/${theme_file}" || return 1
  done

  # The Traefik updater replaces its own script and included make rules, but keeps the local Makefile.
  if [[ -f "${makefile}" ]] && ! grep -Fxq "${update_target}" "${makefile}"; then
    printf '\n# Preserve the Kodierbox theme during an infrastructure update.\n%s\n' "${update_target}" >>"${makefile}" || return 1
  fi

  # The downloaded realm assigns its login theme to the Kodierbox client.
  sed -i.bak 's/"login_theme": "iqb"/"login_theme": "kodierbox"/' "${realm_file}" &&
    rm "${realm_file}.bak"
}

has_pending_keycloak_theme() {
  local pending_theme="${APP_DIR}/${KEYCLOAK_THEME_PENDING_FILE}"
  [[ -n "${TRAEFIK_DIR}" && -f "${pending_theme}" && $(cat "${pending_theme}") == "${TRAEFIK_DIR}" ]]
}

wait_for_keycloak() {
  "$@" exec -T keycloak bash -c '
    port=${KC_HTTP_PORT:-8080}
    deadline=$((SECONDS + 180))
    until (
      exec 3<>"/dev/tcp/127.0.0.1/${port}" &&
      printf "GET /realms/master/.well-known/openid-configuration HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3 &&
      IFS= read -r -t 2 status <&3 &&
      [[ ${status} == HTTP/*" 200 "* ]]
    ) 2>/dev/null; do
      if (( SECONDS >= deadline )); then
        printf "Keycloak did not become ready for theme configuration.\n" >&2
        exit 1
      fi
      sleep 2
    done
  ' </dev/null
}

configure_keycloak_admin_theme() {
  wait_for_keycloak "$@" || return 1
  # Keycloak 26 reads the password from the environment. Older releases read stdin.
  "$@" exec -T keycloak bash -ec '
    admin_name=${KC_BOOTSTRAP_ADMIN_USERNAME:-${KEYCLOAK_ADMIN:?Missing Keycloak admin username}}
    admin_password=${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KEYCLOAK_ADMIN_PASSWORD:?Missing Keycloak admin password}}
    port=${KC_HTTP_PORT:-8080}

    update_realm() {
      printf "%s\n" "${admin_password}" |
        KC_CLI_PASSWORD="${admin_password}" /opt/keycloak/bin/kcadm.sh update "$@" --no-config \
          --server "http://127.0.0.1:${port}" --realm master --user "${admin_name}"
    }

    update_realm realms/master -s loginTheme=kodierbox -s adminTheme=kodierbox
    update_realm realms/coding-box -s adminTheme=kodierbox
  ' </dev/null || return 1
  printf "Kodierbox administration themes configured.\n"
}

import_keycloak_realm() {
  local install_theme=false
  if has_pending_keycloak_theme; then
    install_keycloak_theme_files || return 1
    install_theme=true
  fi
  local -a keycloak_compose=(docker compose --progress quiet
    --env-file "${TRAEFIK_DIR}/.env.traefik"
    --file "${TRAEFIK_DIR}/docker-compose.traefik.yaml"
    --file "${TRAEFIK_DIR}/docker-compose.traefik.prod.yaml")

  # Copy Coding Box realm
  declare realm_file="${TRAEFIK_DIR}/config/keycloak/${APP_NAME}-realm.json"
  if test -e "${realm_file}"; then
    declare is_realm_override
    read -p "Keycloak realm (${realm_file}) already exists! Do you want to replace it? [Y/n] " -er -n 1 is_realm_override
    if [[ ! ${is_realm_override} =~ ^[nN]$ ]]; then
      printf -- "- " && rm -v "${realm_file}"
      printf -- "- " && cp -v config/keycloak/${APP_NAME}-realm.json "${realm_file}"
    fi
  else
    cp config/keycloak/${APP_NAME}-realm.json "${realm_file}"
  fi

  # Copy Coding Box realm configuration
  declare realm_config="${TRAEFIK_DIR}/config/keycloak/${APP_NAME}-realm.config"
  if test -e "${realm_config}"; then
    declare is_config_override
    read -p "Keycloak realm configuration (${realm_config}) already exists! Do you want to replace it? [Y/n] " -er -n 1 is_config_override
    if [[ ! ${is_config_override} =~ ^[nN]$ ]]; then
      printf -- "- " && rm -v "${realm_config}"
      printf -- "- " && cp -v config/keycloak/${APP_NAME}-realm.config "${realm_config}"
    fi
  else
    cp config/keycloak/${APP_NAME}-realm.config "${realm_config}"
  fi

  # Start/Stop Keycloak Services
  local running_services
  running_services=$("${keycloak_compose[@]}" ps -q keycloak keycloak-db) || return 1
  local keycloak_was_running=false
  if [ "$(wc -w <<<"${running_services}")" -eq 2 ]; then
    keycloak_was_running=true
  fi
  if ${install_theme} && ! ${keycloak_was_running}; then
    # On a fresh database, bootstrap the master administrator before the offline realm import.
    "${keycloak_compose[@]}" up --detach keycloak || return 1
  fi
  if ${keycloak_was_running} || ${install_theme}; then
    if ${install_theme} && ! wait_for_keycloak "${keycloak_compose[@]}"; then
      if ! ${keycloak_was_running}; then
        "${keycloak_compose[@]}" down keycloak keycloak-db
      fi
      return 1
    fi
    printf -- "- Shutting down all Keycloak services except Keycloak DB\n"
    "${keycloak_compose[@]}" down keycloak || return 1
    printf "Only Keycloak DB is up.\n\n"
  else
    printf -- "- Starting Keycloak DB\n"
    "${keycloak_compose[@]}" up --detach keycloak-db || return 1
    sleep 15
    printf "Keycloak DB is up.\n\n"
  fi

  # Import Coding Box Realm
  printf "Import Keycloak realm ...\n"
  declare keycloak_version keycloak_admin_name keycloak_admin_password keycloak_db_name keycloak_db_root \
    keycloak_db_root_password keycloak_container_realm_file

  keycloak_version=$(grep -oP 'quay.io/keycloak/keycloak:\K[^*]*' "${TRAEFIK_DIR}/docker-compose.traefik.yaml")
  keycloak_admin_name=$(grep -oP 'ADMIN_NAME=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_admin_password=$(grep -oP 'ADMIN_PASSWORD=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_db_name=$(grep -oP 'POSTGRES_DB=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_db_root=$(grep -oP 'POSTGRES_USER=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_db_root_password=$(grep -oP 'POSTGRES_PASSWORD=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  keycloak_container_realm_file="/opt/keycloak/data/import/${APP_NAME}-realm.json"

  local import_status=0
  docker run \
      --rm \
      --name keycloak-coding-box-realm-import \
      --env KC_DB=postgres \
      --env KC_DB_URL="jdbc:postgresql://keycloak-db/${keycloak_db_name}" \
      --env KC_DB_USERNAME="${keycloak_db_root}" \
      --env KC_DB_PASSWORD="${keycloak_db_root_password}" \
      --env KC_HOSTNAME="keycloak.${server_name}" \
      --env KEYCLOAK_ADMIN_USERNAME="${keycloak_admin_name}" \
      --env KEYCLOAK_ADMIN_PASSWORD="${keycloak_admin_password}" \
      --env JAVA_OPTS_APPEND="-Dkeycloak.migration.replace-placeholders=true" \
      --env-file "${realm_config}" \
      --volume "${realm_file}:${keycloak_container_realm_file}" \
      --network app-net \
    "quay.io/keycloak/keycloak:${keycloak_version}" import --file "${keycloak_container_realm_file}" || import_status=$?

  if [ "${import_status}" -eq 0 ]; then
    printf "Keycloak realm imported.\n\n"
  else
    printf "Could not import the Kodierbox Realm into Keycloak.\n" >&2
  fi

  # Start/Stop Keycloak Services
  if ${keycloak_was_running} || { ${install_theme} && [[ "${import_status}" -eq 0 ]]; }; then
    printf "Starting Keycloak Services ...\n"
    "${keycloak_compose[@]}" up --detach keycloak || return 1
    if ${install_theme} && [[ "${import_status}" -eq 0 ]]; then
      configure_keycloak_admin_theme "${keycloak_compose[@]}" || import_status=$?
    fi
    if ! ${keycloak_was_running}; then
      "${keycloak_compose[@]}" down keycloak || return 1
    fi
  fi
  if ! ${keycloak_was_running}; then
    printf "Shutting down Keycloak DB ...\n"
    "${keycloak_compose[@]}" down keycloak-db || return 1
    printf "Keycloak DB is down again.\n\n"
  fi
  return "${import_status}"
}

customize_settings() {
  local use_infrastructure_keycloak="$1"
  # Activate environment file
  cp ".env.${APP_NAME}.template" ".env.${APP_NAME}"

  # Set Edge Router Directory
  sed -i.bak "s|^TRAEFIK_DIR.*|TRAEFIK_DIR=${TRAEFIK_DIR}|" ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"

  # Load defaults
  # shellcheck source=.env.coding-box
  source ".env.${APP_NAME}"

  local jwt_secret
  jwt_secret=$(generate_jwt_secret)
  if [[ ! "${jwt_secret}" =~ ^[a-f0-9]{64}$ ]]; then
    printf >&2 "Failed to generate a secure JWT secret.\n"
    return 1
  fi
  set_env_value ".env.${APP_NAME}" JWT_SECRET "${jwt_secret}"

  if [ "${EXPORT_WORKER_PGOPTIONS:-}" = "-c" ]; then
    printf >&2 "Invalid EXPORT_WORKER_PGOPTIONS in '.env.%s': the '-c' option requires a value.\n" "${APP_NAME}"
    printf >&2 'Quote values containing spaces, for example: EXPORT_WORKER_PGOPTIONS="-c jit=off"\n'
    exit 1
  fi

  # Setup environment variables
  printf "5. Docker environment setup\n"
  printf "Default passwords are generated randomly.\n\n"

  ## Version
  sed -i.bak "s|^TAG=.*|TAG=${TARGET_VERSION}|" ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"

  ## Server & TLS Certificate Resolver
  declare server_name
  declare resolver
  if [ -n "${TRAEFIK_DIR}" ]; then
    server_name=$(grep -oP 'SERVER_NAME=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
    resolver=$(grep -oP 'TLS_CERTIFICATE_RESOLVER=\K[^*]*' "${TRAEFIK_DIR}/.env.traefik")
  else
    read -p "SERVER_NAME: " -er -i "${server_name}" server_name
  fi
  sed -i.bak "s|^SERVER_NAME=.*|SERVER_NAME=${server_name}|" ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"
  sed -i.bak "s|TLS_CERTIFICATE_RESOLVER.*|TLS_CERTIFICATE_RESOLVER=${resolver}|" ".env.${APP_NAME}" &&
    rm ".env.${APP_NAME}.bak"

  ## Database
  printf "5.1 Coding Box DB\n"
  declare -A env_vars_postgres
  declare env_vars_order_postgres=(postgres_user postgres_password postgres_db)

  env_vars_postgres[postgres_user]=root
  env_vars_postgres[postgres_password]=$(tr -dc 'a-zA-Z0-9' </dev/urandom | fold -w 16 | head -n 1)
  env_vars_postgres[postgres_db]="${APP_NAME}"

  declare env_var_postgres
  for env_var_postgres in "${env_vars_order_postgres[@]}"; do
    declare postgres_env_var_name postgres_env_var_value
    postgres_env_var_name=$(uppercase_env_key "${env_var_postgres}")
    postgres_env_var_value="${env_vars_postgres[${env_var_postgres}]}"

    read -p "${postgres_env_var_name}: " -er -i "${postgres_env_var_value}" postgres_env_var_value
    set_env_value ".env.${APP_NAME}" "${postgres_env_var_name}" "${postgres_env_var_value}"
  done

  ## OpenID Connect
  printf "\n5.2 OpenID Connect with OAuth2 Authentication\n"
  declare -A env_vars_oidc
  declare env_vars_order_oidc=(oidc_provider_url oidc_issuer oidc_account_endpoint oidc_authorization_endpoint
    oidc_token_endpoint oidc_userinfo_endpoint oidc_end_session_endpoint oidc_jwks_uri oauth2_client_id
    oauth2_client_secret oauth2_redirect_url)

  env_vars_oidc[oauth2_client_id]=coding-box
  env_vars_oidc[oauth2_client_secret]=$(tr -dc 'a-zA-Z0-9' </dev/urandom | fold -w 16 | head -n 1)
  env_vars_oidc[oauth2_redirect_url]="//${server_name}/api/auth/callback"

  if ${use_infrastructure_keycloak}; then
    # Init coding box realm configuration
    cp config/keycloak/${APP_NAME}-realm.config.template config/keycloak/${APP_NAME}-realm.config

    ### Realm Admin
    printf "\nKeycloak Realm Admin\n"

    declare -A env_vars_realm_admin
    declare realm_admin_created_timestamp
    declare env_vars_order_realm_admin=(coding_box_admin_name coding_box_admin_email coding_box_admin_password)

    env_vars_realm_admin[coding_box_admin_name]=coding-box-admin
    env_vars_realm_admin[coding_box_admin_email]=coding-box-admin@iqb.hu-berlin.de
    env_vars_realm_admin[coding_box_admin_password]=$(tr -dc 'a-zA-Z0-9' </dev/urandom | fold -w 16 | head -n 1)

    sed -i.bak "s|^SERVER_NAME=.*|SERVER_NAME=${server_name}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"

    declare env_var_realm_admin
    for env_var_realm_admin in "${env_vars_order_realm_admin[@]}"; do
      declare admin_env_var_name admin_env_var_value
      admin_env_var_name=$(printf %s "${env_var_realm_admin}" | tr '[:lower:]' '[:upper:]')
      admin_env_var_value="${env_vars_realm_admin[${env_var_realm_admin}]}"

      read -p "${admin_env_var_name}: " -er -i "${admin_env_var_value}" admin_env_var_value
      sed -i.bak "s|^${admin_env_var_name}=.*|${admin_env_var_name}=${admin_env_var_value}|" \
        "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"
    done

    realm_admin_created_timestamp=$(date --utc +"%s%3N")
    sed -i.bak \
      "s|CODING_BOX_ADMIN_CREATED_TIMESTAMP=.*|CODING_BOX_ADMIN_CREATED_TIMESTAMP=${realm_admin_created_timestamp}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"

    ### OpenID Connect
    printf "\nOpenID Connect Configuration\n"

    env_vars_oidc[oidc_provider_url]=https://keycloak.${server_name}
    env_vars_oidc[oidc_issuer]=https://keycloak.${server_name}/realms/coding-box
    env_vars_oidc[oidc_account_endpoint]=https://keycloak.${server_name}/realms/coding-box/account
    env_vars_oidc[oidc_authorization_endpoint]=https://keycloak.${server_name}/realms/coding-box/protocol/openid-connect/auth
    env_vars_oidc[oidc_token_endpoint]=https://keycloak.${server_name}/realms/coding-box/protocol/openid-connect/token
    env_vars_oidc[oidc_userinfo_endpoint]=https://keycloak.${server_name}/realms/coding-box/protocol/openid-connect/userinfo
    env_vars_oidc[oidc_end_session_endpoint]=https://keycloak.${server_name}/realms/coding-box/protocol/openid-connect/logout
    env_vars_oidc[oidc_jwks_uri]=https://keycloak.${server_name}/realms/coding-box/protocol/openid-connect/certs

    declare env_var_oidc
    for env_var_oidc in "${env_vars_order_oidc[@]}"; do
      declare oidc_env_var_name oidc_env_var_value
      oidc_env_var_name=$(printf %s "${env_var_oidc}" | tr '[:lower:]' '[:upper:]')
      oidc_env_var_value="${env_vars_oidc[${env_var_oidc}]}"

      read -p "${oidc_env_var_name}: " -er -i "${oidc_env_var_value}" oidc_env_var_value
      sed -i.bak "s|^${oidc_env_var_name}=.*|${oidc_env_var_name}=${oidc_env_var_value}|" \
        ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"
    done

    sed -i.bak "s|CODING_BOX_CLIENT_ID=.*|CODING_BOX_CLIENT_ID=${env_vars_oidc[oauth2_client_id]}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"
    sed -i.bak "s|CODING_BOX_CLIENT_SECRET=.*|CODING_BOX_CLIENT_SECRET=${env_vars_oidc[oauth2_client_secret]}|" \
      "config/keycloak/${APP_NAME}-realm.config" && rm "config/keycloak/${APP_NAME}-realm.config.bak"

    printf "\nKeycloak Realm Import\n"
    import_keycloak_realm || return 1

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

      read -p "${oidc_env_var_name}: " -er -i "${oidc_env_var_value}" oidc_env_var_value
      sed -i.bak "s|^${oidc_env_var_name}=.*|${oidc_env_var_name}=${oidc_env_var_value}|" \
        ".env.${APP_NAME}" && rm ".env.${APP_NAME}.bak"
    done
  fi

  # Setup makefiles
  sed -i.bak "s|^${MAKE_BASE_DIR_NAME} :=.*|${MAKE_BASE_DIR_NAME} := \\${APP_DIR}|" \
    "scripts/make/${APP_NAME}.mk" && rm "scripts/make/${APP_NAME}.mk.bak"
  sed -i.bak "s|scripts/update.sh|scripts/update_${APP_NAME}.sh|" \
    "scripts/make/${APP_NAME}.mk" && rm "scripts/make/${APP_NAME}.mk.bak"

  if [ -n "${TRAEFIK_DIR}" ] && [ "${TRAEFIK_DIR}" != "${APP_DIR}" ]; then
    cp "${TRAEFIK_DIR}/Makefile" Makefile
    printf "include %s/scripts/make/%s.mk\n" "${APP_DIR}" "${APP_NAME}" >>Makefile
  elif [ -n "${TRAEFIK_DIR}" ] && [ "${TRAEFIK_DIR}" == "${APP_DIR}" ]; then
    printf "include %s/scripts/make/%s.mk\n" "${APP_DIR}" "${APP_NAME}" >>Makefile
  else
    printf "include %s/scripts/make/%s.mk\n" "${APP_DIR}" "${APP_NAME}" >Makefile
  fi

  # Init nginx http configuration
  cp ./config/frontend/default.conf.http-template config/frontend/default.conf.template

  printf "\n"
}

application_start() {
  printf "'%s' installation done.\n\n" "${APP_NAME}"

  declare is_start_now
  read -p "Do you want to start ${APP_NAME} now? [Y/n] " -er -n 1 is_start_now
  printf '\n'
  if [[ ! ${is_start_now} =~ [nN] ]]; then
    if ! test "$(docker network ls -q --filter name=app-net)"; then
      docker network create app-net
    fi
    docker compose \
        --env-file ".env.${APP_NAME}" \
        --file "docker-compose.${APP_NAME}.yaml" \
        --file "docker-compose.${APP_NAME}.prod.yaml" \
      pull
    docker compose \
        --env-file ".env.${APP_NAME}" \
        --file "docker-compose.${APP_NAME}.yaml" \
        --file "docker-compose.${APP_NAME}.prod.yaml" \
      up -d
  else
    printf "'%s' installation script finished.\n" "${APP_NAME}"
  fi
}

main() {
  if [ -z "${TARGET_VERSION}" ]; then
    printf "\n==================================================\n"
    printf "'%s' installation script started ..." "${APP_NAME}" | tr '[:lower:]' '[:upper:]'
    printf "\n==================================================\n"
    printf "\n"

    get_release_version
  fi

  check_prerequisites
  prepare_installation_dir
  local identity_provider_choice
  local use_infrastructure_keycloak=true
  read -p "Do you want to use the Keycloak identity provider included in the infrastructure? [Y/n] " -er -n 1 identity_provider_choice
  if [[ "${identity_provider_choice}" =~ ^[nN]$ ]]; then
    use_infrastructure_keycloak=false
  fi

  install_application_infrastructure "${use_infrastructure_keycloak}" || return 1
  cd "${APP_DIR}" || return 1
  download_files
  customize_settings "${use_infrastructure_keycloak}" || return 1
  application_start || return 1

  if ${use_infrastructure_keycloak} && has_pending_keycloak_theme; then
    rm "${APP_DIR}/${KEYCLOAK_THEME_PENDING_FILE}"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
