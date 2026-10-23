import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareAuthEnvironment } from './auth-environment.mjs';
import { startLoopbackForwarders } from './loopback-forwarders.mjs';
import { waitForHttp } from './http-readiness.mjs';
import {
  cleanupReplayWorkspaceFromState,
  redactReplayArtifactLog
} from './harness.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../../..');
const runId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const projectName = `coding-box-replay-${runId}`
  .replace(/[^a-z0-9_-]/gi, '-')
  .toLowerCase();
const runDir = path.join(repoDir, 'tmp', 'replay-e2e', runId);
const artifactDir = path.join(repoDir, 'tmp', 'replay-e2e-artifacts', runId);
const composeFile = path.join(scriptDir, 'docker-compose.replay.yml');
const workflowMode = process.argv.includes('--workflows');
const authMode = process.argv.includes('--auth') || workflowMode;
const production = process.argv.includes('--production');
const dockerConnectHost = process.env.REPLAY_E2E_CONNECT_HOST || '127.0.0.1';
const connectHost = '127.0.0.1';
const publishHost = process.env.REPLAY_E2E_PUBLISH_HOST || '127.0.0.1';
const [apiPort, frontendPort, keycloakPort, ...authDockerPorts] = await Promise.all(
  Array.from({ length: 6 }, () => reservePort())
);
const [dockerApiPort, dockerFrontendPort, dockerKeycloakPort] = authDockerPorts;
const jwtSecret = randomBytes(48).toString('hex');
const compose = await findComposeCommand();

await mkdir(runDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });

const composeFiles = ['--file', composeFile, '--file', path.join(scriptDir, 'docker-compose.auth.yml')];
const authEnvironment = await prepareAuthEnvironment(runDir, keycloakPort, frontendPort, connectHost);
const replayEnvironment = {
  ...process.env,
  ...authEnvironment,
  REPLAY_E2E_AUTH: String(authMode),
  REPLAY_E2E_CONNECT_HOST: connectHost,
  REPLAY_E2E_FRONTEND_CONFIGURATION: production ? 'production' : 'development',
  REPLAY_E2E_API_PORT: String(dockerApiPort),
  REPLAY_E2E_API_URL: `http://${connectHost}:${apiPort}`,
  REPLAY_E2E_BASE_URL: `http://${connectHost}:${frontendPort}`,
  REPLAY_E2E_PUBLISH_HOST: publishHost,
  REPLAY_E2E_CACHE_DIR: path.join(repoDir, 'cache', 'replay-player'),
  REPLAY_E2E_COMPOSE_PROJECT: projectName,
  REPLAY_E2E_FIXTURE_DIR: path.join(
    repoDir,
    'cypress',
    'fixtures',
    'replay-datasets',
    'two-person-multipage'
  ),
  REPLAY_E2E_FRONTEND_PORT: String(dockerFrontendPort),
  REPLAY_E2E_KEYCLOAK_PORT: String(dockerKeycloakPort),
  REPLAY_E2E_JWT_SECRET: jwtSecret,
  REPLAY_E2E_REDIS_PREFIX: `replay-e2e:${runId}`,
  REPLAY_E2E_REPO_DIR: repoDir,
  REPLAY_E2E_RUN_ID: runId,
  REPLAY_E2E_STATE_FILE: path.join(runDir, 'state.json')
};

let exitCode = 1;
let forwarders;
try {
  forwarders = await startLoopbackForwarders(dockerConnectHost,
    [
      { localPort: apiPort, remotePort: dockerApiPort },
      { localPort: frontendPort, remotePort: dockerFrontendPort },
      { localPort: keycloakPort, remotePort: dockerKeycloakPort }
    ]);
  process.stdout.write('[replay-e2e] Building and starting the disposable stack.\n');
  await run(
    compose.command,
    [
      ...compose.prefix,
      '--project-name',
      projectName,
      ...composeFiles,
      'up',
      '--detach',
      '--build',
      ...compose.waitArguments
    ],
    replayEnvironment
  );

  process.stdout.write('[replay-e2e] Compose startup completed.\n');
  for (const [service, url] of [
    ['Keycloak', `${authEnvironment.REPLAY_E2E_OIDC_ISSUER}/.well-known/openid-configuration`],
    ['backend', `${replayEnvironment.REPLAY_E2E_API_URL}/api/health`],
    ['frontend', replayEnvironment.REPLAY_E2E_BASE_URL]
  ]) {
    process.stdout.write(`[replay-e2e] Waiting for ${service} (180s deadline, 5s per request).\n`);
    await waitForHttp(url, 180_000);
    process.stdout.write(`[replay-e2e] ${service} is ready.\n`);
  }

  process.stdout.write('[replay-e2e] Starting Cypress.\n');
  await run(
    'npx',
    [
      'cypress',
      'run',
      '--config-file',
      workflowMode ? 'cypress.workflows.config.ts' : (authMode ? 'cypress.auth.config.ts' : 'cypress.replay.config.ts'),
      '--browser',
      'electron'
    ],
    replayEnvironment
  );
  exitCode = 0;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  await captureLogs(
    compose,
    projectName,
    composeFiles,
    replayEnvironment,
    artifactDir
  );
} finally {
  await cleanupReplayWorkspaceFromState(replayEnvironment).catch((error) => {
    process.stderr.write(
      `Replay workspace fallback cleanup failed: ${error.message}\n`
    );
    exitCode = 1;
  });

  await run(
    compose.command,
    [
      ...compose.prefix,
      '--project-name',
      projectName,
      ...composeFiles,
      'down',
      '--volumes',
      '--rmi',
      'local',
      '--remove-orphans',
      '--timeout',
      '10'
    ],
    replayEnvironment,
    true
  ).catch((error) => {
    process.stderr.write(`Replay stack cleanup failed: ${error.message}\n`);
    exitCode = 1;
  });

  await forwarders?.close().catch(error => {
    process.stderr.write(`Auth loopback forwarding cleanup failed: ${error.message}\n`);
    exitCode = 1;
  });

  if (authMode) {
    await rm(path.join(runDir, 'coding-e2e-realm.json'), { force: true });
  }

  const leftovers = await inspectComposeLeftovers(projectName);
  if (leftovers) {
    process.stderr.write(
      `Replay stack left Docker resources behind: ${leftovers}\n`
    );
    exitCode = 1;
  }
}

process.exitCode = exitCode;

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function findComposeCommand() {
  if (await canRun('docker', ['compose', 'version'])) {
    return {
      command: 'docker',
      prefix: ['compose'],
      waitArguments: ['--wait']
    };
  }
  if (await canRun('docker-compose', ['version'])) {
    return {
      command: 'docker-compose',
      prefix: [],
      waitArguments: []
    };
  }
  throw new Error('Docker Compose is required for frontend:e2e-replay-live.');
}

async function canRun(command, args) {
  try {
    await run(command, args, process.env, true);
    return true;
  } catch {
    return false;
  }
}

async function captureLogs(
  composeCommand,
  project,
  files,
  environment,
  outputDir
) {
  try {
    const output = await runCapture(
      composeCommand.command,
      [
        ...composeCommand.prefix,
        '--project-name',
        project,
        ...files,
        'logs',
        '--no-color'
      ],
      environment
    );
    await writeFile(
      path.join(outputDir, 'stack.log'),
      redactReplayArtifactLog(output)
    );
  } catch {
    // Preserve the primary test failure when log collection is unavailable.
  }

  try {
    const state = JSON.parse(
      await (
        await import('node:fs/promises')
      ).readFile(environment.REPLAY_E2E_STATE_FILE, 'utf8')
    );
    const metadata = {
      runId: environment.REPLAY_E2E_RUN_ID,
      workspaceId: state.workspaceId,
      uploadJobId: state.uploadJobId,
      uploadStatus: state.uploadStatus
    };
    await writeFile(
      path.join(outputDir, 'setup-metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`
    );
  } catch {
    // Setup may have failed before state was available.
  }
}

async function inspectComposeLeftovers(project) {
  const [containers, volumes, images] = await Promise.all([
    runCapture(
      'docker',
      [
        'ps',
        '--all',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${project}`
      ],
      process.env
    ),
    runCapture(
      'docker',
      [
        'volume',
        'ls',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${project}`
      ],
      process.env
    ),
    runCapture(
      'docker',
      [
        'image',
        'ls',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${project}`
      ],
      process.env
    )
  ]);
  return [containers.trim(), volumes.trim(), images.trim()]
    .filter(Boolean)
    .join(', ');
}

function run(command, args, environment, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      env: environment,
      stdio: quiet ? 'ignore' : 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}.`));
      }
    });
  });
}

function runCapture(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} exited with code ${code}.`));
      }
    });
  });
}
