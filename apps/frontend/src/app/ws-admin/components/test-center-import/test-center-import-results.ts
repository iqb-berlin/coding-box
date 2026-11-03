import { Result } from '../../../shared/services/file/import.service';

function addImportCounts(base: number | undefined, current: number | undefined): number {
  return (base || 0) + (current || 0);
}

export function mergeTestCenterImportResults(base: Result | null, current: Result): Result {
  if (!base) return { ...current };
  return {
    ...current,
    success: (base.success ?? false) && (current.success ?? false),
    testFiles: addImportCounts(base.testFiles, current.testFiles),
    responses: addImportCounts(base.responses, current.responses),
    logs: addImportCounts(base.logs, current.logs),
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
