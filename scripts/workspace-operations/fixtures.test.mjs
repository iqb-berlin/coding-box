import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteIdentifier, quoteLiteral, transformExpression,
  transformLocalRow, transformSnapshotJson, csvValue, sequenceSql
} from '../migration/copy-workspace-between-servers.mjs';
import {
  parseArguments, assertIntegerString, assertSignedIntegerString,
  parseCopyRows, decodeCopyText, csvCell
} from '../recovery/workspace-2-v2-recovery.mjs';

const context = () => ({
  newWorkspaceId: 90,
  users: { map: new Map([[1, 101], [2, 102]]) },
  offsets: new Map([
    ['coding_job', 1000n], ['coder_training', 2000n],
    ['job_definitions', 3000n], ['variable_bundle', 4000n]
  ]),
  foreignKeys: new Map(),
  columns: new Map([
    ['job_definitions', [{ column_name: 'id' }, { column_name: 'workspace_id' }]],
    ['coder_training', [{ column_name: 'id' }, { column_name: 'workspace_id' }]]
  ])
});

test('importing operation modules does not start their CLI entry points', () => {
  assert.equal(typeof transformLocalRow, 'function');
  assert.equal(typeof parseArguments, 'function');
});

test('SQL quoting preserves identifiers and literals without escaping their delimiters', () => {
  assert.equal(quoteIdentifier('a"b'), '"a""b"');
  assert.equal(quoteLiteral("a'b"), "'a''b'");
});

test('migration remaps workspace, user and optional foreign keys', () => {
  const state = context();
  state.foreignKeys.set('coding_job.reviewer_user_id', 'user');
  assert.equal(transformExpression({ name: 'coding_job' }, { column_name: 'workspace_id' }, state),
    '90 AS "workspace_id"');
  assert.match(transformExpression({ name: 'coding_job' }, { column_name: 'reviewer_user_id' }, state),
    /WHEN 1 THEN 101 WHEN 2 THEN 102/);
  assert.match(transformExpression({ name: 'coding_job_unit' }, { column_name: 'variable_bundle_id' }, state),
    /IS NULL THEN NULL ELSE "variable_bundle_id" \+ 4000/);
});

test('migration transforms nested distribution data without mutating its input', () => {
  const input = {
    workspaceId: 1, jobId: 5, trainingId: 6, itemKey: 'bundle:7',
    coderWeights: { 1: 0.5 }, pairDistribution: { '1-2': 3 }
  };
  const copy = structuredClone(input);
  assert.deepEqual(transformSnapshotJson(input, context()), {
    workspaceId: 90, jobId: 1005, trainingId: 2006, itemKey: 'bundle:4007',
    coderWeights: { 101: 0.5 }, pairDistribution: { '101-102': 3 }
  });
  assert.deepEqual(input, copy);
  assert.throws(() => transformSnapshotJson({ coderId: 99 }, context()), /Unknown user/);
  assert.throws(() => transformSnapshotJson({ pairDistribution: { '1-99': 2 } }, context()), /Unknown user pair/);
});

test('migration offsets local job definitions and remaps assigned users and bundles', () => {
  const input = {
    id: 5, workspace_id: 1, assigned_coders: [1, 2],
    assigned_variable_bundles: [{ id: 7 }], assigned_coder_configs: [{ coderId: 2 }],
    distribution_snapshots: { jobId: 3 }
  };
  const result = transformLocalRow({ name: 'job_definitions' }, input, context());
  assert.equal(result.id, 3005);
  assert.equal(result.workspace_id, 90);
  assert.deepEqual(result.assigned_coders, [101, 102]);
  assert.deepEqual(result.assigned_variable_bundles, [{ id: 4007 }]);
  assert.deepEqual(result.assigned_coder_configs, [{ coderId: 102 }]);
  assert.equal(result.distribution_snapshots.jobId, 1003);
  assert.equal(input.id, 5);
});

test('CSV serializers distinguish nulls, quoted text and PostgreSQL null markers', () => {
  assert.equal(csvValue(null), '\\N');
  assert.equal(csvValue(true), 't');
  assert.equal(csvValue('a,"b'), '"a,""b"');
  assert.equal(csvCell('\\N'), '"\\N"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell(null, '\\N'), '\\N');
});

test('sequence repair handles quoted relations and empty tables', () => {
  const sql = sequenceSql(context());
  assert.match(sql, /public\."user"/);
  assert.match(sql, /COALESCE\(\(SELECT MAX\(id\)/);
  assert.match(sql, /EXISTS\(SELECT 1 FROM/);
  assert.match(sql, /IS NOT NULL/);
});

test('recovery arguments default to read-only and reject unknown flags', () => {
  assert.equal(parseArguments([]).apply, false);
  assert.equal(parseArguments(['--apply', '--confirm', 'fixture']).confirm, 'fixture');
  assert.throws(() => parseArguments(['--unexpected']), /Unknown argument/);
});

test('recovery COPY parser handles escapes and rejects malformed rows and identifiers', () => {
  assert.deepEqual(parseCopyRows('1\t2\n\\.\n', 2), [['1', '2']]);
  assert.throws(() => parseCopyRows('1\t2\t3', 2), /columns/);
  assert.equal(decodeCopyText('a\\tb\\n\\141\\x62'), 'a\tb\nab');
  assert.equal(decodeCopyText('\\N'), null);
  assert.equal(assertSignedIntegerString('-2', 'fixture'), -2);
  assert.throws(() => assertIntegerString('1;DELETE', 'fixture'), /not an integer/);
});
