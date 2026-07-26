import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_ENV = [
  'REPLAY_E2E_API_URL',
  'REPLAY_E2E_BASE_URL',
  'REPLAY_E2E_CACHE_DIR',
  'REPLAY_E2E_FIXTURE_DIR',
  'REPLAY_E2E_JWT_SECRET',
  'REPLAY_E2E_RUN_ID',
  'REPLAY_E2E_STATE_FILE'
];

const ISSUER = 'http://replay-e2e.invalid/realms/replay-e2e';
const CLIENT_ID = 'replay-e2e';

export function createReplayHarness(environment = process.env) {
  if (environment.REPLAY_E2E_EXISTING_SETUP_FILE) {
    return createExistingReplayHarness(
      path.resolve(environment.REPLAY_E2E_EXISTING_SETUP_FILE)
    );
  }

  const config = readConfig(environment);
  let activeState;

  return {
    async setup() {
      if (activeState) {
        return activeState.browser;
      }

      activeState = await setupReplayWorkspace(config);
      return activeState.browser;
    },

    async cleanup() {
      const workspaceId = activeState?.workspaceId;
      if (workspaceId) {
        await deleteWorkspace(config, workspaceId);
        activeState = undefined;
      } else {
        await cleanupReplayWorkspaceFromState(environment);
      }
      return null;
    }
  };
}

function createExistingReplayHarness(setupFile) {
  let browser;

  return {
    async setup() {
      browser ||= await readJson(setupFile);
      return browser;
    },

    async cleanup() {
      return null;
    }
  };
}

export async function cleanupReplayWorkspaceFromState(
  environment = process.env
) {
  const config = readConfig(environment);
  let storedState;
  try {
    storedState = JSON.parse(await readFile(config.stateFile, 'utf8'));
  } catch {
    return;
  }

  if (!storedState.workspaceId || storedState.cleanedAt) {
    return;
  }

  await deleteWorkspace(config, storedState.workspaceId);
  await writeState(config, {
    ...storedState,
    cleanedAt: new Date().toISOString()
  });
}

async function setupReplayWorkspace(config) {
  const [manifest, expected, playerSource, checksumFile] = await Promise.all([
    readJson(path.join(config.fixtureDir, 'manifest.json')),
    readJson(path.join(config.fixtureDir, 'expected.json')),
    readJson(path.join(config.fixtureDir, 'player-source.json')),
    readFile(path.join(config.fixtureDir, 'SHA256SUMS'), 'utf8')
  ]);

  const playerChecksum = validatePlayerSource(playerSource, checksumFile);
  const playerPath = await getVerifiedPlayer(
    config,
    playerSource,
    playerChecksum
  );
  const adminToken = createAdminToken(config);
  const workspaceName = `replay-e2e-${config.runId}`;
  let workspaceId;

  try {
    workspaceId = Number(
      await apiJson(config, '/admin/workspace', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ name: workspaceName, settings: {} }),
        headers: { 'content-type': 'application/json' }
      })
    );

    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      throw new Error('The workspace API did not return a valid id.');
    }

    await writeState(config, {
      runId: config.runId,
      workspaceId,
      workspaceName,
      createdAt: new Date().toISOString()
    });

    await uploadReplayFiles(
      config,
      workspaceId,
      adminToken,
      manifest,
      playerSource,
      playerPath
    );
    const jobStatus = await importResponses(
      config,
      workspaceId,
      adminToken,
      manifest
    );
    const replayToken = await apiJson(
      config,
      `/admin/workspace/${workspaceId}/token/1?scopes=replay%3Aread`,
      { token: adminToken }
    );

    await writeState(config, {
      runId: config.runId,
      workspaceId,
      workspaceName,
      createdAt: new Date().toISOString(),
      uploadJobId: jobStatus.id,
      uploadStatus: jobStatus.status
    });

    return {
      workspaceId,
      browser: {
        apiUrl: config.apiUrl,
        baseUrl: config.baseUrl,
        workspaceId,
        replayToken,
        expected
      }
    };
  } catch (error) {
    if (workspaceId) {
      await deleteWorkspace(config, workspaceId).catch(() => undefined);
    }
    throw error;
  }
}

async function uploadReplayFiles(
  config,
  workspaceId,
  token,
  manifest,
  playerSource,
  playerPath
) {
  const form = new FormData();
  await appendFile(
    form,
    path.join(config.fixtureDir, manifest.files.booklet),
    manifest.files.booklet,
    'application/xml'
  );
  await appendFile(
    form,
    path.join(config.fixtureDir, manifest.files.unit),
    manifest.files.unit,
    'application/xml'
  );
  await appendFile(
    form,
    path.join(config.fixtureDir, manifest.files.unitDefinition),
    `${manifest.unit.alias}.VOUD`,
    'application/octet-stream'
  );
  await appendFile(form, playerPath, playerSource.fileName, 'text/html');

  const uploadResult = await apiJson(
    config,
    `/admin/workspace/${workspaceId}/upload?overwriteExisting=true`,
    { method: 'POST', token, body: form }
  );

  if (
    uploadResult.failed !== 0 ||
    uploadResult.uploaded !== uploadResult.total ||
    uploadResult.uploaded !== 4
  ) {
    throw new Error(
      `Replay file upload failed (${uploadResult.uploaded || 0}/${uploadResult.total || 4} uploaded).`
    );
  }
}

async function importResponses(config, workspaceId, token, manifest) {
  const form = new FormData();
  await appendFile(
    form,
    path.join(config.fixtureDir, manifest.files.responses),
    manifest.files.responses,
    'text/csv'
  );

  const jobs = await apiJson(
    config,
    `/admin/workspace/${workspaceId}/upload/results/responses?overwriteExisting=true&overwriteMode=replace&scope=person`,
    { method: 'POST', token, body: form }
  );
  const jobId = jobs?.[0]?.jobId;
  if (!jobId) {
    throw new Error('Response import did not return a queue job id.');
  }

  return pollJob(config, workspaceId, token, jobId);
}

async function pollJob(config, workspaceId, token, jobId) {
  const deadline = Date.now() + 120_000;
  let lastStatus;

  while (Date.now() < deadline) {
    lastStatus = await apiJson(
      config,
      `/admin/workspace/${workspaceId}/upload/status/${encodeURIComponent(jobId)}`,
      { token }
    );

    if (lastStatus.status === 'completed') {
      return lastStatus;
    }
    if (lastStatus.status === 'failed') {
      throw new Error(`Response import failed: ${safeJobMessage(lastStatus)}`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Response import timed out: ${safeJobMessage(lastStatus)}`);
}

async function getVerifiedPlayer(config, source, expectedHash) {
  const cachePath = path.join(config.cacheDir, source.fileName);
  await mkdir(config.cacheDir, { recursive: true });

  try {
    await stat(cachePath);
    await assertHash(cachePath, expectedHash);
    return cachePath;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const response = await fetch(source.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Player download failed with HTTP ${response.status}.`);
  }

  const player = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash('sha256').update(player).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(
      `Player checksum mismatch: expected ${expectedHash}, got ${actualHash}.`
    );
  }

  await writeFile(cachePath, player);
  return cachePath;
}

function validatePlayerSource(source, checksumFile) {
  if (
    source.version !== '2.9.4' ||
    source.fileName !== 'iqb-player-aspect-2.9.4.html' ||
    path.basename(source.fileName) !== source.fileName
  ) {
    throw new Error(
      'Player source does not describe the pinned Aspect 2.9.4 file.'
    );
  }

  const sourceUrl = new URL(source.url);
  if (
    sourceUrl.protocol !== 'https:' ||
    sourceUrl.hostname !== 'github.com' ||
    !sourceUrl.pathname.startsWith(
      '/iqb-berlin/verona-modules-aspect/releases/download/editor/2.9.4%2Bplayer/2.9.4/'
    ) ||
    path.posix.basename(sourceUrl.pathname) !== source.fileName
  ) {
    throw new Error(
      'Player source URL is not the pinned official IQB release URL.'
    );
  }

  const checksumEntries = checksumFile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^([a-f\d]{64})\s+\*?(.+)$/i))
    .filter((match) => match?.[2] === source.fileName);
  if (checksumEntries.length !== 1) {
    throw new Error(
      `SHA256SUMS must contain exactly one entry for ${source.fileName}.`
    );
  }

  const checksum = checksumEntries[0][1].toLowerCase();
  if (source.sha256.toLowerCase() !== checksum) {
    throw new Error(
      'Player checksum differs between player-source.json and SHA256SUMS.'
    );
  }
  return checksum;
}

export function redactReplayArtifactLog(output) {
  return output
    .replace(
      /(authorization\s*[:=]\s*)bearer\s+[^\s"']+/gi,
      '$1[redacted-token]'
    )
    .replace(/\bbearer\s+[^\s"']+/gi, 'Bearer [redacted-token]')
    .replace(
      /([?&](?:auth|access_token|token)=)[^&\s"']+/gi,
      '$1[redacted-token]'
    )
    .replace(
      /\beyJ[A-Za-z\d_-]*\.eyJ[A-Za-z\d_-]*\.[A-Za-z\d_-]+\b/g,
      '[redacted-jwt]'
    )
    .replace(/[^\s"'/?@]+(?:@[^\s"'/?@]+){2,3}/g, '[redacted-connector]')
    .replace(/[^\s"'/?]+(?:%40[^\s"'/?]+){2,3}/gi, '[redacted-connector]');
}

async function assertHash(filePath, expectedHash) {
  const actualHash = createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(
      `Cached player checksum mismatch: expected ${expectedHash}, got ${actualHash}.`
    );
  }
}

async function deleteWorkspace(config, workspaceId) {
  const response = await fetch(
    `${config.apiUrl}/api/admin/workspace?ids=${encodeURIComponent(workspaceId)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${createAdminToken(config)}` }
    }
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(`Workspace cleanup failed with HTTP ${response.status}.`);
  }
}

async function apiJson(config, endpoint, options = {}) {
  const headers = new Headers(options.headers);
  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(`${config.apiUrl}/api${endpoint}`, {
    ...options,
    headers
  });
  if (!response.ok) {
    throw new Error(
      `Replay E2E API request failed with HTTP ${response.status}.`
    );
  }

  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function appendFile(form, filePath, fileName, mimeType) {
  form.append(
    'files',
    new Blob([await readFile(filePath)], { type: mimeType }),
    fileName
  );
}

function createAdminToken(config) {
  const now = Math.floor(Date.now() / 1000);
  return signHs256(
    {
      iss: ISSUER,
      sub: `replay-e2e-admin-${config.runId}`,
      aud: CLIENT_ID,
      azp: CLIENT_ID,
      preferred_username: `replay-e2e-admin-${config.runId}`,
      realm_access: { roles: ['admin'] },
      iat: now,
      exp: now + 3600
    },
    config.jwtSecret
  );
}

function signHs256(payload, secret) {
  const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' });
  const body = encodeJwtPart(payload);
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function safeJobMessage(status) {
  const message = JSON.stringify(
    status?.error ||
      status?.result ||
      status?.progress ||
      status?.status ||
      'unknown'
  );
  return message.replace(
    /[^\s"]+@[^\s"]+@[^\s"]+@[^\s"]+/g,
    '[redacted-connector]'
  );
}

function readConfig(environment) {
  const missing = REQUIRED_ENV.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`Missing Replay E2E environment: ${missing.join(', ')}`);
  }

  return {
    apiUrl: environment.REPLAY_E2E_API_URL,
    baseUrl: environment.REPLAY_E2E_BASE_URL,
    cacheDir: path.resolve(environment.REPLAY_E2E_CACHE_DIR),
    fixtureDir: path.resolve(environment.REPLAY_E2E_FIXTURE_DIR),
    jwtSecret: environment.REPLAY_E2E_JWT_SECRET,
    runId: environment.REPLAY_E2E_RUN_ID,
    stateFile: path.resolve(environment.REPLAY_E2E_STATE_FILE)
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeState(config, value) {
  await mkdir(path.dirname(config.stateFile), { recursive: true });
  await writeFile(config.stateFile, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
}
