import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { transpile } from './adapter.mjs';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(directory, '../..');
const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const scope = process.env.BACKEND_VITEST_SCOPE || 'all';
const contracts = ['tools/backend-vitest/contracts/**/*.spec.ts'];
const include = scope === 'contracts' ? contracts : scope === 'pilot' ? [...manifest.unit, ...contracts] :
  scope === 'integration' ? ['apps/backend/src/**/*.postgres.spec.ts', 'apps/backend/src/**/bullmq.integration.spec.ts', 'apps/backend/src/**/auth-rate-limit.redis.integration.spec.ts'] : ['apps/backend/src/**/*.{spec,test}.ts', ...contracts];
export default defineConfig({
  root,
  cacheDir: path.join(root, 'tmp/backend-vitest/cache'),
  esbuild: false,
  resolve: { alias: [
    { find: /^vitest$/, replacement: path.join(directory, 'node_modules/vitest/dist/index.js') },
    ...['compat', 'types', 'entities', 'controllers', 'deep-mock'].map(name => ({ find: `@backend-vitest/${name}`, replacement: path.join(directory, name + '.ts') }))
  ] },
  plugins: [{
    name: 'backend-legacy-test-compatibility', enforce: 'pre',
    transform(code, id) {
      const filename = id.split('?')[0];
      if (!filename.endsWith('.ts') || filename.includes('/node_modules/')) return;
      return transpile(code, filename);
    }
  }],
  test: {
    include, environment: 'node', globals: true, pool: 'forks', execArgv: ['--experimental-vm-modules'],
    maxWorkers: Number(process.env.BACKEND_VITEST_WORKERS || (scope === 'integration' ? 1 : 2)),
    testTimeout: 5000, hookTimeout: 5000,
    coverage: {
      provider: 'v8', reportOnFailure: true,
      reporter: ['json', 'json-summary', 'lcov', 'cobertura', 'html', 'text-summary'],
      reportsDirectory: path.join(root, 'coverage/apps/backend-vitest'),
      include: ['apps/backend/src/app/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.mock.ts', '**/*.module.ts', '**/*.routes.ts', '**/*.config.ts', '**/app/models/**', '**/app/core/models/**', '**/node_modules/**', '**/vendor/**']
    }
  }
});
