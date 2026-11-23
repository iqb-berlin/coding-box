import type { Job, Queue } from 'bullmq';
import type { ExportJobData } from './job-queue.service';
import { isTestDataCsvExport, jobMatchesWorkspace } from './job-queue.util';
import { getErrorMessage } from '../utils/error.util';

export async function listWorkspaceExportJobs(queue: Queue, workspaceId: number): Promise<Job<ExportJobData>[]> {
  const jobs = await queue.getJobs(['completed', 'failed', 'active', 'waiting', 'prioritized', 'delayed']);
  return jobs.filter(job => jobMatchesWorkspace(job, workspaceId));
}

export async function removeExpiredCsvExportJobs(
  queue: Queue,
  expiresBefore: number,
  warn: (message: string) => void
): Promise<void> {
  const pageSize = 100;
  let offset = 0;
  while (true) {
    const jobs = await queue.getJobs(['completed'], offset, offset + pageSize - 1, true);
    let removed = 0;
    for (const job of jobs) {
      if (!job) continue;
      if ((job.finishedOn ?? job.timestamp) >= expiresBefore) return;
      if (!job.data || !isTestDataCsvExport(job.data.exportType)) continue;
      try {
        await job.remove();
        removed += 1;
      } catch (error) {
        warn(`Could not remove expired CSV export ${job.id}: ${getErrorMessage(error)}`);
      }
    }
    if (jobs.length < pageSize) return;
    // Removing a completed job shifts the remaining jobs towards the start of the sorted set.
    offset += jobs.length - removed;
  }
}
