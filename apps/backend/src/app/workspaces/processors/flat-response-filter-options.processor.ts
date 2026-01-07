import { Processor, Process } from '@nestjs/bull';
import {
  Injectable, Logger
} from '@nestjs/common';
import { Job } from 'bull';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceTestResultsService } from '../services/workspace-test-results.service';
import { FlatResponseFilterOptionsJobData } from '../interfaces/job-data.interface';

@Injectable()
@Processor('flat-response-filter-options')
export class FlatResponseFilterOptionsProcessor {
  private readonly logger = new Logger(FlatResponseFilterOptionsProcessor.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService
  ) {}

  @Process()
  async process(job: Job<FlatResponseFilterOptionsJobData>): Promise<void> {
    const workspaceId = Number(job.data.workspaceId);
    const threshold = Number(job.data.processingDurationThresholdMs || 60000);

    this.logger.log(
      `Processing flat response filter-options cache job ${job.id} for workspace ${workspaceId} (threshold=${threshold})`
    );

    await job.progress(0);

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

    await job.progress(100);
    this.logger.log(
      `Finished flat response filter-options cache job ${job.id} for workspace ${workspaceId}`
    );
  }
}
