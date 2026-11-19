#!/usr/bin/env bash
set -eu -o pipefail

# Send COMMIT only once pg_restore has produced the entire archive and the
# rebuild has succeeded. A truncated stream or SQL error rolls back both.
{
  echo 'BEGIN;'
  pg_restore --data-only --disable-triggers --exit-on-error --file=- "$1" &&
    echo 'SELECT public.rebuild_flat_response_workspace(); COMMIT;'
} | psql -X --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"
