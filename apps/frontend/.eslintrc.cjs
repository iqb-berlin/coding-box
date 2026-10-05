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
        '@angular-eslint/prefer-inject': 'error',
        '@angular-eslint/component-selector': ['error', {
          type: 'element',
          prefix: 'coding-box',
          style: 'kebab-case'
        }],
        '@angular-eslint/use-lifecycle-interface': 'error'
      }
    },
    {
      files: ['src/app/shared/components/metadata-duration/metadata-duration.component.ts'],
      rules: {
        // The metadata library uses this host selector to read minutes and seconds.
        '@angular-eslint/component-selector': ['error', {
          type: 'element',
          prefix: 'iqb',
          style: 'kebab-case'
        }]
      }
    },
    {
      files: ['*.spec.ts'],
      rules: {
        // Test doubles can represent third-party components with their original selectors.
        '@angular-eslint/component-selector': 'off'
      }
    },
    {
      files: ['*.html'],
      extends: [
        'plugin:@angular-eslint/template/recommended',
        'plugin:@angular-eslint/template/accessibility'
      ],
      rules: {
        '@angular-eslint/template/prefer-class-binding': 'error'
      }
    }
  ]
};
