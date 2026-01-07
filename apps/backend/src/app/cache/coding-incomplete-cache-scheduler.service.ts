import {
  Injectable, Logger, OnModuleInit, Inject, forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CacheService } from './cache.service';
import { WorkspaceCodingService } from '../coding/services/workspace-coding.service';
import Persons from '../workspaces/entities/persons.entity';

@Injectable()
export class CodingIncompleteCacheSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CodingIncompleteCacheSchedulerService.name);

  constructor(
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => WorkspaceCodingService))
    private readonly workspaceCodingService: WorkspaceCodingService,
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>
  ) {}

  /**
   * Run on module initialization to pre-cache all CODING_INCOMPLETE variables
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Starting CODING_INCOMPLETE variables cache warmup on application startup');

    try {
      await this.cacheAllWorkspacesIncompleteVariables();
      this.logger.log('Completed CODING_INCOMPLETE variables cache warmup');
    } catch (error) {
      this.logger.error(`Error during CODING_INCOMPLETE variables cache warmup: ${error.message}`, error.stack);
      // Don't throw error to avoid crashing application startup
    }
  }

  /**
   * Daily refresh of CODING_INCOMPLETE variables cache
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async refreshAllCODINGIncompleteVariablesCache(): Promise<void> {
    this.logger.log('Starting daily refresh of CODING_INCOMPLETE variables cache');

    try {
      await this.cacheAllWorkspacesIncompleteVariables();
      this.logger.log('Completed daily refresh of CODING_INCOMPLETE variables cache');
    } catch (error) {
      this.logger.error(`Error during daily CODING_INCOMPLETE variables cache refresh: ${error.message}`, error.stack);
    }
  }

  /**
   * Cache CODING_INCOMPLETE variables for all workspaces
   */
  private async cacheAllWorkspacesIncompleteVariables(): Promise<void> {
    const startTime = Date.now();

    try {
      // Get all workspaces with persons (indicating they have data)
      const workspaces = await this.getWorkspacesWithPersons();
      this.logger.log(`Found ${workspaces.length} workspaces with test persons`);

      if (workspaces.length === 0) {
        this.logger.log('No workspaces found, skipping cache warmup');
        return;
      }

      // Log initial memory usage
      const initialMemoryUsage = this.getMemoryUsage();
      this.logger.log(`Initial memory usage: ${initialMemoryUsage}`);

      // Process workspaces sequentially to prevent memory overflow
      let processedCount = 0;
      for (const workspace of workspaces) {
        try {
          await this.cacheWorkspaceIncompleteVariables(workspace.workspace_id);
          processedCount += 1;

          // Log progress and memory usage every 10 workspaces or at memory thresholds
          if (processedCount % 10 === 0) {
            const currentMemoryUsage = this.getMemoryUsage();
            this.logger.log(`Processed ${processedCount}/${workspaces.length} workspaces. Memory usage: ${currentMemoryUsage}`);

            // If memory usage exceeds 80% of available heap, log warning
            const memUsage = process.memoryUsage();
            const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
            if (heapUsedPercent > 80) {
              this.logger.warn(`High memory usage detected: ${heapUsedPercent.toFixed(1)}% of heap used (${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB/${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB)`);
            }

            // Trigger garbage collection if available
            if (global.gc) {
              global.gc();
              const afterGcMemory = this.getMemoryUsage();
              this.logger.log(`Memory usage after GC: ${afterGcMemory}`);
            }
          }
        } catch (workspaceError) {
          this.logger.error(`Error caching workspace ${workspace.workspace_id}, continuing with others: ${workspaceError.message}`, workspaceError.stack);
          // Continue with other workspaces to avoid failing the entire cache warmup
        }
      }

      const finalMemoryUsage = this.getMemoryUsage();
      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Cached CODING_INCOMPLETE variables for all workspaces in ${duration.toFixed(2)} seconds. Final memory usage: ${finalMemoryUsage}`);
    } catch (error) {
      this.logger.error(`Error caching all workspaces' CODING_INCOMPLETE variables: ${error.message}`, error.stack);
    }
  }

  /**
   * Cache CODING_INCOMPLETE variables for a single workspace
   */
  private async cacheWorkspaceIncompleteVariables(workspaceId: number): Promise<void> {
    try {
      this.logger.debug(`Caching CODING_INCOMPLETE variables for workspace ${workspaceId}`);

      // Call the getCodingIncompleteVariables method which will fill the cache
      await this.workspaceCodingService.getCodingIncompleteVariables(workspaceId);

      this.logger.debug(`Successfully cached CODING_INCOMPLETE variables for workspace ${workspaceId}`);
    } catch (error) {
      // Handle specific memory-related errors
      if (error.message.includes('heap limit') || error.message.includes('out of memory') || error.code === 'ERR_OUT_OF_MEMORY') {
        this.logger.error(`Memory limit exceeded while caching workspace ${workspaceId}. Memory usage: ${this.getMemoryUsage()}. Error: ${error.message}`, error.stack);

        // Trigger GC if available and retry once
        if (global.gc) {
          try {
            global.gc();
            this.logger.log(`GC triggered after memory error. Retrying workspace ${workspaceId}...`);
            const afterGcMemory = this.getMemoryUsage();
            this.logger.log(`Memory usage after GC: ${afterGcMemory}`);

            // Retry once with reduced scope if possible
            await this.workspaceCodingService.getCodingIncompleteVariables(workspaceId);
            this.logger.log(`Successfully recovered and cached workspace ${workspaceId} after GC`);
            return;
          } catch (retryError) {
            this.logger.error(`Retry failed for workspace ${workspaceId} after GC: ${retryError.message}`, retryError.stack);
          }
        }

        // Continue processing other workspaces but don't stop the whole operation
        this.logger.warn(`Skipping workspace ${workspaceId} due to memory constraints. Continuing with other workspaces.`);
      } else {
        this.logger.error(`Error caching CODING_INCOMPLETE variables for workspace ${workspaceId}: ${error.message}`, error.stack);
      }
      // Don't rethrow to avoid failing other workspaces
    }
  }

  /**
   * Get all workspaces that have persons (active workspaces)
   */
  private async getWorkspacesWithPersons(): Promise<{ workspace_id: number }[]> {
    return this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.workspace_id', 'workspace_id')
      .where('person.consider = :consider', { consider: true })
      .getRawMany();
  }

  /**
   * Get formatted memory usage string
   */
  private getMemoryUsage(): string {
    const memUsage = process.memoryUsage();
    const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(1);
    const heapPercent = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1);
    const rssMB = (memUsage.rss / 1024 / 1024).toFixed(1);

    return `Heap: ${heapUsedMB}MB/${heapTotalMB}MB (${heapPercent}%), RSS: ${rssMB}MB`;
  }
}
