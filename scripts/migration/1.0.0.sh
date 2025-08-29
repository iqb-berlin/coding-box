#!/usr/bin/env bash

declare TARGET_VERSION="1.0.0"
declare APP_NAME='coding-box'

migrate_make_coding-box_update() {
  printf "      Patching file '%s' ...\n" "scripts/make/${APP_NAME}.mk"

  if ! grep -q '.sh -s \$(TAG)' scripts/make/${APP_NAME}.mk; then
    sed -i.bak "s|scripts/update_${APP_NAME}.sh|scripts/update_${APP_NAME}.sh -s \$(TAG)|" \
      "${PWD}/scripts/make/${APP_NAME}.mk" && rm "${PWD}/scripts/make/${APP_NAME}.mk.bak"
  fi

  printf "      File '%s' patched.\n" "scripts/make/${APP_NAME}.mk"
}

main() {
  printf "    Applying patch: %s ...\n" ${TARGET_VERSION}

  migrate_make_coding-box_update

  printf "    Patch %s applied.\n" ${TARGET_VERSION}
}

main
