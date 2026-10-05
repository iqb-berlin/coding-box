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
      AND login IN ('replay-login-a', 'replay-login-b');
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
