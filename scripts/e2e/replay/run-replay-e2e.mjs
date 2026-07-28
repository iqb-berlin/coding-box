import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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
const [apiPort, frontendPort] = await Promise.all([
  reservePort(),
  reservePort()
]);
const jwtSecret = randomBytes(48).toString('hex');
const compose = await findComposeCommand();

await mkdir(runDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });

const replayEnvironment = {
  ...process.env,
  REPLAY_E2E_API_PORT: String(apiPort),
  REPLAY_E2E_API_URL: `http://127.0.0.1:${apiPort}`,
  REPLAY_E2E_BASE_URL: `http://127.0.0.1:${frontendPort}`,
  REPLAY_E2E_CACHE_DIR: path.join(repoDir, 'cache', 'replay-player'),
  REPLAY_E2E_COMPOSE_PROJECT: projectName,
  REPLAY_E2E_FIXTURE_DIR: path.join(
    repoDir,
    'cypress',
    'fixtures',
    'replay-datasets',
    'two-person-multipage'
  ),
  REPLAY_E2E_FRONTEND_PORT: String(frontendPort),
  REPLAY_E2E_JWT_SECRET: jwtSecret,
  REPLAY_E2E_REDIS_PREFIX: `replay-e2e:${runId}`,
  REPLAY_E2E_REPO_DIR: repoDir,
  REPLAY_E2E_RUN_ID: runId,
  REPLAY_E2E_STATE_FILE: path.join(runDir, 'state.json')
};

let exitCode = 1;
try {
  await run(
    compose.command,
    [
      ...compose.prefix,
      '--project-name',
      projectName,
      '--file',
      composeFile,
      'up',
      '--detach',
      '--build',
      ...compose.waitArguments
    ],
    replayEnvironment
  );

  await waitForHttp(
    `${replayEnvironment.REPLAY_E2E_API_URL}/api/health`,
    180_000
  );
  await waitForHttp(replayEnvironment.REPLAY_E2E_BASE_URL, 180_000);

  await run(
    'npx',
    [
      'cypress',
      'run',
      '--config-file',
      'cypress.replay.config.ts',
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
    composeFile,
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
      '--file',
      composeFile,
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

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unreachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) {
        return;
      }
    } catch {
      lastStatus = 'unreachable';
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  throw new Error(`Timed out waiting for ${url} (${lastStatus}).`);
}

async function captureLogs(
  composeCommand,
  project,
  file,
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
        '--file',
        file,
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
