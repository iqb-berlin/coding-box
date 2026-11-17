import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';
import { compareSnapshots, normalizeConstraintDefinition, quoteIdentifier, snapshotDatabase } from './postgres-migration-snapshot.mjs';

const snapshot = () => ({ formatVersion: 1, server: 'PostgreSQL 14.24', extensions: [], preserved: {
  database: { encoding: 'UTF8', datcollate: 'de_DE.utf8', datctype: 'de_DE.utf8', owner: 'root' },
  access: { schemas: [{ nspname: 'public', owner: 'root', acl: ['=UC/root'] }], relations: [] },
  enums: [], columns: [], constraints: [], indexes: [], sequences: [{ sequencename: 'response_id_seq', last_value: '7', is_called: true }],
  tables: [{ name: 'response', rows: 3, sha256: 'all-values-codes-and-scores' }]
} });

test('expected server/extension version changes do not hide data or schema changes', () => {
  const before = snapshot();
  const after = structuredClone(before);
  after.server = 'PostgreSQL 17.12';
  after.extensions.push({ extname: 'pg_stat_statements', extversion: '1.11' });
  assert.deepEqual(compareSnapshots(before, after), []);
  for (const key of ['tables', 'enums', 'columns', 'constraints', 'indexes', 'sequences']) {
    const changed = structuredClone(after);
    changed.preserved[key].push({ changed: true });
    assert.deepEqual(compareSnapshots(before, changed), [key]);
  }
  after.preserved.database.datcollate = 'C';
  assert.deepEqual(compareSnapshots(before, after), ['database']);
  after.preserved.database.datcollate = 'de_DE.utf8';
  after.preserved.access.schemas[0].acl = ['=U/root'];
  assert.deepEqual(compareSnapshots(before, after), ['access']);
});

test('missing table rows, changed values and reset sequences all fail the comparison', () => {
  for (const mutate of [
    value => { value.preserved.tables[0].rows -= 1; },
    value => { value.preserved.tables[0].sha256 = 'changed-score'; },
    value => { value.preserved.sequences[0].last_value = '1'; }
  ]) {
    const after = snapshot(); mutate(after);
    assert(compareSnapshots(snapshot(), after).length > 0);
  }
  assert.throws(() => compareSnapshots({ formatVersion: 1 }, snapshot()), /complete/);
  assert.throws(() => compareSnapshots({ ...snapshot(), formatVersion: 2 }, snapshot()), /formatVersion/);
});

test('catalog identifiers are quoted and invalid time limits cannot start work', async () => {
  assert.equal(quoteIdentifier('odd"; DROP TABLE response; --'), '"odd""; DROP TABLE response; --"');
  const client = { query: () => { throw new Error('Must not query'); } };
  for (const value of [0, -1, NaN, 1.5, 2147483648]) {
    await assert.rejects(snapshotDatabase(client, value), /positive integer/);
  }
});

test('only the equivalent varchar literal array rendering is normalized across PostgreSQL 14 and 17', () => {
  const old = "CHECK (((state)::text = ANY ((ARRAY['draft'::character varying, 'it''s, applied'::character varying])::text[])))";
  const current = "CHECK (((state)::text = ANY (ARRAY[('draft'::character varying)::text, ('it''s, applied'::character varying)::text])))";
  assert.equal(normalizeConstraintDefinition(old), current);
  assert.equal(normalizeConstraintDefinition(current), current);
  assert.notEqual(normalizeConstraintDefinition(old.replace('draft', 'deleted')), current);
  for (const sql of ["CHECK (score > 0)", "CHECK (state = ANY ((ARRAY[state, 'draft'])::text[])))",
    "CHECK (state = ANY ((ARRAY['draft'::text])::text[])))",
    `CHECK (state = '${old.replaceAll("'", "''")}')`,
    `CHECK ("${old}" IS NOT NULL)`, `CHECK (state = $sql$${old}$sql$)`]) {
    assert.equal(normalizeConstraintDefinition(sql), sql);
  }
});

test('normal builds, staging, CI and application E2E fixtures use PostgreSQL 17.12; 14 is only a migration source check', () => {
  const image = 'postgres:17.12-alpine3.24@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7';
  const staging = yaml.load(readFileSync('docker-compose.postgres17.prepare.yaml', 'utf8'));
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('!reference', { kind: 'sequence', construct: value => value })]);
  const ci = yaml.load(readFileSync('.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml', 'utf8'), { schema });
  assert(readFileSync('database/Postgres.Dockerfile', 'utf8').includes(`ARG POSTGRES_IMAGE=${image}`));
  assert.equal(staging.services.db17.build.args.POSTGRES_IMAGE, image);
  assert.equal(staging.services.db, undefined);
  assert.match(staging.volumes.db17_vol.name, /POSTGRES17_VOLUME_NAME:\?/);
  assert.equal(staging.volumes.db17_vol.external, true);
  const gate = ci['test-backend-integration'];
  assert.equal(gate.variables.BACKEND_INTEGRATION_POSTGRES_VERSION, '17.12');
  assert(gate.services.some(service => service.name === `\${DOCKER_HUB_PROXY}${image}`));
  assert(ci['test-backend'].services.some(service => service.name === `\${DOCKER_HUB_PROXY}${image}`));
  const legacy = ci['test-backend-integration-postgres14'];
  assert.equal(legacy.extends, 'test-backend-integration');
  assert.equal(legacy.variables.BACKEND_INTEGRATION_POSTGRES_VERSION, '14.24');
  assert(legacy.services.some(service => service.name.includes('postgres:14.24-')));
  for (const file of ['scripts/e2e/replay/docker-compose.replay.yml', 'scripts/e2e/codebook/docker-compose.yml',
    'scripts/qa/verify-backend-container.sh']) assert(readFileSync(file, 'utf8').includes(image));
});

test('normal Compose retains the historical volume unless the restored target is selected explicitly', () => {
  for (const file of ['docker-compose.yaml', 'docker-compose.coding-box.yaml']) {
    const config = yaml.load(readFileSync(file, 'utf8'));
    assert.deepEqual(config.services.db.volumes, ['db_vol:/var/lib/postgresql/data']);
    assert.equal(config.volumes.db_vol.name, '${POSTGRES_DATA_VOLUME:-${COMPOSE_PROJECT_NAME}_db_vol}');
    assert.equal(config.volumes.db_vol.external, '${POSTGRES_DATA_VOLUME_EXTERNAL:-false}');
    assert.equal(config.services.backend.environment.POSTGRES_POOL_ACQUIRE_TIMEOUT_MS, '${POSTGRES_POOL_ACQUIRE_TIMEOUT_MS:-0}');
    assert.equal(config.services.backend.environment.POSTGRES_SLOW_QUERY_MS, '${POSTGRES_SLOW_QUERY_MS:-0}');
  }
  for (const file of ['.env.dev.template', '.env.coding-box.template']) {
    assert.match(readFileSync(file, 'utf8'), /^POSTGRES_DATA_VOLUME=$/m);
    assert.match(readFileSync(file, 'utf8'), /^POSTGRES_DATA_VOLUME_EXTERNAL=false$/m);
  }
});
