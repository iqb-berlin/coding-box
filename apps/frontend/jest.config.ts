/**
 * @jest-config-loader ts-node
 * @jest-config-loader-options {"compilerOptions":{"module":"CommonJS"}}
 */
export default {
  displayName: 'frontend',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  globals: {
    jasmine: true
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$'
      }
    ]
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@iqb/metadata-resolver|keycloak-js)'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment'
  ],
  moduleNameMapper: {
    '^keycloak-js$': '<rootDir>/src/mocks/keycloak-js.mock.ts',
    '^@iqb/metadata-resolver$': '<rootDir>/../../node_modules/@iqb/metadata-resolver/dist/index.mjs',
    '^@iqb/metadata-resolver/(.*)$': '<rootDir>/../../node_modules/@iqb/metadata-resolver/dist/$1'
  },
  coverageDirectory: '../../coverage/apps/frontend'
};
