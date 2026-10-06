#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';

const CONFIG = {
  sshUser: 'julian',
  sshPort: '24242',
  sourceHost: 'iqb-kodierbox.de',
  targetHost: '172.28.36.171',
  sourceWorkspaceId: Number(process.env.SOURCE_WORKSPACE_ID || '1'),
  targetUserName: 'schumaki',
  databaseContainer: 'coding-box-db-1',
  backupPath: '/home/julian/kodierbox-backups/2026-08-27-before-workspace-1-import/coding-box_dump',
  backupSha256: process.env.BACKUP_SHA256 || 'a05d8c6595c27e6bd02c8ade33d42cb04b9216dcf566be1846406ab16888b1d5',
  externalBackupManifest: process.env.EXTERNAL_BACKUP_MANIFEST || '',
  minimumFreeGiB: Number(process.env.MINIMUM_FREE_GIB || '20')
};

const PLANS = [
  ['workspace', 'SELECT w.* FROM workspace w WHERE w.id = $WS'],
  ['persons', 'SELECT * FROM persons WHERE workspace_id = $WS'],
  ['bookletinfo', `SELECT DISTINCT bi.* FROM bookletinfo bi
    INNER JOIN booklet b ON bi.id = b.infoid
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['booklet', `SELECT b.* FROM booklet b
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['bookletlog', `SELECT bl.* FROM bookletlog bl
    INNER JOIN booklet b ON bl.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['session', `SELECT s.* FROM session s
    INNER JOIN booklet b ON s.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['unit', `SELECT u.* FROM unit u
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['unit_note', `SELECT un.* FROM unit_note un
    INNER JOIN unit u ON un."unitId" = u.id
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['unit_tag', `SELECT ut.* FROM unit_tag ut
    INNER JOIN unit u ON ut."unitId" = u.id
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['unitlaststate', `SELECT uls.* FROM unitlaststate uls
    INNER JOIN unit u ON uls.unitid = u.id
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['unitlog', `SELECT ul.* FROM unitlog ul
    INNER JOIN unit u ON ul.unitid = u.id
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['response', `SELECT r.* FROM response r
    INNER JOIN unit u ON r.unitid = u.id
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`],
  ['journal_entries', 'SELECT je.* FROM journal_entries je WHERE je.workspace_id = $WS'],
  ['replay_statistics', 'SELECT rs.* FROM replay_statistics rs WHERE rs.workspace_id = $WS'],
  ['workspace_test_results_revision', 'SELECT wtrr.* FROM workspace_test_results_revision wtrr WHERE wtrr.workspace_id = $WS'],
  ['missings_profile', 'SELECT mp.* FROM missings_profile mp WHERE mp.workspace_id = $WS'],
  ['variable_bundle', 'SELECT vb.* FROM variable_bundle vb WHERE vb.workspace_id = $WS'],
  ['coder_training', 'SELECT ct.* FROM coder_training ct WHERE ct.workspace_id = $WS'],
  ['coder_training_variable', `SELECT ctv.* FROM coder_training_variable ctv
    INNER JOIN coder_training ct ON ctv.coder_training_id = ct.id
    WHERE ct.workspace_id = $WS`],
  ['coder_training_bundle', `SELECT ctb.* FROM coder_training_bundle ctb
    INNER JOIN coder_training ct ON ctb.coder_training_id = ct.id
    WHERE ct.workspace_id = $WS`],
  ['coder_training_coder', `SELECT ctc.* FROM coder_training_coder ctc
    INNER JOIN coder_training ct ON ctc.coder_training_id = ct.id
    WHERE ct.workspace_id = $WS`],
  ['job_definitions', 'SELECT jd.* FROM job_definitions jd WHERE jd.workspace_id = $WS'],
  ['coding_job', 'SELECT cj.* FROM coding_job cj WHERE cj.workspace_id = $WS'],
  ['coding_job_coder', `SELECT cjc.* FROM coding_job_coder cjc
    INNER JOIN coding_job cj ON cjc.coding_job_id = cj.id
    WHERE cj.workspace_id = $WS`],
  ['coding_job_variable', `SELECT cjv.* FROM coding_job_variable cjv
    INNER JOIN coding_job cj ON cjv.coding_job_id = cj.id
    WHERE cj.workspace_id = $WS`],
  ['coding_job_variable_bundle', `SELECT cjvb.* FROM coding_job_variable_bundle cjvb
    INNER JOIN coding_job cj ON cjvb.coding_job_id = cj.id
    WHERE cj.workspace_id = $WS`],
  ['coding_job_unit', `SELECT cju.* FROM coding_job_unit cju
    LEFT JOIN coding_job cj ON cju.coding_job_id = cj.id
    WHERE COALESCE(cju.workspace_id, cj.workspace_id) = $WS`],
  ['coding_unit_freshness', 'SELECT cuf.* FROM coding_unit_freshness cuf WHERE cuf.workspace_id = $WS'],
  ['coder_training_discussion_result', 'SELECT ctdr.* FROM coder_training_discussion_result ctdr WHERE ctdr.workspace_id = $WS'],
  ['double_coding_review_decision', 'SELECT dc.* FROM double_coding_review_decision dc WHERE dc.workspace_id = $WS'],
  ['file_upload', 'SELECT fu.* FROM file_upload fu WHERE fu.workspace_id = $WS'],
  ['resource_package', 'SELECT rp.* FROM resource_package rp WHERE rp."workspaceId" = $WS'],
  ['chunk', `SELECT c.* FROM chunk c
    INNER JOIN unit u ON c.unitid = u.id
    INNER JOIN booklet b ON u.bookletid = b.id
    INNER JOIN persons p ON b.personid = p.id
    WHERE p.workspace_id = $WS`]
].map(([name, query]) => ({ name, query }));

const SPECIAL_USER_COLUMNS = new Map([
  ['coder_training_coder.user_id', true],
  ['coder_training_discussion_result.manager_user_id', true],
  ['coding_job.reviewer_user_id', true],
  ['coding_job_coder.user_id', true],
  ['double_coding_review_decision.manager_user_id', true],
  ['journal_entries.actor_user_id', true]
]);

const SPECIAL_REFS = new Map([
  ['coding_job_unit.variable_bundle_id', 'variable_bundle']
]);

const LOCAL_TRANSFORM_TABLES = new Set(['coder_training', 'job_definitions']);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sourceQuery(plan, workspaceId = CONFIG.sourceWorkspaceId) {
  return plan.query.replaceAll('$WS', String(workspaceId));
}

function targetQuery(plan, workspaceId) {
  return plan.query.replaceAll('$WS', String(workspaceId));
}

function startSsh(host, remoteCommand, options = {}) {
  return spawn('ssh', [
    '-C',
    '-p', CONFIG.sshPort,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=6',
    `${CONFIG.sshUser}@${host}`,
    remoteCommand
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options
  });
}

function psqlRemoteCommand({ readOnly = false, tuplesOnly = true } = {}) {
  const pgOptions = readOnly ? 'PGOPTIONS="-c default_transaction_read_only=on" ' : '';
  const outputOptions = tuplesOnly ? '-Atq' : '-q';
  return `docker exec -i ${CONFIG.databaseContainer} sh -c '${pgOptions}exec psql -X ${outputOptions} -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`;
}

async function collectProcess(process, input, label, maxBytes = 64 * 1024 * 1024) {
  let stdout = '';
  let stderr = '';
  process.stdout.setEncoding('utf8');
  process.stderr.setEncoding('utf8');
  process.stdout.on('data', chunk => {
    stdout += chunk;
    if (stdout.length > maxBytes) process.kill('SIGKILL');
  });
  process.stderr.on('data', chunk => { stderr += chunk; });
  process.stdin.end(input);
  const [code] = await once(process, 'close');
  if (code !== 0) {
    throw new Error(`${label} failed (${code}): ${stderr.trim() || stdout.trim()}`);
  }
  return { stdout, stderr };
}

async function psql(host, sql, options = {}) {
  const process = startSsh(host, psqlRemoteCommand(options));
  return collectProcess(process, `${sql.trim()}\n`, `${host} psql`);
}

async function ssh(host, command) {
  const process = startSsh(host, command);
  return collectProcess(process, '', `${host} ssh`, 4 * 1024 * 1024);
}

function jsonLines(output) {
  return output.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function metadata(host) {
  const names = PLANS.map(plan => quoteLiteral(plan.name)).join(',');
  const { stdout } = await psql(host, `
    SELECT row_to_json(x)::text
    FROM (
      SELECT table_name, column_name, data_type, udt_name, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${names})
      ORDER BY table_name, ordinal_position
    ) x;
  `, { readOnly: true });
  const result = new Map();
  for (const row of jsonLines(stdout)) {
    if (!result.has(row.table_name)) result.set(row.table_name, []);
    result.get(row.table_name).push(row);
  }
  return result;
}

async function foreignKeys() {
  const { stdout } = await psql(CONFIG.targetHost, `
    SELECT row_to_json(x)::text
    FROM (
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table,
             ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ) x;
  `, { readOnly: true });
  return new Map(jsonLines(stdout).map(row => [`${row.table_name}.${row.column_name}`, row.referenced_table]));
}

async function targetOffsets(columnsByTable) {
  const tables = PLANS
    .filter(plan => columnsByTable.get(plan.name)?.some(column => column.column_name === 'id'))
    .map(plan => plan.name);
  const sql = tables.map(table =>
    `SELECT ${quoteLiteral(table)} AS table_name, COALESCE(MAX(id), 0)::text AS max_id FROM ${quoteIdentifier(table)}`
  ).concat([
    `SELECT 'user' AS table_name, COALESCE(MAX(id), 0)::text AS max_id FROM "user"`
  ]).join('\nUNION ALL\n');
  const { stdout } = await psql(CONFIG.targetHost,
    `SELECT row_to_json(x)::text FROM (${sql}) x;`, { readOnly: true });
  return new Map(jsonLines(stdout).map(row => [row.table_name, BigInt(row.max_id)]));
}

async function startSnapshot() {
  const process = startSsh(CONFIG.sourceHost, psqlRemoteCommand({ readOnly: true }));
  let stderr = '';
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', chunk => { stderr += chunk; });
  const lines = readline.createInterface({ input: process.stdout, crlfDelay: Infinity });
  process.stdin.write("SET idle_in_transaction_session_timeout='0';\nSET statement_timeout='0';\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT 'SNAPSHOT|' || pg_export_snapshot();\n");
  const timeout = setTimeout(() => process.kill('SIGKILL'), 30_000);
  const [line] = await once(lines, 'line');
  clearTimeout(timeout);
  if (!line?.startsWith('SNAPSHOT|')) {
    process.kill('SIGKILL');
    throw new Error(`Could not export source snapshot: ${line || stderr}`);
  }
  const snapshot = line.slice('SNAPSHOT|'.length);
  if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(snapshot)) {
    process.kill('SIGKILL');
    throw new Error(`Unsafe snapshot id: ${snapshot}`);
  }
  const keepAlive = setInterval(() => {
    if (!process.stdin.destroyed && process.exitCode === null) process.stdin.write('SELECT 1;\n');
  }, 30_000);
  return {
    id: snapshot,
    async close() {
      clearInterval(keepAlive);
      if (process.exitCode !== null) {
        if (process.exitCode !== 0) throw new Error(`Snapshot coordinator failed (${process.exitCode}): ${stderr}`);
        return;
      }
      process.stdin.end('ROLLBACK;\n');
      const [code] = await once(process, 'close');
      if (code !== 0) throw new Error(`Snapshot coordinator failed (${code}): ${stderr}`);
    }
  };
}

async function snapshotQuery(snapshot, sql, maxBytes) {
  return psql(CONFIG.sourceHost, `
    BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SET TRANSACTION SNAPSHOT ${quoteLiteral(snapshot)};
    ${sql.trim()}
    COMMIT;
  `, { readOnly: true, maxBytes });
}

async function sourceCounts(snapshot) {
  const unions = PLANS.map(plan =>
    `SELECT ${quoteLiteral(plan.name)} AS table_name, COUNT(*)::text AS row_count FROM (${sourceQuery(plan)}) export_rows`
  ).join('\nUNION ALL\n');
  const { stdout } = await snapshotQuery(snapshot,
    `SELECT row_to_json(x)::text FROM (${unions}) x;`);
  return new Map(jsonLines(stdout).map(row => [row.table_name, BigInt(row.row_count)]));
}

async function sourceCriticalStats(snapshot) {
  const { stdout } = await snapshotQuery(snapshot, `
    SELECT row_to_json(x)::text FROM (
      SELECT
        COUNT(*)::text AS response_count,
        COUNT(score_v1)::text AS score_v1_count,
        COALESCE(SUM(score_v1), 0)::text AS score_v1_sum,
        COUNT(score_v2)::text AS score_v2_count,
        COALESCE(SUM(score_v2), 0)::text AS score_v2_sum,
        COUNT(score_v3)::text AS score_v3_count,
        COALESCE(SUM(score_v3), 0)::text AS score_v3_sum,
        COUNT(code_v3)::text AS code_v3_count,
        COUNT(status_v3)::text AS status_v3_count,
        COUNT(*) FILTER (WHERE is_autocoder_generated IS TRUE)::text AS generated_count
      FROM (${sourceQuery(PLANS.find(plan => plan.name === 'response'))}) responses
    ) x;
  `);
  return jsonLines(stdout)[0];
}

async function snapshotRows(snapshot, query) {
  const { stdout } = await snapshotQuery(snapshot,
    `SELECT row_to_json(export_rows)::text FROM (${query}) export_rows;`, 64 * 1024 * 1024);
  return jsonLines(stdout);
}

async function loadUserMapping(snapshot, offsets) {
  const sourceUsers = await snapshotRows(snapshot, `
    SELECT DISTINCT u.* FROM "user" u
    WHERE u.id IN (
      SELECT user_id FROM workspace_user WHERE workspace_id = ${CONFIG.sourceWorkspaceId}
      UNION SELECT ctc.user_id FROM coder_training_coder ctc JOIN coder_training ct ON ct.id=ctc.coder_training_id WHERE ct.workspace_id=${CONFIG.sourceWorkspaceId}
      UNION SELECT cjc.user_id FROM coding_job_coder cjc JOIN coding_job cj ON cj.id=cjc.coding_job_id WHERE cj.workspace_id=${CONFIG.sourceWorkspaceId}
      UNION SELECT manager_user_id FROM coder_training_discussion_result WHERE workspace_id=${CONFIG.sourceWorkspaceId} AND manager_user_id IS NOT NULL
      UNION SELECT reviewer_user_id FROM coding_job WHERE workspace_id=${CONFIG.sourceWorkspaceId} AND reviewer_user_id IS NOT NULL
      UNION SELECT actor_user_id FROM journal_entries WHERE workspace_id=${CONFIG.sourceWorkspaceId} AND actor_user_id IS NOT NULL
      UNION SELECT manager_user_id FROM double_coding_review_decision WHERE workspace_id=${CONFIG.sourceWorkspaceId} AND manager_user_id IS NOT NULL
    ) ORDER BY u.id
  `);
  const { stdout } = await psql(CONFIG.targetHost,
    'SELECT row_to_json(u)::text FROM "user" u ORDER BY u.id;', { readOnly: true });
  const targetUsers = jsonLines(stdout);
  const targetByIdentity = new Map();
  for (const user of targetUsers) {
    const key = `${user.issuer}\u0000${user.identity}`;
    if (targetByIdentity.has(key)) throw new Error(`Duplicate target identity for ${user.username}`);
    targetByIdentity.set(key, user);
  }
  const map = new Map();
  const missing = [];
  for (const user of sourceUsers) {
    const target = targetByIdentity.get(`${user.issuer}\u0000${user.identity}`);
    const targetId = target ? BigInt(target.id) : BigInt(user.id) + offsets.get('user');
    map.set(Number(user.id), targetId);
    if (!target) missing.push({ ...user, id: targetId.toString(), isAdmin: false });
  }
  const sourceSchumaki = sourceUsers.find(user => user.username.toLowerCase() === CONFIG.targetUserName);
  if (!sourceSchumaki) throw new Error('schumaki is not a member of the source workspace');
  const targetSchumakiId = map.get(Number(sourceSchumaki.id));
  if (!targetSchumakiId || missing.some(user => BigInt(user.id) === targetSchumakiId)) {
    throw new Error('schumaki must already exist on the target with the same identity');
  }
  return { map, missing, targetSchumakiId };
}

async function loadBookletInfoMapping(snapshot, offsets) {
  const plan = PLANS.find(item => item.name === 'bookletinfo');
  const sourceRows = await snapshotRows(snapshot, `${sourceQuery(plan)} ORDER BY bi.id`);
  const { stdout } = await psql(CONFIG.targetHost,
    'SELECT row_to_json(bi)::text FROM bookletinfo bi ORDER BY bi.id;', { readOnly: true });
  const targetRows = jsonLines(stdout);
  const targetByKey = new Map(targetRows.map(row => [`${row.name}\u0000${row.size}`, row]));
  const map = new Map();
  const missing = [];
  for (const row of sourceRows) {
    const target = targetByKey.get(`${row.name}\u0000${row.size}`);
    const targetId = target ? BigInt(target.id) : BigInt(row.id) + offsets.get('bookletinfo');
    map.set(Number(row.id), targetId);
    if (!target) missing.push({ ...row, id: targetId.toString() });
  }
  return { map, missing };
}

function caseMap(expression, mapping, label) {
  const entries = [...mapping.entries()];
  if (entries.length === 0) return expression;
  return `CASE ${expression} ${entries.map(([source, target]) =>
    `WHEN ${source} THEN ${target}`
  ).join(' ')} ELSE NULL END /* ${label} */`;
}

function transformExpression(plan, column, context) {
  const q = quoteIdentifier(column.column_name);
  const key = `${plan.name}.${column.column_name}`;
  if (plan.name === 'workspace' && column.column_name === 'id') {
    return `${context.newWorkspaceId} AS ${q}`;
  }
  if (column.column_name === 'workspace_id' || column.column_name === 'workspaceId') {
    return `${context.newWorkspaceId} AS ${q}`;
  }
  if (SPECIAL_USER_COLUMNS.has(key)) {
    return `${caseMap(q, context.users.map, 'user map')} AS ${q}`;
  }
  if (plan.name === 'booklet' && column.column_name === 'infoid') {
    return `${caseMap(q, context.bookletInfo.map, 'bookletinfo map')} AS ${q}`;
  }
  const referenced = context.foreignKeys.get(key) || SPECIAL_REFS.get(key);
  if (referenced === 'user') {
    return `${caseMap(q, context.users.map, 'user map')} AS ${q}`;
  }
  if (referenced === 'workspace') return `${context.newWorkspaceId} AS ${q}`;
  if (referenced && context.offsets.has(referenced)) {
    return `CASE WHEN ${q} IS NULL THEN NULL ELSE ${q} + ${context.offsets.get(referenced)} END AS ${q}`;
  }
  if (column.column_name === 'id' && context.offsets.has(plan.name)) {
    return `${q} + ${context.offsets.get(plan.name)} AS ${q}`;
  }
  return q;
}

function transformLocalRow(plan, sourceRow, context) {
  const row = structuredClone(sourceRow);
  for (const column of context.columns.get(plan.name)) {
    const name = column.column_name;
    if (row[name] === null || row[name] === undefined) continue;
    const key = `${plan.name}.${name}`;
    if (name === 'workspace_id' || name === 'workspaceId') row[name] = Number(context.newWorkspaceId);
    else if (SPECIAL_USER_COLUMNS.has(key)) row[name] = Number(context.users.map.get(Number(row[name])));
    else if (name === 'id' && context.offsets.has(plan.name)) row[name] = Number(BigInt(row[name]) + context.offsets.get(plan.name));
    else {
      const referenced = context.foreignKeys.get(key) || SPECIAL_REFS.get(key);
      if (referenced === 'user') row[name] = Number(context.users.map.get(Number(row[name])));
      else if (referenced === 'workspace') row[name] = Number(context.newWorkspaceId);
      else if (referenced && context.offsets.has(referenced)) row[name] = Number(BigInt(row[name]) + context.offsets.get(referenced));
    }
  }
  if (plan.name === 'coder_training' && Array.isArray(row.reference_training_ids)) {
    row.reference_training_ids = row.reference_training_ids.map(id => Number(BigInt(id) + context.offsets.get('coder_training')));
  }
  if (plan.name === 'job_definitions') {
    row.assigned_coders = (row.assigned_coders || []).map(id => Number(context.users.map.get(Number(id))));
    row.assigned_variable_bundles = transformBundleObjects(row.assigned_variable_bundles, context);
    row.assigned_coder_configs = (row.assigned_coder_configs || []).map(item => ({
      ...item,
      coderId: Number(context.users.map.get(Number(item.coderId)))
    }));
    row.distribution_snapshots = transformSnapshotJson(row.distribution_snapshots, context);
  }
  return row;
}

function transformBundleObjects(value, context) {
  if (!Array.isArray(value)) return value;
  return value.map(item => ({
    ...item,
    ...(item?.id === undefined ? {} : { id: Number(BigInt(item.id) + context.offsets.get('variable_bundle')) })
  }));
}

function transformSnapshotJson(value, context, key = '', parentKey = '') {
  if (Array.isArray(value)) return value.map(item => transformSnapshotJson(item, context, '', key));
  if (value && typeof value === 'object') {
    const userKeyedObjects = new Set(['coderWeights', 'tasksPerCoder', 'doubleCodedCasesPerCoderId']);
    const itemKeyedObjects = new Set(['distributionByCoderId', 'doubleCodingInfo', 'aggregationInfo']);
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      let mappedChildKey = childKey;
      if (itemKeyedObjects.has(key)) {
        const bundleMatch = childKey.match(/^bundle:(\d+)$/);
        if (bundleMatch) mappedChildKey = `bundle:${BigInt(bundleMatch[1]) + context.offsets.get('variable_bundle')}`;
      }
      if (key === 'pairDistribution') {
        const pairMatch = childKey.match(/^(\d+)-(\d+)$/);
        if (pairMatch) {
          const first = context.users.map.get(Number(pairMatch[1]));
          const second = context.users.map.get(Number(pairMatch[2]));
          if (!first || !second) throw new Error(`Unknown user pair ${childKey}`);
          mappedChildKey = `${first}-${second}`;
        }
      }
      if (userKeyedObjects.has(key) || parentKey === 'distributionByCoderId') {
        const mappedKey = context.users.map.get(Number(childKey));
        if (!mappedKey) throw new Error(`Unknown user id ${childKey} in ${key}`);
        mappedChildKey = String(mappedKey);
        result[mappedChildKey] = transformSnapshotJson(childValue, context, mappedChildKey, key);
      } else {
        result[mappedChildKey] = transformSnapshotJson(childValue, context, mappedChildKey, key);
      }
    }
    return result;
  }
  if (typeof value === 'number') {
    if (key === 'coderId' || key === 'reviewerUserId') {
      const mapped = context.users.map.get(Number(value));
      if (!mapped) throw new Error(`Unknown user id ${value} in snapshot`);
      return Number(mapped);
    }
    if (key === 'jobId') return Number(BigInt(value) + context.offsets.get('coding_job'));
    if (key === 'workspaceId') return Number(context.newWorkspaceId);
    if (key === 'trainingId') return Number(BigInt(value) + context.offsets.get('coder_training'));
    if (key === 'variableBundleId' || key === 'bundleId' || (key === 'id' && /bundle/i.test(parentKey))) {
      return Number(BigInt(value) + context.offsets.get('variable_bundle'));
    }
  }
  if (typeof value === 'string') {
    const bundleMatch = value.match(/^bundle:(\d+)$/);
    if (key === 'itemKey' && bundleMatch) {
      return `bundle:${BigInt(bundleMatch[1]) + context.offsets.get('variable_bundle')}`;
    }
    if (key === 'distributionSeed') {
      return value.replace(`job-definition:${CONFIG.sourceWorkspaceId}:`, `job-definition:${context.newWorkspaceId}:`);
    }
  }
  return value;
}

function csvValue(value) {
  if (value === null || value === undefined) return '\\N';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(row, columns) {
  return `${columns.map(column => csvValue(row[column.column_name])).join(',')}\n`;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function copyLocalRows(target, table, columns, rows) {
  await writeChunk(target.stdin,
    `COPY ${quoteIdentifier(table)} (${columns.map(column => quoteIdentifier(column.column_name)).join(',')}) FROM STDIN WITH (FORMAT csv, NULL '\\N');\n`);
  for (const row of rows) await writeChunk(target.stdin, csvRow(row, columns));
  await writeChunk(target.stdin, '\\.\n');
}

async function copySourcePlan(target, snapshot, plan, context) {
  const columns = context.columns.get(plan.name);
  const expressions = columns.map(column => transformExpression(plan, column, context));
  const query = `SELECT ${expressions.join(', ')} FROM (${sourceQuery(plan)}) export_rows`;
  const source = startSsh(CONFIG.sourceHost, psqlRemoteCommand({ readOnly: true, tuplesOnly: false }));
  let sourceError = '';
  source.stderr.setEncoding('utf8');
  source.stderr.on('data', chunk => { sourceError += chunk; });
  source.stdin.end(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT ${quoteLiteral(snapshot)};\nCOPY (${query}) TO STDOUT WITH (FORMAT csv, NULL '\\N');\nCOMMIT;\n`);
  await writeChunk(target.stdin,
    `COPY ${quoteIdentifier(plan.name)} (${columns.map(column => quoteIdentifier(column.column_name)).join(',')}) FROM STDIN WITH (FORMAT csv, NULL '\\N');\n`);
  let lastByte = 10;
  for await (const chunk of source.stdout) {
    if (chunk.length) lastByte = chunk[chunk.length - 1];
    await writeChunk(target.stdin, chunk);
  }
  const [code] = await once(source, 'close');
  if (code !== 0) throw new Error(`Source copy ${plan.name} failed (${code}): ${sourceError}`);
  if (lastByte !== 10) await writeChunk(target.stdin, '\n');
  await writeChunk(target.stdin, '\\.\n');
}

function validationSql(context) {
  const checks = PLANS.map(plan => {
    const expected = context.counts.get(plan.name);
    return `IF (SELECT COUNT(*) FROM (${targetQuery(plan, context.newWorkspaceId)}) imported_rows) <> ${expected} THEN RAISE EXCEPTION 'Count mismatch: ${plan.name}'; END IF;`;
  }).join('\n');
  const stats = context.criticalStats;
  const responsePlan = PLANS.find(plan => plan.name === 'response');
  const responseQuery = targetQuery(responsePlan, context.newWorkspaceId);
  const statChecks = [
    ['COUNT(*)', stats.response_count, 'response_count'],
    ['COUNT(score_v1)', stats.score_v1_count, 'score_v1_count'],
    ['COALESCE(SUM(score_v1),0)', stats.score_v1_sum, 'score_v1_sum'],
    ['COUNT(score_v2)', stats.score_v2_count, 'score_v2_count'],
    ['COALESCE(SUM(score_v2),0)', stats.score_v2_sum, 'score_v2_sum'],
    ['COUNT(score_v3)', stats.score_v3_count, 'score_v3_count'],
    ['COALESCE(SUM(score_v3),0)', stats.score_v3_sum, 'score_v3_sum'],
    ['COUNT(code_v3)', stats.code_v3_count, 'code_v3_count'],
    ['COUNT(status_v3)', stats.status_v3_count, 'status_v3_count'],
    ['COUNT(*) FILTER (WHERE is_autocoder_generated IS TRUE)', stats.generated_count, 'generated_count']
  ].map(([expression, expected, name]) =>
    `IF (SELECT ${expression} FROM (${responseQuery}) imported_responses) <> ${expected} THEN RAISE EXCEPTION 'Stat mismatch: ${name}'; END IF;`
  ).join('\n');
  return `DO $validation$ BEGIN\n${checks}\n${statChecks}\nEND $validation$;`;
}

function sequenceSql(context) {
  const tables = ['user', ...PLANS.map(plan => plan.name)]
    .filter((table, index, all) => all.indexOf(table) === index)
    .filter(table => table === 'user' || context.columns.get(table)?.some(column => column.column_name === 'id'));
  return tables.map(table => {
    const relation = table === 'user' ? 'public."user"' : `public.${quoteIdentifier(table)}`;
    const sequenceCall = `pg_get_serial_sequence(${quoteLiteral(relation)}, 'id')`;
    return `SELECT setval(${sequenceCall}, COALESCE((SELECT MAX(id) FROM ${relation}), 1), EXISTS(SELECT 1 FROM ${relation})) WHERE ${sequenceCall} IS NOT NULL;`;
  }).join('\n');
}

async function assertOperationalPreconditions() {
  if (CONFIG.externalBackupManifest) {
    const manifest = readFileSync(CONFIG.externalBackupManifest, 'utf8');
    if (!manifest.includes(`SHA-256: ${CONFIG.backupSha256}`)) {
      throw new Error('Verified external backup manifest does not contain the expected SHA-256');
    }
  } else {
    const { stdout: backup } = await ssh(CONFIG.targetHost,
      `test -f ${CONFIG.backupPath} && sha256sum ${CONFIG.backupPath}`);
    if (!backup.includes(CONFIG.backupSha256)) throw new Error('Verified target backup is missing or changed');
  }
  const { stdout: disk } = await ssh(CONFIG.targetHost, 'df -Pk / | tail -1');
  const dfLine = disk.trim().split(/\s+/);
  const availableKb = Number(dfLine[3]);
  if (!Number.isFinite(availableKb) || availableKb < CONFIG.minimumFreeGiB * 1024 * 1024) {
    throw new Error(`Less than ${CONFIG.minimumFreeGiB} GiB free on target (${availableKb} KiB)`);
  }
}

async function buildContext(snapshot) {
  const sourceColumns = await metadata(CONFIG.sourceHost);
  const targetColumns = await metadata(CONFIG.targetHost);
  const fks = await foreignKeys();
  for (const plan of PLANS) {
    const source = sourceColumns.get(plan.name) || [];
    const target = targetColumns.get(plan.name) || [];
    const sourceShape = source.map(column => `${column.column_name}:${column.data_type}:${column.udt_name}`).join('|');
    const targetShape = target.map(column => `${column.column_name}:${column.data_type}:${column.udt_name}`).join('|');
    if (!sourceShape || sourceShape !== targetShape) throw new Error(`Schema mismatch for ${plan.name}`);
  }
  const offsets = await targetOffsets(targetColumns);
  const newWorkspaceId = offsets.get('workspace') + 1n;
  const counts = await sourceCounts(snapshot);
  const criticalStats = await sourceCriticalStats(snapshot);
  const users = await loadUserMapping(snapshot, offsets);
  const bookletInfo = await loadBookletInfoMapping(snapshot, offsets);
  const context = {
    columns: targetColumns,
    foreignKeys: fks,
    offsets,
    newWorkspaceId,
    counts,
    criticalStats,
    users,
    bookletInfo,
    localRows: new Map()
  };
  for (const plan of PLANS.filter(item => LOCAL_TRANSFORM_TABLES.has(item.name))) {
    const rows = await snapshotRows(snapshot, `${sourceQuery(plan)} ORDER BY id`);
    context.localRows.set(plan.name, rows.map(row => transformLocalRow(plan, row, context)));
  }
  return context;
}

async function preflight() {
  await assertOperationalPreconditions();
  const snapshot = await startSnapshot();
  try {
    const context = await buildContext(snapshot.id);
    const totalRows = [...context.counts.values()].reduce((sum, count) => sum + count, 0n);
    console.log(JSON.stringify({
      sourceWorkspaceId: CONFIG.sourceWorkspaceId,
      targetWorkspaceId: context.newWorkspaceId.toString(),
      totalRows: totalRows.toString(),
      responseRows: context.counts.get('response').toString(),
      scoreV3Rows: context.criticalStats.score_v3_count,
      missingUsersToInsert: context.users.missing.length,
      missingBookletInfosToInsert: context.bookletInfo.missing.length,
      freeSpaceGateGiB: CONFIG.minimumFreeGiB,
      mode: 'preflight-only'
    }, null, 2));
  } finally {
    await snapshot.close();
  }
}

async function apply() {
  await assertOperationalPreconditions();
  const { stdout: states } = await ssh(CONFIG.targetHost,
    `docker inspect -f '{{.Name}}|{{.State.Running}}' coding-box-backend-1 coding-box-backend-export-worker-1`);
  if (states.split('\n').filter(Boolean).some(line => line.endsWith('|true'))) {
    throw new Error('Target backend and export worker must be stopped before apply');
  }
  const snapshot = await startSnapshot();
  let target;
  try {
    const context = await buildContext(snapshot.id);
    const workspaceRows = await snapshotRows(snapshot.id,
      `SELECT * FROM workspace WHERE id=${CONFIG.sourceWorkspaceId}`);
    if (workspaceRows.length !== 1) throw new Error('Source workspace not found');
    const { stdout: sameName } = await psql(CONFIG.targetHost,
      `SELECT COUNT(*) FROM workspace WHERE name=${quoteLiteral(workspaceRows[0].name)};`, { readOnly: true });
    if (sameName.trim() !== '0') throw new Error(`Target workspace already exists: ${workspaceRows[0].name}`);

    target = startSsh(CONFIG.targetHost, psqlRemoteCommand({ readOnly: false, tuplesOnly: false }));
    let targetStdout = '';
    let targetStderr = '';
    target.stdout.setEncoding('utf8');
    target.stderr.setEncoding('utf8');
    target.stdout.on('data', chunk => { targetStdout += chunk; });
    target.stderr.on('data', chunk => { targetStderr += chunk; });
    await writeChunk(target.stdin, `BEGIN;\nSET LOCAL statement_timeout='0';\nSET LOCAL idle_in_transaction_session_timeout='0';\nSET LOCAL lock_timeout='15s';\nSELECT pg_advisory_xact_lock(872836171, ${CONFIG.sourceWorkspaceId});\n`);

    if (context.users.missing.length) {
      const userColumns = [
        { column_name: 'id' }, { column_name: 'identity' }, { column_name: 'issuer' },
        { column_name: 'isAdmin' }, { column_name: 'username' }
      ];
      await copyLocalRows(target, 'user', userColumns, context.users.missing);
    }

    for (const plan of PLANS) {
      if (plan.name === 'bookletinfo') {
        await copyLocalRows(target, plan.name, context.columns.get(plan.name), context.bookletInfo.missing);
        continue;
      }
      if (LOCAL_TRANSFORM_TABLES.has(plan.name)) {
        await copyLocalRows(target, plan.name, context.columns.get(plan.name), context.localRows.get(plan.name));
        continue;
      }
      console.log(`copy ${plan.name}: ${context.counts.get(plan.name)}`);
      await copySourcePlan(target, snapshot.id, plan, context);
      if (plan.name === 'workspace') {
        await writeChunk(target.stdin, `DO $workspace_check$ BEGIN
          IF (SELECT COUNT(*) FROM workspace WHERE id=${context.newWorkspaceId} AND name=${quoteLiteral(workspaceRows[0].name)}) <> 1 THEN
            RAISE EXCEPTION 'Imported workspace identity mismatch';
          END IF;
        END $workspace_check$;\n`);
      }
    }

    const workspaceUserColumns = [
      { column_name: 'workspace_id' }, { column_name: 'user_id' },
      { column_name: 'access_level' }, { column_name: 'can_code' }
    ];
    await copyLocalRows(target, 'workspace_user', workspaceUserColumns, [{
      workspace_id: context.newWorkspaceId.toString(),
      user_id: context.users.targetSchumakiId.toString(),
      access_level: 3,
      can_code: false
    }]);

    await writeChunk(target.stdin, `${validationSql(context)}\n${sequenceSql(context)}\nCOMMIT;\nSELECT 'IMPORT_COMMITTED|${context.newWorkspaceId}';\n`);
    target.stdin.end();
    const [code] = await once(target, 'close');
    if (code !== 0 || !targetStdout.includes(`IMPORT_COMMITTED|${context.newWorkspaceId}`)) {
      throw new Error(`Target import failed (${code}): ${targetStderr || targetStdout}`);
    }
    console.log(JSON.stringify({
      importedWorkspaceId: context.newWorkspaceId.toString(),
      importedWorkspaceName: workspaceRows[0].name,
      responseRows: context.counts.get('response').toString(),
      scoreV3Rows: context.criticalStats.score_v3_count,
      status: 'committed'
    }, null, 2));
  } catch (error) {
    if (target && target.exitCode === null) target.kill('SIGTERM');
    throw error;
  } finally {
    await snapshot.close();
  }
}

const mode = process.argv[2];
if (mode === '--preflight') await preflight();
else if (mode === '--apply') await apply();
else throw new Error('Use --preflight or --apply');
