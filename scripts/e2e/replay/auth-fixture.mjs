import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { findComposeContainer } from './compose-container.mjs';
import { FILE_ACCESS_USERS } from './file-access-users.mjs';

const exec = promisify(execFile);

export async function setupCodingFixture(state, environment) {
  const { config, workspaceId, adminToken } = state;
  const api = async (route, body, method = 'POST') => {
    const response = await fetch(`${config.apiUrl}/api${route}`, {
      method,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok)
      throw new Error(
        `Coding fixture ${route}: HTTP ${response.status}: ${await response.text()}`
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const userId = Number(
    await api('/admin/users', {
      username: 'coding-e2e',
      identity: '11111111-1111-4111-8111-111111111111',
      issuer: config.issuer,
      isAdmin: true,
      firstName: 'Coding',
      lastName: 'E2E'
    })
  );
  if (!Number.isInteger(userId) || userId <= 0)
    throw new Error('Invalid coding fixture user id');
  await api(`/admin/users/${userId}/workspaces`, [workspaceId]);
  for (const user of FILE_ACCESS_USERS) {
    const fileUserId = Number(await api('/admin/users', {
      username: user.username,
      identity: user.identity,
      issuer: config.issuer,
      isAdmin: user.isAdmin
    }));
    if (!Number.isInteger(fileUserId) || fileUserId <= 0) {
      throw new Error(`Invalid file access fixture user id for ${user.username}`);
    }
    if (user.accessLevel > 0) {
      await api(`/admin/users/access/${workspaceId}`, [{
        id: fileUserId,
        accessLevel: user.accessLevel,
        canCode: user.accessLevel === 1
      }], 'PATCH');
    }
  }

  const scheme = {
    version: '3.4',
    variableCodings: [
      {
        id: 'answer_1',
        alias: 'answer_1',
        label: 'Answer',
        sourceType: 'BASE',
        processing: [],
        codeModel: 'MANUAL_ONLY',
        manualInstruction: '<p>Choose a code.</p>',
        codes: [0, 1].map((id) => ({
          id,
          type: 'FULL_CREDIT',
          label: `Code ${id}`,
          score: id,
          manualInstruction: `<p>Test code ${id}</p>`,
          ruleSetOperatorAnd: false,
          ruleSets: []
        }))
      }
    ]
  };
  const unit = (
    await readFile(path.join(config.fixtureDir, 'UNIT-REPLAY.xml'), 'utf8')
  ).replace(
    '</Unit>',
    '<CodingSchemeRef schemer="iqb-schemer@3.4">UNIT-REPLAY-ALIAS.VOCS</CodingSchemeRef></Unit>'
  );
  const form = new FormData();
  form.append(
    'files',
    new Blob([unit], { type: 'application/xml' }),
    'UNIT-REPLAY.xml'
  );
  form.append(
    'files',
    new Blob([unit.replaceAll('UNIT-REPLAY-ALIAS', 'UNIT-REPLAY')], {
      type: 'application/xml'
    }),
    'UNIT-REPLAY-CODING.xml'
  );
  form.append(
    'files',
    new Blob([JSON.stringify(scheme)]),
    'UNIT-REPLAY-ALIAS.VOCS'
  );
  // The imported responses use the public unit name. Replay assets are looked up
  // by that name, while the original dataset also exercises an alias-based unit.
  form.append(
    'files',
    new Blob([await readFile(path.join(config.fixtureDir, 'UNIT-REPLAY.VOUD'))]),
    'UNIT-REPLAY.VOUD'
  );
  form.append('files', new Blob([JSON.stringify(scheme)]), 'UNIT-REPLAY.VOCS');
  const uploaded = await fetch(
    `${config.apiUrl}/api/admin/workspace/${workspaceId}/upload?overwriteExisting=true`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: form
    }
  );
  if (!uploaded.ok)
    throw new Error(`Coding scheme upload: HTTP ${uploaded.status}`);
  const result = await uploaded.json();
  if (result.failed)
    throw new Error(
      `Coding scheme upload failed: ${JSON.stringify(result.failedFiles)}`
    );

  // Limit seeding to the disposable fixture workspace. Status 8 = CODING_INCOMPLETE.
  const dbContainer = await findComposeContainer(config.composeProject, 'db');
  await exec('docker', [
    'exec',
    dbContainer,
    'psql',
    '-U',
    'replay_e2e',
    '-d',
    'replay_e2e',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `UPDATE response SET status_v1=8 WHERE variableid='answer_1' AND unitid IN
     (SELECT unit.id FROM unit JOIN booklet ON booklet.id=unit.bookletid
      JOIN persons ON persons.id=booklet.personid WHERE persons.workspace_id=${workspaceId})`
  ]);
  const job = await api(`/wsg-admin/workspace/${workspaceId}/coding-job`, {
    name: 'Live authentication coding job',
    assignedCoders: [userId],
    variables: [{ unitName: 'UNIT-REPLAY', variableId: 'answer_1' }],
    allowComments: true
  });
  return {
    codingJobId: job.id,
    userId,
    username: 'coding-e2e',
    password: environment.REPLAY_E2E_AUTH_PASSWORD,
    keycloakUrl: environment.REPLAY_E2E_KEYCLOAK_URL
  };
}
