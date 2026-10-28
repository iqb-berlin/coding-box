const path = require('node:path');
const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');
const importPlugin = require('eslint-plugin-import-x');
const { eslintConfig } = require('./package.json');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});
const frontendCompat = new FlatCompat({
  baseDirectory: path.join(__dirname, 'apps/frontend'),
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

// Preserve IQB's rule policy on ESLint 10. Import-X supplies the compatible
// implementation under the existing namespace, including inline rule comments.
const compatiblePlugins = config => (config.plugins?.import ?
  { ...config.plugins, import: importPlugin } : (config.plugins || {}));
module.exports = [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.nx/**'] },
  ...compat.config(eslintConfig).map(config => ({
    ...config,
    plugins: compatiblePlugins(config),
    settings: Object.fromEntries(Object.entries(config.settings || {}).map(([key, value]) => [
      key.replace(/^import\//, 'import-x/'), value
    ])),
    files: config.files || ['**/*.ts'],
    ignores: [...(config.ignores || []), 'apps/frontend/**']
  })),
  ...frontendCompat.config(require('./apps/frontend/.eslintrc.cjs')).map(config => ({
    ...config,
    plugins: compatiblePlugins(config),
    settings: Object.fromEntries(Object.entries(config.settings || {}).map(([key, value]) => [
      key.replace(/^import\//, 'import-x/'), value
    ])),
    files: (config.files || ['**/*']).map(pattern => [
      'apps/frontend/**/*.{ts,html}', ...(Array.isArray(pattern) ? pattern : [pattern])
    ])
  })),
  {
    files: ['apps/backend/**/*.ts'],
    // These checks were not enabled by the previous IQB policy. Keep the
    // backend error-handling and assignment policy outside this tooling upgrade.
    rules: { 'preserve-caught-error': 'off', 'no-useless-assignment': 'off' }
  }
];
