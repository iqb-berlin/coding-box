import {
  Inject, Injectable, Logger, Optional
} from '@nestjs/common';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { getErrorMessage } from '../../../utils/error.util';
import { CodingFileCacheService } from '../coding/coding-file-cache.service';
import { CODING_PROCESS_CACHE_INVALIDATOR } from '../coding/coding-process-cache-invalidator.token';
import type { CodingProcessCacheInvalidator } from '../coding/coding-process-cache-invalidator.token';
import { CacheService } from '../../../cache/cache.service';
import { EXCLUSION_CACHE_PREFIX } from './workspace-constants';
import { WorkspaceTestResultsService } from '../test-results/workspace-test-results.service';

@Injectable()
export class WorkspaceFileCacheService {
  private readonly logger = new Logger(WorkspaceFileCacheService.name);

  constructor(
    private readonly fileMetadata: WorkspaceFileMetadataService,
    private readonly cacheService: CacheService,
    @Inject(WorkspaceTestResultsService) private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    @Optional() private readonly codingFileCacheService?: CodingFileCacheService,
    @Optional() @Inject(CODING_PROCESS_CACHE_INVALIDATOR) private readonly codingProcessCacheInvalidator?: CodingProcessCacheInvalidator
  ) {}

  async invalidateWorkspaceFileCaches(workspaceId: number): Promise<void> {
    await Promise.all([
      this.fileMetadata.invalidateMetadataCache(workspaceId),
      this.cacheService.delete(`${EXCLUSION_CACHE_PREFIX}${workspaceId}`)
    ]);
    await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(
      workspaceId
    );
    this.codingFileCacheService?.clearCaches();
    this.codingProcessCacheInvalidator?.invalidateWorkspaceCaches(workspaceId);
    this.logger.log(
      `Invalidated workspace files caches for workspace ${workspaceId} in Redis`
    );
  }

  async invalidateResponseDeletionCaches(workspaceId: number): Promise<void> {
    try {
      await Promise.all([
        this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingStatisticsCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingAvailabilityCache(workspaceId)
      ]);
    } catch (error) {
      this.logger.error(`Could not invalidate response deletion caches for workspace ${workspaceId}: ${getErrorMessage(error)}`);
    }
  }
}
