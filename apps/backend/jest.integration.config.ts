/**
 * @jest-config-loader ts-node
 * @jest-config-loader-options {"compilerOptions":{"module":"CommonJS"}}
 */
import backend from './jest.config';

export default {
  ...backend,
  displayName: 'backend-integration',
  testMatch: ['<rootDir>/src/**/*.postgres.spec.ts', '<rootDir>/src/**/bullmq.integration.spec.ts'],
  collectCoverage: false,
  coverageThreshold: {},
  reporters: [
    'default',
    ['<rootDir>/../../scripts/qa/junit-reporter.cjs', {
      project: 'backend', outputFile: 'coverage/apps/backend/integration-junit.xml'
    }]
  ]
};
