const { eslintConfig } = require('../../package.json');
const { extends: baseConfig, overrides: _overrides, ...typescriptConfig } = eslintConfig;

module.exports = {
  root: true,
  overrides: [
    {
      files: ['*.ts'],
      ...typescriptConfig,
      extends: [
        baseConfig,
        'plugin:@angular-eslint/recommended',
        'plugin:@angular-eslint/template/process-inline-templates'
      ],
      rules: {
        ...typescriptConfig.rules,
        // Constructor injection remains supported; do not turn lint setup into a DI migration.
        '@angular-eslint/prefer-inject': 'off',
        '@angular-eslint/use-lifecycle-interface': 'error'
      }
    },
    {
      files: ['*.html'],
      extends: [
        'plugin:@angular-eslint/template/recommended',
        'plugin:@angular-eslint/template/accessibility'
      ]
    }
  ]
};
