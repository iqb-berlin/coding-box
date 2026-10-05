/**
 * @jest-config-loader ts-node
 * @jest-config-loader-options {"compilerOptions":{"module":"CommonJS"}}
 */
import base from './jest.config';

export default {
  ...base,
  displayName: 'frontend-zoneless',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup-zoneless.ts'],
  testMatch: [
    '<rootDir>/src/app/ws-admin/components/files-validation-result/files-validation.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/test-results/test-results.component.spec.ts',
    '<rootDir>/src/app/components/home/home.component.spec.ts',
    '<rootDir>/src/app/coding/components/my-coding-jobs/my-coding-jobs.component.spec.ts',
    '<rootDir>/src/app/coding/components/coding-management-manual/coding-management-manual.component.spec.ts',
    '<rootDir>/src/app/coding/components/coding-management/coding-management.component.spec.ts',
    '<rootDir>/src/**/*.zoneless.spec.ts',
    '<rootDir>/src/app/replay/components/unit-player/unit-player.component.spec.ts',
    '<rootDir>/src/app/coding/components/code-selector/code-selector-reactivity.component.spec.ts',
    '<rootDir>/src/app/zoneless-dialog-responses.spec.ts',
    '<rootDir>/src/app/ws-admin/components/content-pool-import-dialog/content-pool-import-dialog.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/content-pool-upload-dialog/content-pool-upload-dialog.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/test-results/test-results-response-cleanup-dialog.component.spec.ts',
    '<rootDir>/src/app/coding/components/double-coded-review/double-coded-review.component.spec.ts',
    '<rootDir>/src/app/coding/components/coder-trainings-list/coder-trainings-list.component.spec.ts',
    '<rootDir>/src/app/coding-management/coding-variables-dialog/coding-variables-dialog.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/export/export.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/ws-access-rights/ws-access-rights.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/test-results/test-results-flat-table.component.spec.ts',
    '<rootDir>/src/app/ws-admin/components/variable-analysis-dialog/variable-analysis-dialog.component.spec.ts',
  ],
  coverageDirectory: '../../coverage/apps/frontend-zoneless'
};
