import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import { Job } from 'bullmq';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceTestResultsService } from '../../database/services/test-results';

export interface FlatResponseFilterOptionsJobData {
  workspaceId: number;
  processingDurationThresholdMs: number;
}

@Injectable()
@Processor('flat-response-filter-options', { concurrency: 1 })
export class FlatResponseFilterOptionsProcessor extends WorkerHost {
  private readonly logger = new Logger(FlatResponseFilterOptionsProcessor.name);

  constructor(
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => WorkspaceTestResultsService))
    private readonly workspaceTestResultsService: WorkspaceTestResultsService
  ) {
    super();
  }

  async process(job: Job<FlatResponseFilterOptionsJobData>): Promise<void> {
    const workspaceId = Number(job.data.workspaceId);
    const threshold = Number(job.data.processingDurationThresholdMs || 60000);

    this.logger.log(
      `Processing flat response filter-options cache job ${job.id} for workspace ${workspaceId} (threshold=${threshold})`
    );

    await job.updateProgress(0);

    const versionKey =
      this.cacheService.generateFlatResponseFilterOptionsVersionKey(
        workspaceId
      );
    const cacheVersion = await this.cacheService.getNumber(versionKey, 1);
    const cacheKey =
      this.cacheService.generateFlatResponseFilterOptionsCacheKey(
        workspaceId,
        cacheVersion,
        threshold
      );

    const result =
      await this.workspaceTestResultsService.findFlatResponseFilterOptions(
        workspaceId,
        {
          processingDurationThresholdMs: String(threshold)
        }
      );

    await this.cacheService.set(cacheKey, result, 0);

    await job.updateProgress(100);
    this.logger.log(
      `Finished flat response filter-options cache job ${job.id} for workspace ${workspaceId}`
    );
  }
}
