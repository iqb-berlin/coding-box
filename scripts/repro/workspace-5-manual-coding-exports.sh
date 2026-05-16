#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3333/api}"
WORKSPACE_ID="${WORKSPACE_ID:-5}"
OUT_DIR="${OUT_DIR:-/tmp/kodierbox-ws${WORKSPACE_ID}-manual-coding-repro}"
EXPECTED_MANUAL_RESPONSES="${EXPECTED_MANUAL_RESPONSES:-}"
EXPECTED_DOUBLE_CODINGS="${EXPECTED_DOUBLE_CODINGS:-}"

if [[ -z "${AUTH_TOKEN:-}" ]]; then
  echo "AUTH_TOKEN is required. Example: AUTH_TOKEN=... $0" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

curl_auth() {
  curl --fail --show-error --silent --location \
    --header "Authorization: Bearer ${AUTH_TOKEN}" \
    "$@"
}

echo "Writing repro artifacts to ${OUT_DIR}"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/coding/statistics?version=v2" \
  --output "${OUT_DIR}/coding-statistics-v2.json"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/coding/double-coded-review?excludeTrainings=true&agreementFilter=differ&limit=100" \
  --output "${OUT_DIR}/double-coded-differ.json"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/coding/export/detailed?excludeAutoCoded=true" \
  --output "${OUT_DIR}/coding-results-detailed.csv"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/coding/export/aggregated?excludeAutoCoded=true&doubleCodingMethod=most-frequent" \
  --output "${OUT_DIR}/coding-results-aggregated.xlsx"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/coding/results-by-version?version=v2&includeReplayUrls=false&includeResponseValues=true" \
  --output "${OUT_DIR}/coding-results-by-version-v2.csv"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/export/sqlite" \
  --output "${OUT_DIR}/workspace.sqlite"

curl_auth \
  "${BASE_URL}/admin/workspace/${WORKSPACE_ID}/results/export" \
  --output "${OUT_DIR}/test-results.csv"

for artifact in \
  coding-statistics-v2.json \
  double-coded-differ.json \
  coding-results-detailed.csv \
  coding-results-aggregated.xlsx \
  coding-results-by-version-v2.csv \
  workspace.sqlite \
  test-results.csv
do
  if [[ ! -s "${OUT_DIR}/${artifact}" ]]; then
    echo "Artifact is empty or missing: ${artifact}" >&2
    exit 2
  fi
done

if command -v sqlite3 >/dev/null 2>&1; then
  manual_response_count="$(
    sqlite3 "${OUT_DIR}/workspace.sqlite" \
      "select count(*)
       from response r
       join unit u on u.id = r.unitid
       join booklet b on b.id = u.bookletid
       join persons p on p.id = b.personid
       where p.workspace_id = ${WORKSPACE_ID}
         and r.status_v1 in (8, 12)
         and r.status_v2 = 5
         and r.code_v2 is not null
         and r.score_v2 is not null;"
  )"
  if sqlite3 "${OUT_DIR}/workspace.sqlite" \
    "select 1 from sqlite_master where type = 'table' and name = 'coding_job_unit';" |
    grep -q 1; then
    double_coding_count="$(
      sqlite3 "${OUT_DIR}/workspace.sqlite" \
        "select count(*) from (
           select response_id
           from coding_job_unit
           where workspace_id = ${WORKSPACE_ID}
           group by response_id
           having count(distinct coding_job_id) > 1
         );"
    )"
  else
    echo "workspace.sqlite does not contain coding_job_unit" >&2
    exit 5
  fi

  echo "SQLite final manual v2 responses: ${manual_response_count}${EXPECTED_MANUAL_RESPONSES:+ (expected ${EXPECTED_MANUAL_RESPONSES})}"
  if [[ -n "${EXPECTED_MANUAL_RESPONSES}" && "${manual_response_count}" != "${EXPECTED_MANUAL_RESPONSES}" ]]; then
    echo "workspace.sqlite does not contain the expected final manual v2 response count" >&2
    exit 7
  fi

  echo "SQLite double-coded responses: ${double_coding_count}${EXPECTED_DOUBLE_CODINGS:+ (expected ${EXPECTED_DOUBLE_CODINGS})}"
  if [[ -n "${EXPECTED_DOUBLE_CODINGS}" && "${double_coding_count}" != "${EXPECTED_DOUBLE_CODINGS}" ]]; then
    echo "workspace.sqlite does not contain the expected double-coded response count" >&2
    exit 6
  fi
else
  echo "sqlite3 not found; skipping SQLite count checks"
fi

if command -v node >/dev/null 2>&1; then
  version_export_count="$(
    CSV_PATH="${OUT_DIR}/coding-results-by-version-v2.csv" node <<'NODE'
const { parseFile } = require('@fast-csv/parse');

let count = 0;
parseFile(process.env.CSV_PATH, { headers: true, delimiter: ';' })
  .on('error', error => {
    console.error(error.message);
    process.exit(1);
  })
  .on('data', row => {
    if (
      row.status_v2 === 'CODING_COMPLETE' &&
      row.code_v2 !== '' &&
      row.score_v2 !== ''
    ) {
      count += 1;
    }
  })
  .on('end', () => {
    process.stdout.write(String(count));
  });
NODE
  )"

  echo "Results-by-version v2 final manual responses: ${version_export_count}${EXPECTED_MANUAL_RESPONSES:+ (expected ${EXPECTED_MANUAL_RESPONSES})}"
  if [[ -n "${EXPECTED_MANUAL_RESPONSES}" && "${version_export_count}" != "${EXPECTED_MANUAL_RESPONSES}" ]]; then
    echo "coding-results-by-version-v2.csv does not contain the expected manual v2 responses" >&2
    exit 4
  fi
else
  echo "node not found; skipping coding-results-by-version CSV count checks"
fi

if head -n 1 "${OUT_DIR}/test-results.csv" | grep -E '(^|;|,)(code_v2|score_v2|status_v2)(;|,|$)' >/dev/null; then
  echo "test-results.csv unexpectedly contains manual v2 coding columns" >&2
  exit 3
fi

echo "Repro export matrix completed successfully."
