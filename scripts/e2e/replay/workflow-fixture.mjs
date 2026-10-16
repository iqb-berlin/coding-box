import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findComposeContainer } from './compose-container.mjs';

const exec = promisify(execFile);

/** Prepare only the newly browser-imported synthetic case for manual coding. */
export async function prepareImportedCoding(state) {
  const { config, workspaceId, adminToken, browser } = state;
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0 ||
      !Number.isSafeInteger(browser.userId) || browser.userId <= 0) {
    throw new Error('Invalid disposable workflow fixture identifiers.');
  }
  const dbContainer = await findComposeContainer(config.composeProject, 'db');
  const { stdout } = await exec('docker', [
    'exec', dbContainer, 'psql', '-U', 'replay_e2e', '-d', 'replay_e2e',
    '-v', 'ON_ERROR_STOP=1', '-c',
    // Baseline cases belong to the replay fixture. Keep this coding job limited
    // to the newly imported person rather than choosing a random case limit.
    `UPDATE persons SET consider=false WHERE workspace_id=${workspaceId}
      AND login IN ('replay-login-a', 'replay-login-b', 'replay-login-c');
     UPDATE response SET status_v1=8 WHERE variableid='answer_1' AND unitid IN
      (SELECT unit.id FROM unit JOIN booklet ON booklet.id=unit.bookletid
       JOIN persons ON persons.id=booklet.personid
       WHERE persons.workspace_id=${workspaceId} AND persons.login='workflow-import')`
  ]);
  if (!stdout.includes('UPDATE 1')) {
    throw new Error('The browser import must persist exactly one new coding response.');
  }
  const response = await fetch(
    `${config.apiUrl}/api/wsg-admin/workspace/${workspaceId}/coding-job`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Browser import workflow',
        assignedCoders: [browser.userId],
        variables: [{ unitName: 'UNIT-REPLAY', variableId: 'answer_1' }],
        allowComments: true
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Imported coding job creation failed: HTTP ${response.status}`);
  }
  const job = await response.json();
  if (!Number.isSafeInteger(job.id) || job.id <= 0) {
    throw new Error('Imported coding job creation returned an invalid id.');
  }
  return { codingJobId: job.id };
}

/** Synthetic ownership rows, scoped to this run's disposable workspace. */
export async function prepareOwnership(state) {
  const { config, workspaceId, browser } = state;
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0 || !Number.isSafeInteger(browser.userId)) {
    throw new Error('Ownership setup requires the disposable workspace.');
  }
  const dbContainer = await findComposeContainer(config.composeProject, 'db');
  const ownerId = browser.fileAccessUserIds?.['file-access-2'];
  const coderId = browser.fileAccessUserIds?.['file-access-1'];
  if (![ownerId, coderId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error('Ownership setup requires stable role principal IDs.');
  }
  const result = {};
  for (const [kind, table, columns, values] of [
    ['bundle', 'variable_bundle', 'name,variables', "'Ownership proof','[]'"],
    ['definition', 'job_definitions', 'name,distribution_seed,assigned_variables,assigned_coders',
      `'Ownership proof','ownership-proof','[{"unitName":"UNIT-REPLAY","variableId":"answer_1"}]','[${browser.userId}]'`],
    ['job', 'coding_job', 'name', "'Ownership proof'"],
    ['training', 'coder_training', 'label', "'Ownership proof'"]
  ]) {
    const { stdout } = await exec('docker', [
      'exec', dbContainer, 'psql', '-U', 'replay_e2e', '-d', 'replay_e2e', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c',
      `WITH inserted AS (INSERT INTO ${table}(workspace_id,creator_user_id,${columns})
       SELECT ${workspaceId}, owner_id, ${values} FROM (VALUES
       (${ownerId}), (${browser.userId}), (NULL::integer)) owners(owner_id)
       RETURNING id,creator_user_id)
       SELECT json_build_object('own',max(id) FILTER(WHERE creator_user_id=${ownerId}),
       'foreign',max(id) FILTER(WHERE creator_user_id=${browser.userId}), 'legacy',max(id) FILTER(WHERE creator_user_id IS NULL)) FROM inserted`
    ]);
    result[kind] = JSON.parse(stdout.trim());
    if (Object.values(result[kind]).some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error(`Incomplete ownership fixture: ${kind}`);
    }
  }
  if (!Number.isSafeInteger(browser.codingJobId)) throw new Error('Missing source coding job for the assigned-coder fixture.');
  const legacyId = result.job.legacy;
  const { stdout: legacyCoding } = await exec('docker', [
    'exec', dbContainer, 'psql', '-U', 'replay_e2e', '-d', 'replay_e2e', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c',
    `INSERT INTO coding_job_coder(coding_job_id,user_id)
     VALUES (${legacyId},${coderId});
     WITH inserted AS (INSERT INTO coding_job_unit(coding_job_id,workspace_id,response_id,unit_name,unit_alias,variable_id,variable_anchor,booklet_name,person_login,person_code,person_group,is_open)
     SELECT ${legacyId}, ${workspaceId},response_id,unit_name,unit_alias,variable_id,variable_anchor,booklet_name,person_login,person_code,person_group,true
     FROM coding_job_unit WHERE coding_job_id=${browser.codingJobId} AND workspace_id=${workspaceId} ORDER BY id LIMIT 1 RETURNING *)
     SELECT json_build_object('testPerson',concat_ws('@',person_login,person_code,person_group,booklet_name),'unitId',unit_name,'variableId',variable_id) FROM inserted`
  ]);
  result.legacyCoding = JSON.parse(legacyCoding.trim());
  return result;
}
