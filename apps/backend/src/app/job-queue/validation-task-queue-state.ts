import type { Job, Queue } from 'bullmq';
import type { ValidationTaskJobData } from './job-queue.service';

export type ValidationTaskRecovery =
  | { status: 'pending' }
  | { status: 'failed'; reason: string };

export function validationTaskJobId(taskId: number): string {
  return `validation-task-${taskId}`;
}

export async function readValidationTaskRecovery(
  queue: Queue<ValidationTaskJobData>,
  taskIds: number[]
): Promise<Map<number, ValidationTaskRecovery>> {
  const jobs = new Map<number, Job<ValidationTaskJobData>>();
  await Promise.all(taskIds.map(async taskId => {
    const job = await queue.getJob(validationTaskJobId(taskId));
    if (job?.data.taskId === taskId) jobs.set(taskId, job);
  }));

  const legacyIds = new Set(taskIds.filter(taskId => !jobs.has(taskId)));
  if (legacyIds.size) {
    const legacyJobs = await queue.getJobs(['active', 'waiting', 'prioritized', 'delayed']);
    legacyJobs.push(...await queue.getJobs(['failed'], 0, 199));
    for (const job of legacyJobs) {
      if (legacyIds.delete(job.data.taskId)) jobs.set(job.data.taskId, job);
    }
  }

  const recovery = new Map<number, ValidationTaskRecovery>();
  await Promise.all(Array.from(jobs, async ([taskId, job]) => {
    const state = await job.getState();
    if (state === 'failed') {
      recovery.set(taskId, { status: 'failed', reason: job.failedReason });
    } else if (state === 'active' && job.id) {
      // BullMQ leaves stalled jobs in the active list until its next scan.
      const redis = await queue.getBackend().client;
      if (await redis.runCommand('exists', [queue.toKey(`${job.id}:lock`)]) === 0) {
        recovery.set(taskId, { status: 'pending' });
      }
    } else if (['waiting', 'prioritized', 'delayed', 'paused'].includes(state)) {
      recovery.set(taskId, { status: 'pending' });
    }
  }));
  return recovery;
}
