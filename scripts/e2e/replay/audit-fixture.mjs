import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findComposeContainer } from './compose-container.mjs';
import { FIXTURE_ADMIN_USERNAME } from './auth-environment.mjs';

const exec = promisify(execFile);

/** Inject an audit failure only into the unique, disposable workflow database. */
export async function verifyAuditRollback(state) {
  const { config, workspaceId, adminToken } = state;
  assert.match(config.composeProject, /^coding-box-replay-[a-z0-9-]+$/);
  assert.ok(Number.isSafeInteger(workspaceId) && workspaceId > 0);
  assert.ok(typeof adminToken === 'string' && adminToken.length > 0);
  const dbContainer = await findComposeContainer(config.composeProject, 'db');
  const sql = async statement => {
    const { stdout } = await exec('docker', [
      'exec', dbContainer, 'psql', '-U', 'replay_e2e', '-d', 'replay_e2e',
      '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', statement
    ], { timeout: 30_000 });
    return stdout.trim();
  };
  const request = async (route, method = 'GET') => {
    const response = await fetch(`${config.apiUrl}/api${route}`, {
      method, headers: { authorization: `Bearer ${adminToken}` }
    });
    return { status: response.status, body: await response.json() };
  };
  const identity = await request('/auth-data');
  assert.equal(identity.status, 200);
  const actorUserId = identity.body.userId;
  assert.ok(Number.isSafeInteger(actorUserId) && actorUserId > 0);
  assert.equal(identity.body.userName, FIXTURE_ADMIN_USERNAME);
  assert.equal(identity.body.isAdmin, true);
  const personId = Number(await sql(`SELECT id FROM persons
    WHERE workspace_id=${workspaceId} AND login='replay-login-c'`));
  assert.ok(Number.isSafeInteger(personId) && personId > 0, 'Expected one synthetic baseline person');
  const snapshot = async () => JSON.parse(await sql(`SELECT json_build_object(
    'personIds', ARRAY(SELECT id FROM persons WHERE id=${personId}),
    'bookletIds', ARRAY(SELECT id FROM booklet WHERE personid=${personId} ORDER BY id),
    'unitIds', ARRAY(SELECT id FROM unit WHERE bookletid IN
      (SELECT id FROM booklet WHERE personid=${personId}) ORDER BY id),
    'responseIds', ARRAY(SELECT id FROM response WHERE unitid IN
      (SELECT id FROM unit WHERE bookletid IN
        (SELECT id FROM booklet WHERE personid=${personId})) ORDER BY id))`));
  const events = async () => JSON.parse(await sql(`SELECT COALESCE(json_agg(json_build_object(
    'workspaceId', workspace_id, 'actorUserId', actor_user_id, 'actorType', actor_type,
    'eventType', event_type, 'entityId', entity_id, 'result', result)), '[]'::json)
    FROM journal_entries WHERE workspace_id=${workspaceId}
    AND event_type='TEST_PERSON_DELETED' AND entity_id='${personId}'`));
  const before = await snapshot();
  assert.deepEqual(before.personIds, [personId]);
  assert.ok(before.responseIds.length > 0, 'Rollback must preserve dependent response rows');
  assert.deepEqual(await events(), []);

  await sql(`ALTER TABLE journal_entries ADD CONSTRAINT e2e_reject_person_audit
    CHECK (workspace_id<>${workspaceId} OR event_type IS DISTINCT FROM 'TEST_PERSON_DELETED'
      OR entity_id IS DISTINCT FROM '${personId}') NOT VALID`);
  const route = `/admin/workspace/${workspaceId}/test-results?testPersons=${personId}`;
  try {
    const rejected = await request(route, 'DELETE');
    assert.equal(rejected.status, 500, 'The real audit write must fail');
    assert.deepEqual(await snapshot(), before, 'Person and dependent rows must survive rollback');
    assert.deepEqual(await events(), [], 'A rolled-back deletion must not leave an audit event');
  } finally {
    await sql('ALTER TABLE journal_entries DROP CONSTRAINT e2e_reject_person_audit');
  }

  const committed = await request(route, 'DELETE');
  assert.equal(committed.status, 200);
  assert.equal(committed.body.success, true);
  assert.deepEqual(await snapshot(), { personIds: [], bookletIds: [], unitIds: [], responseIds: [] });
  assert.deepEqual(await events(), [{
    workspaceId, actorUserId, actorType: 'user',
    eventType: 'TEST_PERSON_DELETED', entityId: String(personId), result: 'success'
  }]);
  return { rollbackVerified: true, deletionVerified: true, actorUserId };
}
