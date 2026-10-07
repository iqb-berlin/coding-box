#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONFIG = Object.freeze({
  host: 'iqb-kodierbox.de',
  port: '24242',
  database: 'coding-box',
  databaseUser: 'root',
  databaseContainer: 'coding-box-db-1',
  redisContainer: 'coding-box-redis-1',
  cadvisorContainer: 'traefik-cadvisor-1',
  queueKey: 'coding-box:test-person-coding:102',
  workspaceId: 2,
  affectedPersonCount: 200,
  expectedScopeResponseCount: 83018,
  expectedRestoreCount: 1161,
  backupPath: '/rootfs/home/iqb/coding-box/backup/2026-08-20/coding-box_dump',
  backupSize: 6677658848,
  backupCreatedAt: '2026-08-20 22:09:33 CEST',
  confirmationToken: 'RESTORE_WORKSPACE_2_V2_2026_08_21'
});

const COPY_COLUMNS = Object.freeze([
  'unitid',
  'variableid',
  'status',
  'value',
  'subform',
  'code_v1',
  'score_v1',
  'id',
  'status_v1',
  'status_v2',
  'code_v2',
  'score_v2',
  'status_v3',
  'code_v3',
  'score_v3',
  'is_autocoder_generated'
]);

function parseArguments(argv) {
  const result = {
    apply: false,
    confirm: '',
    outputDir: resolve('tmp/workspace-2-v2-recovery')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      result.apply = true;
    } else if (argument === '--confirm') {
      result.confirm = argv[++index] || '';
    } else if (argument === '--output-dir') {
      result.outputDir = resolve(argv[++index] || '');
    } else if (argument === '--help') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/recovery/workspace-2-v2-recovery.mjs
  node scripts/recovery/workspace-2-v2-recovery.mjs --output-dir <directory>

The default mode is strictly read-only on the production server. It creates a
local recovery plan, apply.sql, rollback.sql and validation reports.

The production write path is deliberately double-gated:
  node scripts/recovery/workspace-2-v2-recovery.mjs \\
    --apply --confirm ${CONFIG.confirmationToken}

Never use --apply without explicit production approval.`);
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    ...options
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with ${result.status}\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

function runRemote(command, input) {
  return runProcess(
    'ssh',
    ['-p', CONFIG.port, CONFIG.host, command],
    input === undefined ? {} : { input }
  );
}

function runReadOnlySql(sql) {
  const command = [
    'docker exec -i',
    `-e PGOPTIONS='-c default_transaction_read_only=on'`,
    CONFIG.databaseContainer,
    'psql -X -q -v ON_ERROR_STOP=1',
    `-U ${CONFIG.databaseUser}`,
    `-d ${CONFIG.database}`
  ].join(' ');
  return runRemote(command, sql);
}

function assertIntegerString(value, label) {
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`${label} is not an integer: ${value}`);
  }
  return Number(value);
}

function assertSignedIntegerString(value, label) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`${label} is not an integer: ${value}`);
  }
  return Number(value);
}

function parseCopyRows(text, expectedColumns) {
  return text
    .split('\n')
    .filter((line) => line.length > 0 && line !== '\\.')
    .map((line, index) => {
      const columns = line.split('\t');
      if (columns.length !== expectedColumns) {
        throw new Error(
          `COPY row ${index + 1} has ${columns.length} columns; expected ${expectedColumns}`
        );
      }
      return columns;
    });
}

function isPgNull(value) {
  return value === '\\N';
}

function pgInteger(value, label) {
  return isPgNull(value) ? null : assertSignedIntegerString(value, label);
}

function decodeCopyText(value) {
  if (isPgNull(value)) return null;

  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\') {
      decoded += value[index];
      continue;
    }

    index += 1;
    const escaped = value[index];
    const simpleEscapes = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\'
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      decoded += simpleEscapes[escaped];
      continue;
    }

    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(value[index + 1] || '')) {
        octal += value[++index];
      }
      decoded += String.fromCharCode(Number.parseInt(octal, 8));
      continue;
    }

    if (escaped === 'x') {
      let hexadecimal = '';
      while (
        hexadecimal.length < 2 &&
        /[0-9a-f]/i.test(value[index + 1] || '')
      ) {
        hexadecimal += value[++index];
      }
      decoded += hexadecimal
        ? String.fromCharCode(Number.parseInt(hexadecimal, 16))
        : 'x';
      continue;
    }

    decoded += escaped;
  }
  return decoded;
}

function responseFromCopyRow(columns) {
  const response = Object.fromEntries(
    COPY_COLUMNS.map((column, index) => [column, columns[index]])
  );
  return {
    encoded: response,
    id: assertIntegerString(response.id, 'response.id'),
    unitid: assertIntegerString(response.unitid, 'response.unitid'),
    variableid: decodeCopyText(response.variableid),
    status: assertIntegerString(response.status, 'response.status'),
    codeV1: pgInteger(response.code_v1, 'response.code_v1'),
    scoreV1: pgInteger(response.score_v1, 'response.score_v1'),
    statusV1: pgInteger(response.status_v1, 'response.status_v1'),
    statusV2: pgInteger(response.status_v2, 'response.status_v2'),
    codeV2: pgInteger(response.code_v2, 'response.code_v2'),
    scoreV2: pgInteger(response.score_v2, 'response.score_v2'),
    statusV3: pgInteger(response.status_v3, 'response.status_v3'),
    codeV3: pgInteger(response.code_v3, 'response.code_v3'),
    scoreV3: pgInteger(response.score_v3, 'response.score_v3'),
    isAutocoderGenerated: response.is_autocoder_generated === 't'
  };
}

function csvCell(value, nullMarker = '') {
  if (value === null || value === undefined) return nullMarker;
  const text = String(value);
  if (text === '\\N' || /[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function csvRow(values, nullMarker = '') {
  return values.map((value) => csvCell(value, nullMarker)).join(',');
}

async function writePrivateFile(path, content) {
  await writeFile(path, content, { mode: 0o600 });
}

function getJobData() {
  const output = runRemote(
    `docker exec ${CONFIG.redisContainer} redis-cli --raw HGET ${CONFIG.queueKey} data`
  ).trim();
  if (!output) throw new Error(`Queue job data not found: ${CONFIG.queueKey}`);

  const job = JSON.parse(output);
  if (job.workspaceId !== CONFIG.workspaceId) {
    throw new Error(`Unexpected workspaceId: ${job.workspaceId}`);
  }
  if (
    !Array.isArray(job.personIds) ||
    job.personIds.length < CONFIG.affectedPersonCount
  ) {
    throw new Error('Queue job does not contain the expected person scope');
  }

  const affectedPersonIds = job.personIds
    .slice(0, CONFIG.affectedPersonCount)
    .map((value, index) => assertIntegerString(value, `personIds[${index}]`));
  if (new Set(affectedPersonIds).size !== CONFIG.affectedPersonCount) {
    throw new Error('The first 200 job person IDs are not unique');
  }

  return { job, affectedPersonIds };
}

function getBackupMetadata() {
  const stat = runRemote(
    `docker exec ${CONFIG.cadvisorContainer} stat -c '%s|%y' ${CONFIG.backupPath}`
  ).trim();
  const [sizeText, modifiedAt] = stat.split('|');
  const size = assertIntegerString(sizeText, 'backup size');
  if (size !== CONFIG.backupSize) {
    throw new Error(
      `Backup size changed: ${size}; expected ${CONFIG.backupSize}`
    );
  }

  const toc = runRemote(
    `docker exec ${CONFIG.cadvisorContainer} cat ${CONFIG.backupPath} | ` +
      `docker exec -i ${CONFIG.databaseContainer} pg_restore --list`
  );
  if (!toc.includes(`Archive created at ${CONFIG.backupCreatedAt}`)) {
    throw new Error(
      'Backup creation timestamp does not match the verified archive'
    );
  }
  if (!/TABLE DATA public response/.test(toc)) {
    throw new Error('Backup does not contain public.response table data');
  }

  return {
    path: CONFIG.backupPath,
    size,
    modifiedAt,
    createdAt: CONFIG.backupCreatedAt,
    tocSha256: createHash('sha256').update(toc).digest('hex')
  };
}

function getScopeSummary(affectedPersonIds) {
  const personIds = affectedPersonIds.join(',');
  const sql = `COPY (
    SELECT
      count(*) AS responses,
      count(*) FILTER (
        WHERE r.status_v2 IS NOT NULL OR r.code_v2 IS NOT NULL OR r.score_v2 IS NOT NULL
      ) AS v2_present,
      count(*) FILTER (
        WHERE r.status_v3 IS NOT NULL OR r.code_v3 IS NOT NULL OR r.score_v3 IS NOT NULL
      ) AS v3_present
    FROM response r
    JOIN unit u ON u.id = r.unitid
    JOIN booklet b ON b.id = u.bookletid
    WHERE b.personid = ANY (ARRAY[${personIds}]::integer[])
  ) TO STDOUT WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');\n`;
  const [row] = parseCopyRows(runReadOnlySql(sql), 3);
  const summary = {
    responses: assertIntegerString(row[0], 'scope responses'),
    v2Present: assertIntegerString(row[1], 'scope v2 count'),
    v3Present: assertIntegerString(row[2], 'scope v3 count')
  };

  if (summary.responses !== CONFIG.expectedScopeResponseCount) {
    throw new Error(
      `Scope response count changed: ${summary.responses}; expected ${CONFIG.expectedScopeResponseCount}`
    );
  }
  if (summary.v2Present !== 0 || summary.v3Present !== 0) {
    throw new Error(
      `Affected scope is no longer empty: v2=${summary.v2Present}, v3=${summary.v3Present}`
    );
  }
  return summary;
}

function extractBackupResponses(affectedPersonIds) {
  const personIds = affectedPersonIds.join(',');
  const script = String.raw`set -eu
{
  docker exec -e PGOPTIONS="-c default_transaction_read_only=on" ${CONFIG.databaseContainer} \
    psql -X -qAt -v ON_ERROR_STOP=1 -U ${CONFIG.databaseUser} -d ${CONFIG.database} \
    -c "SELECT u.id FROM unit u JOIN booklet b ON b.id=u.bookletid WHERE b.personid = ANY (ARRAY[${personIds}]::integer[])" \
    | sed $'s/^/U\t/'
  (
    # pg_restore stops reading the custom archive after the selected table.
    # The upstream cat can therefore end with SIGPIPE (141), which is expected.
    set +o pipefail
    docker exec ${CONFIG.cadvisorContainer} cat ${CONFIG.backupPath} \
      | docker exec -i ${CONFIG.databaseContainer} pg_restore --data-only --table=response --file=- \
      | sed $'s/^/R\t/'
  )
} | awk -F '\t' '
  $1 == "U" { units[$2] = 1; next }
  $1 == "R" && ($2 in units) && ($11 != "\\N" || $12 != "\\N" || $13 != "\\N") {
    print substr($0, 3)
  }
'
`;
  const rows = parseCopyRows(runRemote('bash -s', script), COPY_COLUMNS.length);
  return rows.map(responseFromCopyRow);
}

function getCurrentResponses(backupResponses) {
  const ids = backupResponses.map((response) => response.id);
  const sql = `COPY (
    SELECT
      r.unitid,
      r.variableid,
      r.status,
      r.value,
      r.subform,
      r.code_v1,
      r.score_v1,
      r.id,
      r.status_v1,
      r.status_v2,
      r.code_v2,
      r.score_v2,
      r.status_v3,
      r.code_v3,
      r.score_v3,
      r.is_autocoder_generated,
      b.personid
    FROM response r
    JOIN unit u ON u.id = r.unitid
    JOIN booklet b ON b.id = u.bookletid
    WHERE r.id = ANY (ARRAY[${ids.join(',')}]::integer[])
    ORDER BY r.id
  ) TO STDOUT WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');\n`;
  const rows = parseCopyRows(runReadOnlySql(sql), COPY_COLUMNS.length + 1);
  return rows.map((columns) => ({
    ...responseFromCopyRow(columns.slice(0, COPY_COLUMNS.length)),
    personid: assertIntegerString(
      columns[COPY_COLUMNS.length],
      'booklet.personid'
    )
  }));
}

function validateResponses(
  backupResponses,
  currentResponses,
  affectedPersonIds
) {
  if (backupResponses.length !== CONFIG.expectedRestoreCount) {
    throw new Error(
      `Backup restore count changed: ${backupResponses.length}; expected ${CONFIG.expectedRestoreCount}`
    );
  }

  const backupById = new Map();
  for (const response of backupResponses) {
    if (backupById.has(response.id))
      throw new Error(`Duplicate backup response ID: ${response.id}`);
    backupById.set(response.id, response);
  }

  const currentById = new Map();
  for (const response of currentResponses) {
    if (currentById.has(response.id))
      throw new Error(`Duplicate current response ID: ${response.id}`);
    currentById.set(response.id, response);
  }

  if (currentById.size !== backupById.size) {
    throw new Error(
      `Current response count ${currentById.size} does not match backup ${backupById.size}`
    );
  }

  const affectedPersonSet = new Set(affectedPersonIds);
  const mismatches = [];
  const plan = [];
  const encodedInvariantColumns = [
    'unitid',
    'variableid',
    'status',
    'value',
    'subform',
    'code_v1',
    'score_v1',
    'id',
    'status_v1',
    'is_autocoder_generated'
  ];

  for (const backup of backupResponses) {
    const current = currentById.get(backup.id);
    if (!current) {
      mismatches.push({
        responseId: backup.id,
        reason: 'missing-current-response'
      });
      continue;
    }

    for (const column of encodedInvariantColumns) {
      if (backup.encoded[column] !== current.encoded[column]) {
        mismatches.push({ responseId: backup.id, reason: `changed-${column}` });
      }
    }
    if (!affectedPersonSet.has(current.personid)) {
      mismatches.push({
        responseId: backup.id,
        reason: 'outside-original-person-scope'
      });
    }
    if (
      current.statusV2 !== null ||
      current.codeV2 !== null ||
      current.scoreV2 !== null
    ) {
      mismatches.push({
        responseId: backup.id,
        reason: 'current-v2-not-empty'
      });
    }
    if (
      current.statusV3 !== null ||
      current.codeV3 !== null ||
      current.scoreV3 !== null
    ) {
      mismatches.push({
        responseId: backup.id,
        reason: 'current-v3-not-empty'
      });
    }

    plan.push({ backup, current });
  }

  if (mismatches.length > 0) {
    const sample = JSON.stringify(mismatches.slice(0, 20), null, 2);
    throw new Error(
      `${mismatches.length} recovery validation mismatch(es):\n${sample}`
    );
  }

  return plan.sort((left, right) => left.backup.id - right.backup.id);
}

function buildPlanCsv(plan) {
  const header = [
    'response_id',
    'person_id',
    'unit_id',
    'variable_id',
    'backup_status_v2',
    'backup_code_v2',
    'backup_score_v2',
    'current_status_v2',
    'current_code_v2',
    'current_score_v2',
    'validation'
  ];
  const rows = plan.map(({ backup, current }) =>
    csvRow([
      backup.id,
      current.personid,
      backup.unitid,
      backup.variableid,
      backup.statusV2,
      backup.codeV2,
      backup.scoreV2,
      current.statusV2,
      current.codeV2,
      current.scoreV2,
      'ready'
    ])
  );
  return [csvRow(header), ...rows].join('\n') + '\n';
}

function buildRecoveryData(plan) {
  return plan
    .map(({ backup, current }) =>
      csvRow(
        [
          backup.id,
          current.personid,
          backup.unitid,
          backup.variableid,
          backup.status,
          backup.codeV1,
          backup.scoreV1,
          backup.statusV1,
          backup.isAutocoderGenerated,
          backup.statusV2,
          backup.codeV2,
          backup.scoreV2
        ],
        '\\N'
      )
    )
    .join('\n');
}

function buildApplySql(plan) {
  const data = buildRecoveryData(plan);
  return `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';
SET LOCAL application_name = 'workspace-2-v2-recovery-2026-08-21';

CREATE TEMP TABLE recovery_v2_plan (
  response_id integer PRIMARY KEY,
  person_id integer NOT NULL,
  unit_id integer NOT NULL,
  variable_id varchar(255) NOT NULL,
  expected_status smallint NOT NULL,
  expected_code_v1 bigint,
  expected_score_v1 bigint,
  expected_status_v1 smallint,
  expected_generated boolean NOT NULL,
  restore_status_v2 smallint,
  restore_code_v2 integer,
  restore_score_v2 integer
) ON COMMIT DROP;

COPY recovery_v2_plan FROM STDIN WITH (FORMAT csv, NULL '\\N');
${data}
\\.

DO $recovery$
DECLARE
  planned_count integer;
  mismatch_count integer;
  changed_count integer;
BEGIN
  SELECT count(*) INTO planned_count FROM recovery_v2_plan;
  IF planned_count <> ${CONFIG.expectedRestoreCount} THEN
    RAISE EXCEPTION 'Unexpected recovery plan size: %', planned_count;
  END IF;

  PERFORM r.id
  FROM response r
  JOIN recovery_v2_plan p ON p.response_id = r.id
  ORDER BY r.id
  FOR UPDATE OF r;

  SELECT count(*) INTO mismatch_count
  FROM recovery_v2_plan p
  LEFT JOIN response r ON r.id = p.response_id
  LEFT JOIN unit u ON u.id = r.unitid
  LEFT JOIN booklet b ON b.id = u.bookletid
  WHERE r.id IS NULL
     OR r.unitid IS DISTINCT FROM p.unit_id
     OR r.variableid IS DISTINCT FROM p.variable_id
     OR r.status IS DISTINCT FROM p.expected_status
     OR r.code_v1 IS DISTINCT FROM p.expected_code_v1
     OR r.score_v1 IS DISTINCT FROM p.expected_score_v1
     OR r.status_v1 IS DISTINCT FROM p.expected_status_v1
     OR r.is_autocoder_generated IS DISTINCT FROM p.expected_generated
     OR b.personid IS DISTINCT FROM p.person_id
     OR r.status_v2 IS NOT NULL
     OR r.code_v2 IS NOT NULL
     OR r.score_v2 IS NOT NULL
     OR r.status_v3 IS NOT NULL
     OR r.code_v3 IS NOT NULL
     OR r.score_v3 IS NOT NULL;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Recovery precondition mismatch for % response(s)', mismatch_count;
  END IF;

  UPDATE response r
  SET status_v2 = p.restore_status_v2,
      code_v2 = p.restore_code_v2,
      score_v2 = p.restore_score_v2
  FROM recovery_v2_plan p
  WHERE r.id = p.response_id;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> ${CONFIG.expectedRestoreCount} THEN
    RAISE EXCEPTION 'Unexpected updated row count: %', changed_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM recovery_v2_plan p
  JOIN response r ON r.id = p.response_id
  WHERE r.status_v2 IS DISTINCT FROM p.restore_status_v2
     OR r.code_v2 IS DISTINCT FROM p.restore_code_v2
     OR r.score_v2 IS DISTINCT FROM p.restore_score_v2
     OR r.status_v3 IS NOT NULL
     OR r.code_v3 IS NOT NULL
     OR r.score_v3 IS NOT NULL;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Post-update verification failed for % response(s)', mismatch_count;
  END IF;
END
$recovery$;

COMMIT;
`;
}

function buildRollbackSql(plan) {
  const data = buildRecoveryData(plan);
  return `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';
SET LOCAL application_name = 'workspace-2-v2-recovery-rollback-2026-08-21';

CREATE TEMP TABLE recovery_v2_plan (
  response_id integer PRIMARY KEY,
  person_id integer NOT NULL,
  unit_id integer NOT NULL,
  variable_id varchar(255) NOT NULL,
  expected_status smallint NOT NULL,
  expected_code_v1 bigint,
  expected_score_v1 bigint,
  expected_status_v1 smallint,
  expected_generated boolean NOT NULL,
  restore_status_v2 smallint,
  restore_code_v2 integer,
  restore_score_v2 integer
) ON COMMIT DROP;

COPY recovery_v2_plan FROM STDIN WITH (FORMAT csv, NULL '\\N');
${data}
\\.

DO $rollback$
DECLARE
  mismatch_count integer;
  changed_count integer;
BEGIN
  PERFORM r.id
  FROM response r
  JOIN recovery_v2_plan p ON p.response_id = r.id
  ORDER BY r.id
  FOR UPDATE OF r;

  SELECT count(*) INTO mismatch_count
  FROM recovery_v2_plan p
  LEFT JOIN response r ON r.id = p.response_id
  WHERE r.id IS NULL
     OR r.status_v2 IS DISTINCT FROM p.restore_status_v2
     OR r.code_v2 IS DISTINCT FROM p.restore_code_v2
     OR r.score_v2 IS DISTINCT FROM p.restore_score_v2
     OR r.status_v3 IS NOT NULL
     OR r.code_v3 IS NOT NULL
     OR r.score_v3 IS NOT NULL;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Rollback precondition mismatch for % response(s)', mismatch_count;
  END IF;

  UPDATE response r
  SET status_v2 = NULL,
      code_v2 = NULL,
      score_v2 = NULL
  FROM recovery_v2_plan p
  WHERE r.id = p.response_id;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> ${CONFIG.expectedRestoreCount} THEN
    RAISE EXCEPTION 'Unexpected rollback row count: %', changed_count;
  END IF;
END
$rollback$;

COMMIT;
`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    printHelp();
    return;
  }
  if (arguments_.apply && arguments_.confirm !== CONFIG.confirmationToken) {
    throw new Error(
      `Production apply requires --confirm ${CONFIG.confirmationToken}`
    );
  }
  if (!arguments_.apply && arguments_.confirm) {
    throw new Error('--confirm is only valid together with --apply');
  }

  await mkdir(arguments_.outputDir, { recursive: true, mode: 0o700 });

  console.log('1/6 Reading the failed queue job (read-only) ...');
  const { job, affectedPersonIds } = getJobData();

  console.log('2/6 Verifying the server backup (read-only) ...');
  const backup = getBackupMetadata();

  console.log('3/6 Rechecking the affected live scope (read-only) ...');
  const liveScope = getScopeSummary(affectedPersonIds);

  console.log(
    '4/6 Extracting V2 tuples from the backup (read-only; may take about two minutes) ...'
  );
  const backupResponses = extractBackupResponses(affectedPersonIds);

  console.log('5/6 Comparing backup rows with current rows (read-only) ...');
  const currentResponses = getCurrentResponses(backupResponses);
  const plan = validateResponses(
    backupResponses,
    currentResponses,
    affectedPersonIds
  );

  const planCsv = buildPlanCsv(plan);
  const applySql = buildApplySql(plan);
  const rollbackSql = buildRollbackSql(plan);
  const planSha256 = createHash('sha256').update(planCsv).digest('hex');
  const distinctPersonsWithRestores = new Set(
    plan.map((entry) => entry.current.personid)
  ).size;
  const statusCounts = Object.fromEntries(
    [...Map.groupBy(plan, (entry) => String(entry.backup.statusV2)).entries()]
      .map(([status, entries]) => [status, entries.length])
      .sort(([left], [right]) => Number(left) - Number(right))
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: arguments_.apply ? 'apply' : 'dry-run',
    productionWritesPerformed: false,
    server: `${CONFIG.host}:${CONFIG.port}`,
    workspaceId: CONFIG.workspaceId,
    sourceJob: {
      queueKey: CONFIG.queueKey,
      workspaceId: job.workspaceId,
      autoCoderRun: job.autoCoderRun ?? null,
      totalPersons: job.personIds.length,
      affectedPersons: affectedPersonIds.length,
      affectedPersonIdsSha256: createHash('sha256')
        .update(affectedPersonIds.join(','))
        .digest('hex')
    },
    backup,
    liveScope,
    recovery: {
      rowsReady: plan.length,
      distinctPersonsWithRestores,
      statusV2Counts: statusCounts,
      planSha256,
      v2ExportCrossCheck: {
        performed: false,
        reason:
          'The results-by-version V2 export downloaded at 08:55 was not found locally.'
      }
    }
  };

  await writePrivateFile(
    resolve(arguments_.outputDir, 'restore-plan.csv'),
    planCsv
  );
  await writePrivateFile(resolve(arguments_.outputDir, 'apply.sql'), applySql);
  await writePrivateFile(
    resolve(arguments_.outputDir, 'rollback.sql'),
    rollbackSql
  );
  await writePrivateFile(
    resolve(arguments_.outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  await writePrivateFile(
    resolve(arguments_.outputDir, 'README.txt'),
    `Workspace 2 V2 recovery preparation\n\n` +
      `Dry-run validated ${plan.length} response rows.\n` +
      `No production writes were performed.\n` +
      `Plan SHA-256: ${planSha256}\n\n` +
      `Before production apply:\n` +
      `1. Obtain explicit approval.\n` +
      `2. Re-run this script with --apply and the exact confirmation token.\n` +
      `3. Keep rollback.sql until final production verification is complete.\n` +
      `4. Cross-check the 08:55 V2 export if it becomes available.\n`
  );

  console.log(`6/6 Recovery artifacts written to ${arguments_.outputDir}`);
  console.log(`Validated rows: ${plan.length}`);
  console.log(`Plan SHA-256: ${planSha256}`);

  if (!arguments_.apply) {
    console.log('Dry-run complete. No production writes were performed.');
    return;
  }

  console.log(
    'Explicit confirmation token accepted. Applying the guarded transaction ...'
  );
  runRemote(
    `docker exec -i ${CONFIG.databaseContainer} psql -X -q -v ON_ERROR_STOP=1 ` +
      `-U ${CONFIG.databaseUser} -d ${CONFIG.database}`,
    applySql
  );
  summary.productionWritesPerformed = true;
  summary.appliedAt = new Date().toISOString();
  await writePrivateFile(
    resolve(arguments_.outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  console.log(`Production apply completed for ${plan.length} response rows.`);
}

export {
  parseArguments, assertIntegerString, assertSignedIntegerString,
  parseCopyRows, decodeCopyText, responseFromCopyRow, csvCell,
  buildApplySql, buildRollbackSql
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
