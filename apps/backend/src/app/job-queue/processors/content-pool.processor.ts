import { Processor } from '@nestjs/bullmq';
import { HttpException, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { ContentPoolIntegrationService } from '../../admin/content-pool/content-pool-integration.service';
import {
  ContentPoolJobData, ContentPoolJobResult, ContentPoolJobProgress, initialContentPoolProgress
} from '../../admin/content-pool/content-pool-job';

@Injectable()
@Processor('content-pool', { concurrency: 1 })
export class ContentPoolProcessor extends WorkspaceWorkerHost {
  constructor(private readonly contentPool: ContentPoolIntegrationService) { super(); }

  async processWorkspaceJob(job: Job<ContentPoolJobData, ContentPoolJobResult>): Promise<ContentPoolJobResult> {
    let progress = initialContentPoolProgress(job);
    const update = async (change: Partial<ContentPoolJobProgress>): Promise<void> => {
      progress = { ...progress, ...change, updatedAt: new Date().toISOString() };
      await job.updateProgress(progress);
    };
    try {
      await update({ status: 'running' });
      const result = job.data.operation === 'import-acp' ?
        await this.contentPool.importAcpFilesToWorkspace(job.data, update) :
        await this.contentPool.uploadWorkspaceFilesToAcp(job.data, update);
      await update({
        status: 'completed', phase: 'completed', progress: 100, message: 'Content-Pool-Auftrag abgeschlossen.'
      });
      return result;
    } catch (error) {
      const message = error instanceof HttpException ? error.message : 'Content-Pool-Auftrag fehlgeschlagen.';
      await update({
        status: 'failed', phase: 'failed', progress: 100, message, error: message
      });
      throw new Error(message);
    }
  }
}
