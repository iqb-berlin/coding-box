import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { REPLAY_RESPONSE_CACHE_SUFFIX } from '../database/services/workspace/workspace-constants';
import { getErrorMessage, getErrorStack } from '../utils/error.util';
import { CacheService } from './cache.service';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { WorkspaceTestResultsService } from '../database/services/test-results';
import {
  DEFAULT_RESPONSE_CACHE_ITEM_CONCURRENCY,
  DEFAULT_RESPONSE_CACHE_WORKSPACE_CONCURRENCY,
  RuntimeConfigService
} from '../config/runtime-config.service';

const PERSON_PAGE_SIZE = 100;
const UNIT_PAGE_SIZE = 500;
const CACHE_CHECK_BATCH_SIZE = 100;

interface ResponseCacheUnitRow {
  id: number;
  name: string;
  alias: string | null;
  login: string;
  code: string;
  group: string;
  bookletName: string;
}

interface ResponseCacheWarmupItem {
  connector: string;
  unitId: string;
  cacheKey: string;
}

@Injectable()
export class ResponseCacheSchedulerService {
  private readonly logger = new Logger(ResponseCacheSchedulerService.name);
  private readonly responseCacheVersionSuffix = REPLAY_RESPONSE_CACHE_SUFFIX;
  private cacheAllResponsesInFlight: Promise<void> | null = null;

  constructor(
    private readonly cacheService: CacheService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @Optional()
    private readonly runtimeConfig?: RuntimeConfigService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async cacheAllResponses(): Promise<void> {
    if (this.cacheAllResponsesInFlight) {
      this.logger.warn('Skipping response cache warmup because the previous run is still active');
      await this.cacheAllResponsesInFlight;
      return;
    }

    const warmup = this.runCacheAllResponses();
    this.cacheAllResponsesInFlight = warmup;
    try {
      await warmup;
    } finally {
      if (this.cacheAllResponsesInFlight === warmup) {
        this.cacheAllResponsesInFlight = null;
      }
    }
  }

  private async runCacheAllResponses(): Promise<void> {
    this.logger.log(`Starting nightly task to cache all responses (${this.getMemoryUsage()})`);
    const startTime = Date.now();

    try {
      // Get all workspaces with persons
      const workspaces = await this.getWorkspacesWithPersons();
      this.logger.log(`Found ${workspaces.length} workspaces with test persons`);

      // Process workspaces in parallel with a concurrency limit
      const concurrencyLimit =
        this.runtimeConfig?.responseCacheWorkspaceConcurrency ??
        DEFAULT_RESPONSE_CACHE_WORKSPACE_CONCURRENCY;
      const chunks = this.chunkArray(workspaces, concurrencyLimit);

      for (const workspaceChunk of chunks) {
        await Promise.all(
          workspaceChunk.map(workspace => this.processWorkspace(workspace.workspace_id))
        );
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Finished nightly caching of all responses in ${duration.toFixed(2)} seconds (${this.getMemoryUsage()})`);
    } catch (error) {
      this.logger.error(`Error in cacheAllResponses: ${getErrorMessage(error)}`, getErrorStack(error));
    }
  }

  /**
   * Process a single workspace by caching all its responses
   */
  private async processWorkspace(workspaceId: number): Promise<void> {
    try {
      this.logger.log(`Processing workspace ${workspaceId}`);
      const workspaceStartTime = Date.now();

      let afterPersonId: number | undefined;
      let personCount = 0;
      let missingKeyCount = 0;

      while (true) {
        const persons = await this.personsRepository.find({
          select: { id: true },
          where: {
            workspace_id: workspaceId,
            consider: true,
            ...(afterPersonId === undefined ? {} : { id: MoreThan(afterPersonId) })
          },
          order: { id: 'ASC' },
          take: PERSON_PAGE_SIZE
        });

        if (persons.length === 0) break;

        personCount += persons.length;
        missingKeyCount += await this.cacheUnitsForPersons(
          workspaceId,
          persons.map(person => person.id)
        );
        if (persons.length < PERSON_PAGE_SIZE) break;
        afterPersonId = persons[persons.length - 1].id;
      }

      const duration = (Date.now() - workspaceStartTime) / 1000;
      this.logger.log(
        `Finished processing workspace ${workspaceId} in ${duration.toFixed(2)} seconds ` +
        `(${personCount} persons, ${missingKeyCount} cache misses, ${this.getMemoryUsage()})`
      );
    } catch (error) {
      this.logger.error(`Error processing workspace ${workspaceId}: ${getErrorMessage(error)}`, getErrorStack(error));
    }
  }

  private async cacheUnitsForPersons(workspaceId: number, personIds: number[]): Promise<number> {
    let afterUnitId: number | undefined;
    let missingKeyCount = 0;

    while (true) {
      const query = this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletInfo')
        .select('unit.id', 'id')
        .addSelect('unit.name', 'name')
        .addSelect('unit.alias', 'alias')
        .addSelect('person.login', 'login')
        .addSelect('person.code', 'code')
        .addSelect('person.group', 'group')
        .addSelect('bookletInfo.name', 'bookletName')
        .where('booklet.personid IN (:...personIds)', { personIds })
        .andWhere('person.workspace_id = :workspaceId AND person.consider = true', { workspaceId })
        .orderBy('unit.id', 'ASC')
        .limit(UNIT_PAGE_SIZE);

      if (afterUnitId !== undefined) {
        query.andWhere('unit.id > :afterUnitId', { afterUnitId });
      }

      const units = await query.getRawMany<ResponseCacheUnitRow>();
      missingKeyCount += await this.cacheUnitPage(workspaceId, units);
      if (units.length < UNIT_PAGE_SIZE) return missingKeyCount;
      afterUnitId = units[units.length - 1].id;
    }
  }

  private async cacheUnitPage(workspaceId: number, units: ResponseCacheUnitRow[]): Promise<number> {
    const itemsByKey = new Map<string, ResponseCacheWarmupItem>();
    for (const unit of units) {
      const unitIds = [...new Set([unit.name, unit.alias].filter((id): id is string => !!id))];
      for (const connector of this.createConnectors(unit)) {
        for (const unitId of unitIds) {
          const cacheKey = `${this.cacheService.generateUnitResponseCacheKey(workspaceId, connector, unitId)}${this.responseCacheVersionSuffix}`;
          itemsByKey.set(cacheKey, { connector, unitId, cacheKey });
        }
      }
    }

    const cacheBatchSize = this.runtimeConfig?.responseCacheItemConcurrency ??
      DEFAULT_RESPONSE_CACHE_ITEM_CONCURRENCY;
    let missingKeyCount = 0;

    for (const batch of this.chunkArray([...itemsByKey.values()], CACHE_CHECK_BATCH_SIZE)) {
      const exists = await Promise.all(batch.map(item => this.cacheService.exists(item.cacheKey)));
      const missing = batch.filter((_, index) => !exists[index]);
      missingKeyCount += missing.length;

      for (const writeBatch of this.chunkArray(missing, cacheBatchSize)) {
        await Promise.all(writeBatch.map(item => this.cacheResponseWithRetry(workspaceId, item)));
      }
    }

    return missingKeyCount;
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
  private createConnectors({
    login, code, group, bookletName
  }: ResponseCacheUnitRow): string[] {
    const legacyConnector = `${login}@${code}@${bookletName}`;
    return group ? [`${login}@${code}@${group}@${bookletName}`, legacyConnector] : [legacyConnector];
  }

  /**
   * Cache a response with retry logic
   */
  private async cacheResponseWithRetry(
    workspaceId: number,
    item: ResponseCacheWarmupItem,
    retries = 2
  ): Promise<void> {
    const { connector, unitId, cacheKey } = item;
    try {
      const response = await this.workspaceTestResultsService.findUnitResponse(workspaceId, connector, unitId);
      await this.cacheService.set(cacheKey, response);
      this.logger.debug(`Cached response: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
    } catch (error) {
      this.logger.error(`Error fetching response for caching: ${getErrorMessage(error)}`, getErrorStack(error));
      if (retries > 0) {
        this.logger.warn(`Retrying cache operation for workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}. Retries left: ${retries}`);
        await new Promise(resolve => { setTimeout(resolve, 1000); }); // Wait 1 second before retry
        await this.cacheResponseWithRetry(workspaceId, item, retries - 1);
      } else {
        this.logger.error(`Failed to cache response after retries: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
        // Don't rethrow to avoid failing the entire batch
      }
    }
  }

  private getMemoryUsage(): string {
    const { heapUsed, rss } = process.memoryUsage();
    const mebibyte = 1024 * 1024;
    return `heap used ${(heapUsed / mebibyte).toFixed(1)} MiB, RSS ${(rss / mebibyte).toFixed(1)} MiB`;
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
