#!/usr/bin/env bash

declare TARGET_VERSION="0.14.0"

delete_legacy_backup_subdirectory() {
  if [ -d backup/database_dump ]; then
    mv backup/database_dump/* backup/
    rmdir --ignore-fail-on-non-empty backup/database_dump
    printf -- "    - Legacy backup subdirectory 'database_dump' deleted.\n"
    printf -- "      Subdirectory content moved to parent directory.\n"
  fi
}

main() {
  printf "    Applying patch: %s ...\n" ${TARGET_VERSION}

  delete_legacy_backup_subdirectory

  printf "    Patch %s applied.\n" ${TARGET_VERSION}
}

main
