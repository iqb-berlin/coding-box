import { Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { CodingResetPreviewService } from '../../database/services/coding/coding-reset-preview.service';
import { ResetCodingPreviewJobData } from '../job-queue.service';
import { ResetCodingPreviewResult } from '../../../../../../api-dto/coding/reset-coding-preview.dto';

@Injectable()
@Processor('coding-reset-preview', { concurrency: 1 })
export class CodingResetPreviewProcessor extends WorkspaceWorkerHost {
  constructor(private readonly previews: CodingResetPreviewService) { super(); }

  async processWorkspaceJob(job: Job<ResetCodingPreviewJobData>): Promise<ResetCodingPreviewResult> {
    await job.updateProgress(0);
    const result = await this.previews.preview(job.data.workspaceId, job.data.scope);
    await job.updateProgress(100);
    return result;
  }
}
