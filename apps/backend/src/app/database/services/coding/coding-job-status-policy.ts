export const CODING_JOB_INITIAL_STATUSES = [
  'pending', 'active', 'paused', 'open'
] as const;

export const CODING_JOB_UPDATABLE_STATUSES = [
  ...CODING_JOB_INITIAL_STATUSES, 'completed', 'review'
] as const;

export const CODING_JOB_STATUSES = [
  ...CODING_JOB_UPDATABLE_STATUSES, 'results_applied'
] as const;

export type CodingJobStatus = typeof CODING_JOB_STATUSES[number];
export type CodingJobStatusAction = 'update' | 'restart' | 'apply' | 'invalidate-results';

// Source/reset reconciliation can reopen an applied job whose persisted results were cleared.
export const CODING_JOB_RESULTS_INVALIDATION_TRANSITION = {
  from: 'results_applied',
  to: 'completed'
} as const;

export function isInitialCodingJobStatus(status: unknown): boolean {
  return CODING_JOB_INITIAL_STATUSES.some(allowed => allowed === status);
}

export function isProtectedCodingJobStatus(status: string): boolean {
  return status === 'review' || status === 'results_applied';
}

export function canTransitionCodingJobStatus(
  currentStatus: string,
  targetStatus: string,
  action: CodingJobStatusAction = 'update'
): boolean {
  if (!CODING_JOB_STATUSES.some(status => status === currentStatus)) {
    return false;
  }

  if (action === 'invalidate-results') {
    return currentStatus === CODING_JOB_RESULTS_INVALIDATION_TRANSITION.from &&
      targetStatus === CODING_JOB_RESULTS_INVALIDATION_TRANSITION.to;
  }

  if (action === 'apply') {
    return targetStatus === 'results_applied' &&
      ['completed', 'review', 'results_applied'].includes(currentStatus);
  }

  if (action === 'restart') {
    return targetStatus === 'open' && !isProtectedCodingJobStatus(currentStatus);
  }

  if (!CODING_JOB_UPDATABLE_STATUSES.some(status => status === targetStatus)) {
    return false;
  }
  if (currentStatus === 'results_applied') return false;
  if (currentStatus === 'review') return targetStatus === 'review';
  if (currentStatus === 'completed') {
    return ['active', 'completed', 'review'].includes(targetStatus);
  }
  return targetStatus !== 'review';
}
