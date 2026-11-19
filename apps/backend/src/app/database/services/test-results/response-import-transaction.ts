import { EntityManager } from 'typeorm';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

export function isRetryableImportError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error.code === '40P01' || error.code === '40001');
}

export async function completeImportWrites(writes: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(writes);
  const failures = results.filter(result => result.status === 'rejected');
  // Other writes on a shared runner can report 25P02 after the original error.
  const failure = failures.find(result => isRetryableImportError(result.reason)) ?? failures[0];
  if (failure) throw failure.reason;
}

export async function runResponseImportTransaction<T>(
  manager: EntityManager,
  work: (transaction: EntityManager, attemptIssues: TestResultsUploadIssueDto[]) => Promise<T>,
  issues?: TestResultsUploadIssueDto[]
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const attemptIssues: TestResultsUploadIssueDto[] = [];
    try {
      const result = await manager.transaction(transaction => work(transaction, attemptIssues));
      for (const issue of attemptIssues) issues?.push(issue);
      return result;
    } catch (error) {
      if (attempt >= 3 || !isRetryableImportError(error)) throw error;
    }
  }
}
