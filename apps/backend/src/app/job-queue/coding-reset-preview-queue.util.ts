import { ConflictException } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ResetCodingScope } from '../../../../../api-dto/coding/reset-coding-preview.dto';
import { withQueueJobId } from './job-queue.util';

export interface ResetCodingPreviewJobData {
  workspaceId: number;
  scope: ResetCodingScope;
}

export interface ResetCodingVersionJobData {
  workspaceId: number;
  requestedByUserId?: number | string;
  version: 'v1' | 'v2' | 'v3';
  unitFilters?: string[];
  variableFilters?: string[];
}

export async function addCodingResetPreviewJob(queue: Queue, data: ResetCodingPreviewJobData): Promise<Job<ResetCodingPreviewJobData>> {
  // This limit also applies when several backend replicas are running.
  await queue.setGlobalConcurrency(1);
  const jobs = await queue.getJobs(['active', 'waiting', 'prioritized', 'delayed']);
  const existing = jobs.find(job => job?.data?.workspaceId === data.workspaceId);
  if (existing) {
    if (JSON.stringify(existing.data.scope) === JSON.stringify(data.scope)) return existing;
    throw new ConflictException('A reset preview is already running for this workspace. Please try again when it finishes.');
  }
  const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
  if (Object.values(counts).reduce((total, count) => total + count, 0) >= 20) {
    throw new ConflictException('Reset preview capacity is temporarily exhausted. Please try again later.');
  }
  return queue.add('coding-reset-preview', data, withQueueJobId({
    attempts: 1, removeOnComplete: { age: 300, count: 100 }, removeOnFail: { age: 300, count: 100 }
  }));
}
