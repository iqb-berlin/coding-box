import { Result } from '../../../shared/services/file/import.service';

export function mergeTestCenterImportResults(base: Result | null, current: Result): Result {
  if (!base) return { ...current };
  return {
    ...current,
    success: (base.success ?? false) && (current.success ?? false),
    testFiles: (base.testFiles || 0) + (current.testFiles || 0),
    responses: (base.responses || 0) + (current.responses || 0),
    logs: (base.logs || 0) + (current.logs || 0),
    // These are workspace totals, not per-group deltas.
    booklets: current.booklets || base.booklets || 0,
    units: current.units || base.units || 0,
    persons: current.persons || base.persons || 0,
    importedGroups: [...new Set([...(base.importedGroups || []), ...(current.importedGroups || [])])],
    issues: [...(base.issues || []), ...(current.issues || [])],
    codingFreshness: current.codingFreshness || base.codingFreshness
  };
}

export function testCenterImportErrorMessage(error: unknown, fallback: string): string {
  const maybeHttpError = error as {
    error?: { message?: string } | string;
    message?: string;
    status?: number;
  };
  const detail =
    (typeof maybeHttpError?.error === 'string' && maybeHttpError.error) ||
      (typeof maybeHttpError?.error === 'object' && maybeHttpError.error?.message) ||
      maybeHttpError?.message ||
      (maybeHttpError?.status ? `HTTP ${maybeHttpError.status}` : '');

  return detail ? `${fallback} (${detail})` : fallback;
}
