import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceTestResultsService } from '../../database/services/test-results';

export interface FlatResponseFilterOptionsJobData {
  workspaceId: number;
  processingDurationThresholdMs: number;
}

@Injectable()
@Processor('flat-response-filter-options', { concurrency: 1 })
export class FlatResponseFilterOptionsProcessor extends WorkspaceWorkerHost {
  private readonly logger = new Logger(FlatResponseFilterOptionsProcessor.name);

  constructor(
    private readonly cacheService: CacheService,
    @Inject(WorkspaceTestResultsService)
    private readonly workspaceTestResultsService: WorkspaceTestResultsService
  ) {
    super();
  }

  async processWorkspaceJob(job: Job<FlatResponseFilterOptionsJobData>): Promise<void> {
    const workspaceId = Number(job.data.workspaceId);
    const threshold = Number(job.data.processingDurationThresholdMs || 60000);

    this.logger.log(
      `Processing flat response filter-options cache job ${job.id} for workspace ${workspaceId} (threshold=${threshold})`
    );

    await job.updateProgress(0);

    await this.cacheService.getOrComputeFlatResponseFilterOptions(workspaceId, threshold, () => (
      this.workspaceTestResultsService.findFlatResponseFilterOptions(
        workspaceId, { processingDurationThresholdMs: String(threshold) }
      )
    ));

    await job.updateProgress(100);
    this.logger.log(
      `Finished flat response filter-options cache job ${job.id} for workspace ${workspaceId}`
    );
  }
}
