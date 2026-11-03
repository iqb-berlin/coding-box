import { Result } from '../../../shared/services/file/import.service';
import { mergeTestCenterImportResults, testCenterImportErrorMessage } from './test-center-import-results';

describe('test center import results', () => {
  const base: Result = {
    success: true, testFiles: 2, responses: 4, logs: 6, booklets: 10, units: 20, persons: 30, importedGroups: ['A']
  };
  it('adds group deltas while retaining workspace totals and unique groups', () => {
    const current: Result = {
      ...base, success: false, responses: 3, booklets: 12, units: 22, persons: 32, importedGroups: ['A', 'B']
    };
    expect(mergeTestCenterImportResults(base, current)).toMatchObject({
      success: false, testFiles: 4, responses: 7, logs: 12, booklets: 12, units: 22, persons: 32, importedGroups: ['A', 'B']
    });
    expect(base.responses).toBe(4);
  });
  it('reports safe transport details and supports unknown errors', () => {
    expect(testCenterImportErrorMessage({ error: { message: 'Rejected' } }, 'Import failed')).toBe('Import failed (Rejected)');
    expect(testCenterImportErrorMessage({ status: 503 }, 'Import failed')).toBe('Import failed (HTTP 503)');
    expect(testCenterImportErrorMessage(null, 'Import failed')).toBe('Import failed');
  });
});
