import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from './cache.service';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { WorkspaceTestResultsService } from '../database/services/workspace-test-results.service';

@Injectable()
export class ResponseCacheSchedulerService {
  private readonly logger = new Logger(ResponseCacheSchedulerService.name);

  constructor(
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => WorkspaceTestResultsService))
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async cacheAllResponses() {
    this.logger.log('Starting nightly task to cache all responses');
    const startTime = Date.now();

    try {
      // Get all workspaces with persons
      const workspaces = await this.getWorkspacesWithPersons();
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
      const personsWithUnits = await this.getPersonsWithUnits(workspaceId);
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
   * Get all workspaces that have persons
   */
  private async getWorkspacesWithPersons(): Promise<{ workspace_id: number }[]> {
    return this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.workspace_id', 'workspace_id')
      .where('person.consider = :consider', { consider: true })
      .getRawMany();
  }

  /**
   * Create a connector string for a person and booklet
   */
  private createConnector(person: Persons, bookletId: string): string {
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
   * Get all persons with their units for a workspace in a single optimized query
   */
  private async getPersonsWithUnits(workspaceId: number): Promise<(Persons & { units: Unit[] })[]> {
    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      return [];
    }

    const personIds = persons.map(person => person.id);

    const units = await this.unitRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletInfo')
      .where('booklet.personid IN (:...personIds)', { personIds })
      .getMany();

    const unitsByPersonId = new Map<number, Unit[]>();
    for (const unit of units) {
      const personId = unit.booklet.personid;
      if (!unitsByPersonId.has(personId)) {
        unitsByPersonId.set(personId, []);
      }
      unitsByPersonId.get(personId).push(unit);
    }

    // Attach units to each person
    return persons.map(person => ({
      ...person,
      units: unitsByPersonId.get(person.id) || []
    }));
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
