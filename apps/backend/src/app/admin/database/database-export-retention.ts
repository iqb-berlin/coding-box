import { stat, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import type { JobQueueService } from '../../job-queue/job-queue.service';

export const WORKSPACE_SQLITE_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function removeExpiredWorkspaceDatabase(filePath: string, queues: JobQueueService): Promise<void> {
  const match = /^workspace-(\d+)-database-export-([\w-]+)-\d+\.sqlite$/.exec(basename(filePath));
  if (!match) return;
  const cutoff = Date.now() - WORKSPACE_SQLITE_RETENTION_MS;
  if ((await stat(filePath)).mtimeMs >= cutoff) return;
  const job = await queues.getWorkspaceJob(Number(match[1]), 'database-export', match[2]);
  // A long-running snapshot can pause between writes. Keep its file until the job finishes.
  if (job && (!job.finishedOn || job.finishedOn >= cutoff)) return;
  await unlink(filePath);
}
