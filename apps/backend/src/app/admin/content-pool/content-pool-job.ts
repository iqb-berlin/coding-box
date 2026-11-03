import { Job } from 'bullmq';
import { NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { CONTENT_POOL_MAX_FILES } from './content-pool-http';
import type {
  ContentPoolImportJobProgress, ContentPoolUploadFilesJobProgress,
  ContentPoolUploadFilesResult, ImportAcpToWorkspaceInput, UploadWorkspaceFilesToAcpInput
} from './content-pool-integration.service';
import type { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';

export type ContentPoolJobData =
  ({ operation: 'import-acp' } & ImportAcpToWorkspaceInput) |
  ({ operation: 'upload-files' } & UploadWorkspaceFilesToAcpInput);

/** Reject oversized inputs before persisting them in Redis. */
export function validateContentPoolJobData(data: ContentPoolJobData): ContentPoolJobData {
  const fileCount = data.operation === 'upload-files' ? data.fileIds.length : (data.overwriteFileIds?.length ?? 0);
  if (fileCount > CONTENT_POOL_MAX_FILES || Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) {
    throw new PayloadTooLargeException('Content-Pool job is too large');
  }
  return data;
}

export type ContentPoolJobResult = TestFilesUploadResultDto | ContentPoolUploadFilesResult;
export type ContentPoolJobProgress = Omit<ContentPoolImportJobProgress | ContentPoolUploadFilesJobProgress, 'result'>;

export function initialContentPoolProgress(job: Pick<Job<ContentPoolJobData>, 'id' | 'timestamp' | 'data'>): ContentPoolJobProgress {
  return {
    jobId: String(job.id),
    status: 'pending',
    phase: 'queued',
    message: 'Content-Pool-Auftrag wird vorbereitet...',
    processedFiles: 0,
    totalFiles: job.data.operation === 'upload-files' ? job.data.fileIds.length : 0,
    progress: 0,
    createdAt: new Date(job.timestamp).toISOString(),
    updatedAt: new Date(job.timestamp).toISOString()
  };
}

export async function readContentPoolProgress(
  loadJob: () => Promise<Job<ContentPoolJobData, ContentPoolJobResult> | null>,
  operation: ContentPoolJobData['operation']
) {
  const load = async () => {
    const job = await loadJob();
    if (!job || job.data.operation !== operation) throw new NotFoundException('Content-Pool-Auftrag wurde nicht gefunden.');
    return job;
  };
  const job = await load();
  const state = await job.getState();
  // State can advance after getJob() loaded its fields, so reload terminal results.
  const current = state === 'completed' || state === 'failed' ? await load() : job;
  const progress = current.progress && typeof current.progress === 'object' ? current.progress as ContentPoolJobProgress : initialContentPoolProgress(current);
  let status: ContentPoolJobProgress['status'] = 'pending';
  if (state === 'active') status = 'running';
  if (state === 'completed' || state === 'failed') status = state;
  return {
    ...progress,
    jobId: String(current.id),
    status,
    ...(state === 'completed' ? { phase: 'completed', progress: 100, result: current.returnvalue } : {}),
    ...(state === 'failed' ? { phase: 'failed', progress: 100, error: progress.error || current.failedReason } : {})
  };
}
