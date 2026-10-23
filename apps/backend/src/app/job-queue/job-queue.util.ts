import { randomUUID } from 'crypto';
import {
  Job, JobsOptions, UnrecoverableError, Worker
} from 'bullmq';
import { getErrorMessage, toError } from '../utils/error.util';

/** Jobs constructed before persistence need not have an ID; API/worker jobs must. */
export function requireJobId(job: { id?: string | number }): string {
  if (job.id === undefined || job.id === null || String(job.id).length === 0) {
    throw new Error('Queue job is missing its persisted ID');
  }
  return String(job.id);
}

export function numericJobProgress(job: { progress?: unknown }): number {
  return typeof job.progress === 'number' && Number.isFinite(job.progress) ? job.progress : 0;
}

/** New queue counters must not collide with old export/cache entries keyed by ID. */
export function withQueueJobId(options: JobsOptions = {}): JobsOptions {
  return { ...options, jobId: options.jobId ?? randomUUID() };
}

/** BullMQ 6 replaces discard() with an UnrecoverableError in the worker. */
export async function rethrowJobError(
  error: unknown,
  job: Job,
  worker: () => Worker
): Promise<never> {
  let data = job.data;
  try {
    const latest = await Job.fromId(worker(), requireJobId(job));
    data = latest?.data ?? data;
  } catch {
    // Keep the original error if Redis or the worker is no longer available.
  }
  if (data?.skipRetries === true || data?.isCancelled === true || data?.isPaused === true) {
    throw new UnrecoverableError(getErrorMessage(error));
  }
  throw toError(error);
}
