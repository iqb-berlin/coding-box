import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Nx ignores dist files. Hash the bytes actually served by frontend:serve-static.
export async function hashFrontendArtifact(directory) {
  const manifest = createHash('sha256');
  let root;
  try {
    root = await lstat(directory);
  } catch (error) {
    // Dev-server E2E can start before a disk build exists.
    if (error.code !== 'ENOENT') throw error;
    return manifest.update('missing frontend artifact\n').digest('hex');
  }
  if (!root.isDirectory()) throw new Error(`Expected an artifact directory: ${directory}`);

  async function visit(relativePath) {
    const entries = await readdir(join(directory, relativePath), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const content = createHash('sha256');
        for await (const chunk of createReadStream(join(directory, path))) content.update(chunk);
        manifest.update(JSON.stringify([path, content.digest('hex')]) + '\n');
      } else {
        // Do not silently cache symlinks or files outside the downloaded artifact.
        throw new Error(`Unsupported artifact entry: ${path}`);
      }
    }
  }
  await visit('');
  return manifest.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] || fileURLToPath(new URL('../../dist/apps/frontend', import.meta.url));
  console.log(await hashFrontendArtifact(directory));
}
