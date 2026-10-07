const { eslintConfig } = require('../../package.json');
const { extends: baseConfig, overrides: _overrides, ...typescriptConfig } = eslintConfig;
const featureImportPattern = '^([.][.]\\/)+(workspace|ws-admin|coding-management|coding|replay|sys-admin)(\\/|$)';
const featureImportMessage = 'Core must depend on shared contracts or app-wide services instead of features.';

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
      files: ['src/app/core/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...['TSImportType', 'ImportExpression'].map(nodeType => ({
            selector: nodeType + '[source.value=/' + featureImportPattern + '/]',
            message: featureImportMessage
          }))
        ],
        'import/no-restricted-paths': ['error', {
          basePath: __dirname,
          zones: [{
            target: './src/app/core',
            from: [
              './src/app/workspace', './src/app/ws-admin', './src/app/coding-management',
              './src/app/coding', './src/app/replay', './src/app/sys-admin'
            ],
            message: featureImportMessage
          }]
        }]
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
