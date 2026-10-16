import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function findComposeContainer(project, service) {
  const { stdout } = await exec('docker', [
    'ps',
    '--quiet',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', `label=com.docker.compose.service=${service}`
  ]);
  const containers = stdout.trim().split(/\s+/).filter(Boolean);
  if (containers.length !== 1) {
    throw new Error(
      `Expected one running ${service} container in Compose project ${project}, found ${containers.length}.`
    );
  }
  return containers[0];
}
