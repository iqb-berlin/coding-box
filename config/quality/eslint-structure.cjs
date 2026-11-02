const baseline = require('./structure-baseline.json');
const { createPlugin, defaults, options } = require('./structure-rules.cjs');

module.exports = [
  {
    files: ['apps/backend/src/**/*.ts', 'apps/frontend/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts', '**/*.d.ts', '**/*test.factory.ts', '**/*.mock.ts'],
    plugins: { structure: createPlugin(baseline) },
    rules: {
      ...Object.fromEntries(Object.keys(defaults).map(name => [name, 'off'])),
      ...Object.fromEntries(Object.entries(options).map(([name, option]) => [`structure/${name}`, ['error', option]]))
    }
  }
];
