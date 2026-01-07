import {
  Injectable, Logger
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { WorkspacesFacadeService } from './workspaces-facade.service';
import { PersonsWithUnits } from '../../common';

@Injectable()
export class ResponseCacheSchedulerService {
  private readonly logger = new Logger(ResponseCacheSchedulerService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    private readonly workspacesFacadeService: WorkspacesFacadeService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async cacheAllResponses() {
    this.logger.log('Starting nightly task to cache all responses');
    const startTime = Date.now();

    try {
      // Get all workspaces with persons
      const workspaces = await this.workspacesFacadeService.getAllWorkspacesWithPersons();
      this.logger.log(`Found ${workspaces.length} workspaces with test persons`);

      // Process workspaces in parallel with a concurrency limit
      const concurrencyLimit = 3; // Adjust based on system resources
      const chunks = this.chunkArray(workspaces, concurrencyLimit);

      for (const workspaceChunk of chunks) {
        await Promise.all(
          workspaceChunk.map(workspace => this.processWorkspace(workspace.workspace_id))
        );
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Finished nightly caching of all responses in ${duration.toFixed(2)} seconds`);
    } catch (error) {
      this.logger.error(`Error in cacheAllResponses: ${error.message}`, error.stack);
    }
  }

  /**
   * Process a single workspace by caching all its responses
   */
  private async processWorkspace(workspaceId: number): Promise<void> {
    try {
      this.logger.log(`Processing workspace ${workspaceId}`);
      const workspaceStartTime = Date.now();

      // Get all test persons and their units in a single query
      const personsWithUnits = await this.workspacesFacadeService.findPersonsWithUnits(workspaceId);
      this.logger.log(`Found ${personsWithUnits.length} persons in workspace ${workspaceId}`);

      // Prepare all cache items to check
      const cacheCheckItems: { workspaceId: number; connector: string; unitId: string; cacheKey: string }[] = [];

      for (const person of personsWithUnits) {
        for (const unit of person.units) {
          const connector = this.createConnector(person, unit.booklet.bookletinfo.name);
          const cacheKey = this.cacheService.generateUnitResponseCacheKey(workspaceId, connector, unit.alias);

          cacheCheckItems.push({
            workspaceId,
            connector,
            unitId: unit.alias,
            cacheKey
          });
        }
      }

      // Check which items are already in cache (in batches)
      const batchSize = 100;
      const itemsToCache: typeof cacheCheckItems = [];

      for (let i = 0; i < cacheCheckItems.length; i += batchSize) {
        const batch = cacheCheckItems.slice(i, i + batchSize);
        const cacheKeys = batch.map(item => item.cacheKey);

        // Check multiple cache keys at once if Redis supports it
        const existsResults = await Promise.all(cacheKeys.map(key => this.cacheService.exists(key)));

        for (let j = 0; j < batch.length; j++) {
          if (!existsResults[j]) {
            itemsToCache.push(batch[j]);
          }
        }
      }

      this.logger.log(`Found ${itemsToCache.length} items that need caching in workspace ${workspaceId}`);

      // Process items that need caching in smaller parallel batches
      const cacheBatchSize = 20; // Adjust based on system resources
      const cacheBatches = this.chunkArray(itemsToCache, cacheBatchSize);

      for (const batch of cacheBatches) {
        await Promise.all(
          batch.map(item => this.cacheResponseWithRetry(
            item.workspaceId,
            item.connector,
            item.unitId
          ))
        );
      }

      const duration = (Date.now() - workspaceStartTime) / 1000;
      this.logger.log(`Finished processing workspace ${workspaceId} in ${duration.toFixed(2)} seconds`);
    } catch (error) {
      this.logger.error(`Error processing workspace ${workspaceId}: ${error.message}`, error.stack);
    }
  }

  /**
   * Create a connector string for a person and booklet
   */
  private createConnector(person: PersonsWithUnits, bookletId: string): string {
    return `${person.login}@${person.code}@${bookletId}`;
  }

  /**
   * Cache a response for a specific workspace, test person, and unit
   */
  private async cacheResponse(workspaceId: number, connector: string, unitId: string): Promise<void> {
    const cacheKey = this.cacheService.generateUnitResponseCacheKey(workspaceId, connector, unitId);

    // Check if already in cache
    const exists = await this.cacheService.exists(cacheKey);
    if (exists) {
      this.logger.debug(`Response already in cache: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
      return;
    }

    // Fetch and cache the response
    try {
      const response = await this.workspaceTestResultsService.findUnitResponse(workspaceId, connector, unitId);
      await this.cacheService.set(cacheKey, response);
      this.logger.debug(`Cached response: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
    } catch (error) {
      this.logger.error(`Error fetching response for caching: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Cache a response with retry logic
   */
  private async cacheResponseWithRetry(
    workspaceId: number,
    connector: string,
    unitId: string,
    retries = 2
  ): Promise<void> {
    try {
      await this.cacheResponse(workspaceId, connector, unitId);
    } catch (error) {
      if (retries > 0) {
        this.logger.warn(`Retrying cache operation for workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}. Retries left: ${retries}`);
        await new Promise(resolve => { setTimeout(resolve, 1000); }); // Wait 1 second before retry
        await this.cacheResponseWithRetry(workspaceId, connector, unitId, retries - 1);
      } else {
        this.logger.error(`Failed to cache response after retries: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
        // Don't rethrow to avoid failing the entire batch
      }
    }
  }

  /**
   * Split an array into chunks of specified size
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
