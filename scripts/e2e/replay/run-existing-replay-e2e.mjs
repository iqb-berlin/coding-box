import { createHmac } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const workspaceId = parsePositiveInteger(
  process.env.REPLAY_EXISTING_WORKSPACE_ID || '2',
  'REPLAY_EXISTING_WORKSPACE_ID'
);
const unitId = process.env.REPLAY_EXISTING_UNIT_ID || 'g_P_Nav_allGeraete';
const responseVariable =
  process.env.REPLAY_EXISTING_RESPONSE_VARIABLE || 'radio-group-images_1';
const firstPageAlias =
  process.env.REPLAY_EXISTING_FIRST_PAGE_ALIAS || 'button_68';
const backendContainer =
  process.env.REPLAY_EXISTING_BACKEND_CONTAINER || 'kodierbox-backend-1';
const databaseContainer =
  process.env.REPLAY_EXISTING_DATABASE_CONTAINER || 'kodierbox-db-1';
const apiUrl = process.env.REPLAY_E2E_API_URL || 'http://127.0.0.1:3333';
const baseUrl = process.env.REPLAY_E2E_BASE_URL || 'http://127.0.0.1:4200';
const runDir = await mkdtemp(
  path.join(tmpdir(), 'coding-box-replay-existing-')
);
const setupFile = path.join(runDir, 'setup.json');

let exitCode = 1;
try {
  await assertHealthy(`${apiUrl}/api/health`);
  await assertHealthy(baseUrl);

  const [backendEnvironment, databaseEnvironment] = await Promise.all([
    inspectContainerEnvironment(backendContainer),
    inspectContainerEnvironment(databaseContainer)
  ]);
  const jwtSecret = requiredContainerValue(
    backendEnvironment,
    'JWT_SECRET',
    backendContainer
  );
  const databaseUser = requiredContainerValue(
    databaseEnvironment,
    'POSTGRES_USER',
    databaseContainer
  );
  const databaseName = requiredContainerValue(
    databaseEnvironment,
    'POSTGRES_DB',
    databaseContainer
  );
  const people = await selectReplayPeople({
    databaseContainer,
    databaseName,
    databaseUser,
    responseVariable,
    unitId,
    workspaceId
  });

  if (people.length !== 2) {
    throw new Error(
      'The existing database has no two suitable people with distinct replay responses.'
    );
  }

  const setup = {
    apiUrl,
    baseUrl,
    workspaceId,
    replayToken: createWorkspaceToken(
      jwtSecret,
      workspaceId,
      people[0].workspaceUserId,
      people[0].workspaceUsername
    ),
    expected: {
      unitName: people[0].unitName,
      unitAlias: people[0].unitAlias,
      pages: ['0', '1'],
      pageAliases: [firstPageAlias, responseVariable],
      anchor: responseVariable,
      anchorPage: '1',
      personA: toPersonExpectation(people[0], responseVariable),
      personB: toPersonExpectation(people[1], responseVariable),
      missingUnitError: {
        statusCode: 404,
        code: 'REPLAY_UNIT_NOT_FOUND',
        message: 'Replay unit was not found.'
      }
    }
  };

  await writeFile(setupFile, `${JSON.stringify(setup)}\n`, { mode: 0o600 });
  process.stdout.write(
    `Using existing replay data: workspace=${workspaceId}, unit=${unitId}, people=2, pages=2.\n`
  );
  await runCypress({
    ...process.env,
    REPLAY_E2E_API_URL: apiUrl,
    REPLAY_E2E_BASE_URL: baseUrl,
    REPLAY_E2E_EXISTING_SETUP_FILE: setupFile
  });
  exitCode = 0;
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error)}\n`);
} finally {
  await rm(runDir, { recursive: true, force: true });
}

process.exitCode = exitCode;

async function selectReplayPeople(config) {
  const sql = `
    WITH authorized_user AS (
      SELECT usr.id, usr.username
      FROM workspace_user wu
      JOIN "user" usr ON usr.id = wu.user_id
      WHERE wu.workspace_id = ${config.workspaceId}
      ORDER BY wu.access_level DESC, usr.id
      LIMIT 1
    ), candidates AS (
      SELECT
        p.id AS person_id,
        p.login,
        p.code,
        p."group" AS group_name,
        bi.name AS booklet_name,
        u.name AS unit_name,
        u.alias AS unit_alias,
        r.value AS response_value,
        r.status AS response_status,
        COALESCE(NULLIF(c.key, ''), NULLIF(r.subform, ''), '') AS response_chunk_id,
        au.id AS workspace_user_id,
        au.username AS workspace_username,
        ROW_NUMBER() OVER (PARTITION BY r.value ORDER BY p.id) AS value_rank
      FROM persons p
      JOIN booklet b ON b.personid = p.id
      JOIN bookletinfo bi ON bi.id = b.infoid
      JOIN unit u ON u.bookletid = b.id
      JOIN response r
        ON r.unitid = u.id
       AND r.variableid = ${quoteSqlLiteral(config.responseVariable)}
      LEFT JOIN chunk c
        ON c.unitid = u.id
       AND POSITION(r.variableid IN COALESCE(c.variables, '')) > 0
      CROSS JOIN authorized_user au
      WHERE p.workspace_id = ${config.workspaceId}
        AND p.consider IS TRUE
        AND (LOWER(u.name) = LOWER(${quoteSqlLiteral(config.unitId)})
          OR LOWER(u.alias) = LOWER(${quoteSqlLiteral(config.unitId)}))
        AND r.status = 3
        AND r.value IS NOT NULL
        AND r.value <> ''
    )
    SELECT ROW_TO_JSON(selected)::text
    FROM (
      SELECT
        login,
        code,
        group_name,
        booklet_name,
        unit_name,
        unit_alias,
        response_value,
        response_status,
        response_chunk_id,
        workspace_user_id,
        workspace_username
      FROM candidates
      WHERE value_rank = 1
      ORDER BY person_id
      LIMIT 2
    ) selected;
  `;
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'docker',
      [
        'exec',
        config.databaseContainer,
        'psql',
        '-U',
        config.databaseUser,
        '-d',
        config.databaseName,
        '-At',
        '-c',
        sql
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    ));
  } catch {
    throw new Error('Could not select replay data from the existing database.');
  }

  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line);
      return {
        login: row.login,
        code: row.code,
        group: row.group_name,
        booklet: row.booklet_name,
        unitName: row.unit_name,
        unitAlias: row.unit_alias,
        responseValue: row.response_value,
        responseStatus: Number(row.response_status),
        responseChunkId: row.response_chunk_id,
        workspaceUserId: Number(row.workspace_user_id),
        workspaceUsername: row.workspace_username
      };
    });
}

function toPersonExpectation(person, responseVariableId) {
  return {
    connector: [person.login, person.code, person.group, person.booklet].join(
      '@'
    ),
    responseChunkId: person.responseChunkId,
    responseVariable: responseVariableId,
    responseStatus: person.responseStatus,
    responseValue: person.responseValue
  };
}

async function inspectContainerEnvironment(container) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{json .Config.Env}}',
      container
    ]));
  } catch {
    throw new Error(`Required local container is unavailable: ${container}.`);
  }

  return new Map(
    JSON.parse(stdout.trim()).map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    })
  );
}

function requiredContainerValue(environment, name, container) {
  const value = environment.get(name);
  if (!value) {
    throw new Error(`Container ${container} has no ${name} configuration.`);
  }
  return value;
}

function createWorkspaceToken(secret, workspace, userId, username) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' });
  const body = encodeJwtPart({
    userId,
    username,
    workspace,
    tokenType: 'workspace-api',
    scopes: ['replay:read', 'replay-statistics:write'],
    iat: now,
    exp: now + 3600
  });
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function assertHealthy(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error();
    }
  } catch {
    throw new Error(`The existing application is not healthy at ${url}.`);
  }
}

async function runCypress(environment) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'cypress',
        'run',
        '--config-file',
        'cypress.replay.config.ts',
        '--browser',
        'electron'
      ],
      { env: environment, stdio: 'inherit' }
    );
    child.once('error', () => reject(new Error('Could not start Cypress.')));
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Cypress exited with code ${code}.`));
      }
    });
  });
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : 'Existing replay E2E failed.';
}
