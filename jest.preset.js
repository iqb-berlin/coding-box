const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  coverageProvider: 'v8',
  coverageReporters: ['text', 'html', 'lcov', 'json', 'clover'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60
    }
  },
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/**/*.mock.ts',
    '!src/app/**/*.module.ts',
    '!src/app/**/*.routes.ts',
    '!src/app/**/*.config.ts',
    '!src/app/models/**',
    '!src/app/core/models/**',
    '!**/node_modules/**',
    '!**/vendor/**'
  ]
};
