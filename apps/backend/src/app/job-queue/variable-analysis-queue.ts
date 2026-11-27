import { ConflictException } from '@nestjs/common';
import { Job, JobsOptions, Queue } from 'bullmq';
import type { VariableAnalysisJobData } from './job-queue.service';
import { withQueueJobId } from './job-queue.util';

export async function enqueueVariableAnalysis(
  queue: Queue<VariableAnalysisJobData>, data: VariableAnalysisJobData, options?: JobsOptions
): Promise<Job<VariableAnalysisJobData>> {
  const conflict = () => new ConflictException(`A variable analysis job is already in progress for workspace ${data.workspaceId}`);
  // During an upgrade, outstanding jobs from the previous release have no deduplication key.
  const active = await queue.getJobs(['waiting', 'prioritized', 'active', 'delayed', 'waiting-children']);
  if (active.some(job => job?.data.workspaceId === data.workspaceId)) throw conflict();

  const opts = withQueueJobId({
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
    ...options,
    deduplication: { id: `workspace-${data.workspaceId}` }
  });
  const job = await queue.add('variable-analysis', data, opts);
  // BullMQ returns the winner's ID if a concurrent add is deduplicated.
  if (job.id !== opts.jobId) throw conflict();
  return job;
}
