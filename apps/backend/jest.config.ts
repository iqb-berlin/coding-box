/**
 * @jest-config-loader ts-node
 * @jest-config-loader-options {"compilerOptions":{"module":"CommonJS"}}
 */
export default {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  globals: {},
  testEnvironment: 'node',
  // Recycle retained compiler/coverage state between suites on the CI runner.
  workerIdleMemoryLimit: '1GB',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json'
      }
    ]
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  transformIgnorePatterns: ['node_modules/(?!mathml2omml|@types/passport)'],
  coverageDirectory: '../../coverage/apps/backend',
  coverageReporters: ['text-summary', 'html', 'lcov', 'json', 'cobertura'],
  reporters: [
    'default',
    ['<rootDir>/../../scripts/qa/junit-reporter.cjs', { project: 'backend' }]
  ]
};
