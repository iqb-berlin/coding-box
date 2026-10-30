import {
  Inject,
  Injectable, Logger,
  Optional
} from '@nestjs/common';
import { getErrorMessage } from '../../../utils/error.util';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { WorkspaceStatsCacheService } from '../workspace/workspace-stats-cache.service';

@Injectable()
export class TestResultsCacheService {
  private readonly logger = new Logger('WorkspaceTestResultsService');

  constructor(
    @Inject(CodingValidationService)
    private readonly codingValidationService: CodingValidationService,
    private readonly workspaceStatsCacheService: WorkspaceStatsCacheService,
    @Optional()
    @Inject(CodingStatisticsService)
    private readonly codingStatisticsService?: CodingStatisticsService
  ) {}

  async invalidateWorkspaceStatsCache(workspaceId: number): Promise<boolean> {
    return this.workspaceStatsCacheService.invalidateWorkspaceStatsCache(workspaceId);
  }

  async invalidateCodingStatisticsCache(workspaceId: number): Promise<void> {
    await this.codingStatisticsService?.invalidateCache(workspaceId);
  }

  async invalidateCodingAvailabilityCache(workspaceId: number): Promise<void> {
    await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
  }

  async invalidateCachesAfterTestResultDeletion(workspaceId: number): Promise<void> {
    await Promise.all([
      this.invalidateCodingAvailabilityCache(workspaceId),
      this.invalidateWorkspaceStatsCache(workspaceId),
      this.invalidateCodingStatisticsCache(workspaceId)
    ]);
  }

  async invalidateCachesAfterPartialDeletion(workspaceId: number): Promise<void> {
    try {
      await this.invalidateCachesAfterTestResultDeletion(workspaceId);
    } catch (error) {
      this.logger.error(`Could not invalidate caches after partial deletion in workspace ${workspaceId}: ${getErrorMessage(error)}`);
    }
  }
}
