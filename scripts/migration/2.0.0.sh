#!/usr/bin/env bash

declare TARGET_VERSION="2.0.0"
declare APP_NAME='coding-box'

update_environment_file(){
  printf "    Upgrading docker environment file '%s' ...\n" .env.${APP_NAME}

  ## Delete 'JWT_SECRET' lines
  sed -i.bak '/^## Backend.*/d' .env.${APP_NAME} && rm .env.${APP_NAME}.bak
  sed -i.bak '/^JWT_SECRET=.*/d' .env.${APP_NAME} && rm ..env.${APP_NAME}.bak

  printf "    Docker environment file '%s' successfully upgraded.\n" .env.${APP_NAME}
}

main() {
  printf "    Applying patch: %s ...\n" ${TARGET_VERSION}

  update_environment_file

  printf "    Patch %s applied.\n" ${TARGET_VERSION}
}

main
