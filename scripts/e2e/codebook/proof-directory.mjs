import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function prepareProofDirectory(configuredDirectory) {
  if (configuredDirectory) {
    // An explicit path is selected by the operator, like other output paths.
    await mkdir(configuredDirectory, { recursive: true });
    return configuredDirectory;
  }
  return mkdtemp(path.join(tmpdir(), 'codebook-proof-'));
}
