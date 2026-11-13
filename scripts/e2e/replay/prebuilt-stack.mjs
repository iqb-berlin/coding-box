import { stat } from 'node:fs/promises';
import path from 'node:path';

export async function prebuiltStack(repoDir, enabled, production) {
  if (enabled !== 'true') return undefined;
  if (!production) throw new Error('The prebuilt E2E stack requires the production frontend configuration.');
  const dependencyRoot = path.resolve(repoDir, process.env.REPLAY_E2E_LINUX_DEPS_DIR || '.');
  for (const [root, file] of [
    [repoDir, 'dist/apps/backend/main.mjs'],
    [repoDir, 'dist/apps/frontend/index.html'],
    [repoDir, 'dist/apps/frontend/assets/config/runtime-config.js'],
    [dependencyRoot, 'node_modules/express/package.json']
  ]) {
    const entry = await stat(path.join(root, file)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!entry?.isFile() || entry.size === 0) throw new Error(`Missing E2E build artifact: ${file}`);
  }
  return {
    overrideFile: path.join(repoDir, 'scripts/e2e/replay/docker-compose.prebuilt.yml'),
    environment: {
      REPLAY_E2E_LINUX_DEPS_DIR: dependencyRoot,
      REPLAY_E2E_RUNTIME_CONFIG_TARGET: '/usr/share/nginx/html/assets/config/runtime-config.js'
    }
  };
}
