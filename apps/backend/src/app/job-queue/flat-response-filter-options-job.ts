import type { JobsOptions } from 'bullmq';
import { withQueueJobId } from './job-queue.util';

export const FLAT_RESPONSE_FILTER_OPTIONS_PURGE_JOB = 'purge-flat-response-filter-options';
export const FLAT_RESPONSE_FILTER_OPTIONS_REPAIR_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: { count: 100 }
};

export interface FlatResponseFilterOptionsJobData {
  workspaceId: number;
  generation?: string | null;
  processingDurationThresholdMs?: number;
}

export function flatResponseFilterOptionsWarmupOptions(
  workspaceId: number, threshold: number, generation: string | null
): JobsOptions {
  if (!generation) return withQueueJobId(FLAT_RESPONSE_FILTER_OPTIONS_REPAIR_OPTIONS);
  return withQueueJobId({
    jobId: `flat-response-filter-options-${workspaceId}-v${generation}-thr${threshold}`,
    removeOnFail: true,
    removeOnComplete: true
  });
}
