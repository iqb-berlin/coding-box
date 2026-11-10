import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager, In, Repository, QueryRunner
} from 'typeorm';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatistics, CodingStatisticsWithJob } from '../shared';
import { requireJobId } from '../../../job-queue/job-queue.util';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import { ResponseManagementService } from '../test-results/response-management.service';
import { AutocoderSourceRevisionStaleError } from '../test-results/autocoder-source-revision-stale.error';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { CodingReadinessService } from './coding-readiness.service';
import { lockWorkspaceTestResultsMutation, unlockWorkspaceTestResultsMutation } from '../shared/workspace-test-results-lock.util';
import { lockWorkspaceFilesMutation, unlockWorkspaceFilesMutation } from '../shared/workspace-files-lock.util';
import { AutocoderBatchDataService } from './autocoder-batch-data.service';
import { AutocoderSchemeService } from './autocoder-scheme.service';
import { AutocoderResponseService } from './autocoder-response.service';
import {
  BatchCheckpoint, AutocoderBatchPlan, AutocoderPreflightContext, ProcessTestPersonsBatchOptions, UnitCodingJobMetadata
} from './coding-process.types';
import { getUnitFileId, normalizeAutoCoderRun, uniquePositiveIds } from './autocoder-response.util';

export type { AutocoderBatchPlan, AutocoderPreflightContext } from './coding-process.types';

const AUTOCODER_LOCK_TIMEOUT = '30s';

/** Coordinates coding jobs and persistence; public entry points also serve queue workers. */
@Injectable()
export class CodingProcessService {
  private readonly logger = new Logger(CodingProcessService.name);

  constructor(
    @InjectRepository(Persons) private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Unit) private readonly unitRepository: Repository<Unit>,
    @InjectRepository(ResponseEntity) private readonly responseRepository: Repository<ResponseEntity>,
    private readonly jobQueueService: JobQueueService,
    private readonly responseManagementService: ResponseManagementService,
    private readonly codingReadinessService: CodingReadinessService,
    private readonly data: AutocoderBatchDataService,
    private readonly schemes: AutocoderSchemeService,
    private readonly responses: AutocoderResponseService
  ) {}

  invalidateWorkspaceCaches(workspaceId: number): void {
    this.schemes.invalidateWorkspaceCaches(workspaceId);
  }

  async codeTestPersons(
    workspace_id: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number
  ): Promise<CodingStatisticsWithJob> {
    const resolvedAutoCoderRun = normalizeAutoCoderRun(autoCoderRun);

    if (
      !workspace_id ||
      !testPersonIdsOrGroups ||
      testPersonIdsOrGroups.trim() === ''
    ) {
      this.logger.warn(
        'Ungültige Eingabeparameter: workspace_id oder testPersonIdsOrGroups fehlen.'
      );
      return { totalResponses: 0, statusCounts: {} };
    }

    const groupsOrIds = testPersonIdsOrGroups
      .split(',')
      .filter(item => item.trim() !== '');
    if (groupsOrIds.length === 0) {
      this.logger.warn('Keine gültigen Gruppen oder Personen-IDs angegeben.');
      return { totalResponses: 0, statusCounts: {} };
    }

    const areAllNumbers = groupsOrIds.every(
      item => !Number.isNaN(Number(item))
    );

    let personIds: string[] = [];

    if (areAllNumbers) {
      personIds = groupsOrIds;
      this.logger.log(`Using provided person IDs: ${personIds.length} persons`);
    } else {
      this.logger.log(`Fetching persons for groups: ${groupsOrIds.join(', ')}`);

      try {
        const persons = await this.personsRepository.find({
          where: {
            workspace_id,
            group: In(groupsOrIds),
            consider: true
          },
          select: ['id']
        });

        personIds = persons.map(person => person.id.toString());
        this.logger.log(
          `Found ${personIds.length} persons in the specified groups`
        );

        if (personIds.length === 0) {
          this.logger.warn(
            `No persons found in groups: ${groupsOrIds.join(', ')}`
          );
          return {
            totalResponses: 0,
            statusCounts: {},
            message: `No persons found in the selected groups: ${groupsOrIds.join(
              ', '
            )}`
          };
        }
      } catch (error) {
        this.logger.error(
          `Error fetching persons for groups: ${getErrorMessage(error)}`,
          getErrorStack(error)
        );
        return {
          totalResponses: 0,
          statusCounts: {},
          message: `Error fetching persons for groups: ${getErrorMessage(error)}`
        };
      }
    }

    this.logger.log(
      `Starting job for ${personIds.length} test persons in workspace ${workspace_id}`
    );

    await this.codingReadinessService.assertAutoCodingCanProcess(
      workspace_id,
      {
        personIds,
        autoCoderRun: resolvedAutoCoderRun
      }
    );

    const bullJob = await this.jobQueueService.addTestPersonCodingJob({
      workspaceId: workspace_id,
      personIds,
      groupNames: !areAllNumbers ? groupsOrIds.join(',') : undefined,
      autoCoderRun: resolvedAutoCoderRun
    });

    this.logger.log(`Added job to Redis queue with ID ${bullJob.id}`);

    return {
      totalResponses: 0,
      statusCounts: {},
      jobId: requireJobId(bullJob),
      message: `Processing ${personIds.length} test persons in the background. Check job status with jobId: ${bullJob.id}`
    };
  }

  async codeUnitIds(
    workspace_id: number,
    unitIds: number[],
    autoCoderRun: number,
    metadata: UnitCodingJobMetadata = {}
  ): Promise<CodingStatisticsWithJob> {
    const resolvedAutoCoderRun = normalizeAutoCoderRun(autoCoderRun);
    const ids = uniquePositiveIds(unitIds);
    if (!workspace_id || ids.length === 0) {
      this.logger.warn('Ungültige Eingabeparameter: workspace_id oder unitIds fehlen.');
      return { totalResponses: 0, statusCounts: {} };
    }

    const rows = await this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.id', 'unitId')
      .addSelect('person.id', 'personId')
      .addSelect('person.group', 'groupName')
      .where('person.workspace_id = :workspaceId', { workspaceId: workspace_id })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('unit.id = ANY(:unitIds)', { unitIds: ids })
      .getRawMany<{ unitId: number | string; personId: number | string; groupName: string | null }>();

    const includedUnitIds = uniquePositiveIds(rows.map(row => Number(row.unitId)));
    const personIds = uniquePositiveIds(rows.map(row => Number(row.personId)))
      .map(id => id.toString());
    const groupNames = Array.from(new Set(
      rows
        .map(row => row.groupName || '')
        .filter(groupName => groupName.trim() !== '')
    )).sort((a, b) => a.localeCompare(b));

    if (includedUnitIds.length === 0 || personIds.length === 0) {
      return {
        totalResponses: 0,
        statusCounts: {},
        message: 'No matching coding units found for the selected freshness scope.'
      };
    }

    await this.codingReadinessService.assertAutoCodingCanProcess(
      workspace_id,
      {
        unitIds: includedUnitIds,
        autoCoderRun: resolvedAutoCoderRun
      }
    );

    const bullJob = await this.jobQueueService.addTestPersonCodingJob({
      workspaceId: workspace_id,
      personIds,
      unitIds: includedUnitIds,
      groupNames: metadata.groupNames || groupNames.join(','),
      autoCoderRun: resolvedAutoCoderRun,
      source: metadata.source || 'manual-selection',
      freshnessVersion: metadata.freshnessVersion,
      freshnessStates: metadata.freshnessStates,
      freshnessSourceRevision: metadata.freshnessSourceRevision
    });

    this.logger.log(
      `Added unit-scoped coding job ${bullJob.id} for ${includedUnitIds.length} units and ${personIds.length} persons`
    );

    return {
      totalResponses: 0,
      statusCounts: {},
      jobId: requireJobId(bullJob),
      message: `Processing ${includedUnitIds.length} affected coding units in the background. Check job status with jobId: ${bullJob.id}`
    };
  }

  async processTestPersonsBatch(
    workspace_id: number,
    personIds: string[],
    autoCoderRun: number,
    progressCallback?: (progress: number) => void,
    jobId?: string,
    targetUnitIds?: number[],
    freshnessSourceRevision?: number
  ): Promise<CodingStatistics> {
    return this.processTestPersonsBatchInternal(
      workspace_id,
      personIds,
      autoCoderRun,
      progressCallback,
      jobId,
      targetUnitIds,
      freshnessSourceRevision
    );
  }

  async prepareAutocoderBatch(
    workspaceId: number,
    personIds: string[],
    autoCoderRun: number,
    progressCallback: ((progress: number) => void) | undefined,
    jobId: string,
    targetUnitIds: number[] | undefined,
    freshnessSourceRevision: number | undefined,
    preflightContext: AutocoderPreflightContext,
    maxCodedResponses: number = Number.MAX_SAFE_INTEGER,
    preflightManager?: EntityManager
  ): Promise<AutocoderBatchPlan | null> {
    let plan: AutocoderBatchPlan | null = null;
    await this.processTestPersonsBatchInternal(
      workspaceId,
      personIds,
      autoCoderRun,
      progressCallback,
      jobId,
      targetUnitIds,
      freshnessSourceRevision,
      {
        persist: false,
        preflightContext,
        maxCodedResponses,
        preflightManager,
        capturePlan: capturedPlan => {
          plan = capturedPlan;
        }
      }
    );
    return plan;
  }

  private async processTestPersonsBatchInternal(
    workspace_id: number,
    personIds: string[],
    autoCoderRun: number,
    progressCallback?: (progress: number) => void,
    jobId?: string,
    targetUnitIds?: number[],
    freshnessSourceRevision?: number,
    options: ProcessTestPersonsBatchOptions = {}
  ): Promise<CodingStatistics> {
    const resolvedAutoCoderRun = normalizeAutoCoderRun(autoCoderRun);
    this.schemes.cleanupCaches();

    const startTime = Date.now();
    const metrics: { [key: string]: number } = {};

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    if (progressCallback) {
      progressCallback(0);
    }

    if (jobId && (await this.isJobCancelled(jobId))) {
      this.logger.log(
        `Job ${jobId} was cancelled or paused before processing started`
      );
      return statistics;
    }

    try {
      const checkpoint: BatchCheckpoint = (progress, stage) => this.batchCheckpoint(progress, stage, jobId, progressCallback);
      const units = await this.loadBatchUnits(
        workspace_id, personIds, targetUnitIds, metrics, checkpoint, options.preflightManager
      );
      if (!units) return statistics;
      const batch = await this.loadBatchResponses(
        workspace_id, units, resolvedAutoCoderRun, metrics, checkpoint, options.preflightManager
      );
      if (!batch) return statistics;
      const {
        unitIdsArray, unitAliasesArray, unitToResponsesMap
      } = batch;
      const schemes = await this.loadBatchSchemes(
        workspace_id, units, unitAliasesArray, metrics, checkpoint, progressCallback, jobId, options.preflightManager
      );
      if (!schemes) return statistics;
      const { unitToCodingSchemeRefMap, fileIdToCodingSchemeMap } = schemes;

      // Step 11: Process and code responses - 95% progress
      const processingStart = Date.now();

      const { allCodedResponses } = await this.responses.processAndCodeResponses({
        workspaceId: workspace_id,
        units,
        unitToResponsesMap,
        unitToCodingSchemeRefMap,
        fileIdToCodingSchemeMap,
        statistics,
        autoCoderRun: resolvedAutoCoderRun,
        jobId,
        progressCallback,
        preflightContext: options.preflightContext,
        maxCodedResponses: options.maxCodedResponses,
        preflightManager: options.preflightManager,
        isJobCancelled: () => this.isJobCancelled(jobId)
      });

      metrics.processing = Date.now() - processingStart;

      // Check for cancellation or pause after step 11
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after coding responses`
        );
        return statistics;
      }

      const plan: AutocoderBatchPlan = {
        workspaceId: workspace_id,
        codedResponses: allCodedResponses,
        statistics,
        unitIds: unitIdsArray,
        autoCoderRun: resolvedAutoCoderRun,
        freshnessSourceRevision
      };
      if (options.persist === false) {
        options.capturePlan?.(plan);
        this.logger.log(
          `Autocoder preflight completed for ${personIds.length} persons without database writes`
        );
        return statistics;
      }

      return await this.persistCalculatedBatch(plan, jobId, progressCallback, metrics, startTime);
    } catch (error) {
      if (error instanceof AutocoderSourceRevisionStaleError) {
        this.logger.warn(error.message);
        throw error;
      }

      this.logger.error(
        `Error while processing test persons in batch: ${getErrorMessage(error)} \n ${getErrorStack(error)}`
      );
      throw error;
    }
  }

  private async persistCalculatedBatch(
    plan: AutocoderBatchPlan,
    jobId: string | undefined,
    progressCallback: ((progress: number) => void) | undefined,
    metrics: Record<string, number>,
    startTime: number
  ): Promise<CodingStatistics> {
    let queryRunner: QueryRunner | undefined;
    try {
      // Step 12: Update responses in database - 100% progress
      queryRunner =
        this.responseRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      const updateSuccess =
        await this.responseManagementService.updateResponsesInDatabase(
          plan.workspaceId,
          plan.codedResponses,
          queryRunner,
          jobId,
          this.isJobCancelled.bind(this),
          progressCallback,
          metrics,
          {
            unitIds: plan.unitIds,
            autoCoderRun: plan.autoCoderRun,
            markCurrentVersion: plan.autoCoderRun === 2 ? 'v3' : 'v1',
            expectedSourceRevision: plan.freshnessSourceRevision
          }
        );

      if (!updateSuccess) {
        return plan.statistics;
      }

      if (progressCallback) {
        progressCallback(100);
      }

      const totalTime = Date.now() - startTime;
      this.logger
        .log(`Performance metrics for processTestPersonsBatch (total: ${totalTime}ms):
        - Persons query: ${metrics.personsQuery}ms
        - Booklet query: ${metrics.bookletQuery}ms
        - Unit query: ${metrics.unitQuery}ms
        - Response query: ${metrics.responseQuery}ms
        - File query: ${metrics.fileQuery}ms
        - Scheme extraction: ${metrics.schemeExtract}ms
        - Scheme query: ${metrics.schemeQuery}ms
        - Scheme parsing: ${metrics.schemeParsing}ms
        - Response processing: ${metrics.processing}ms
        - Database updates: ${metrics.update || 0}ms`);

      return plan.statistics;
    } finally {
      if (queryRunner && !queryRunner.isReleased) {
        try {
          if (queryRunner.isTransactionActive) {
            await queryRunner.rollbackTransaction();
          }
        } finally {
          if (!queryRunner.isReleased) {
            await queryRunner.release();
          }
        }
      }
    }
  }

  private async batchCheckpoint(
    progress: number | undefined,
    stage: string,
    jobId?: string,
    progressCallback?: (progress: number) => void
  ): Promise<boolean> {
    if (progress !== undefined) progressCallback?.(progress);
    if (jobId && await this.isJobCancelled(jobId)) {
      this.logger.log(`Job ${jobId} was cancelled or paused ${stage}`);
      return true;
    }
    return false;
  }

  private async loadBatchUnits(
    workspace_id: number,
    personIds: string[],
    targetUnitIds: number[] | undefined,
    metrics: Record<string, number>,
    checkpoint: BatchCheckpoint,
    manager?: EntityManager
  ): Promise<Unit[] | null> {
    const personsQueryStart = Date.now();
    const persons = await this.data.fetchPersons(
      workspace_id,
      personIds,
      manager
    );
    metrics.personsQuery = Date.now() - personsQueryStart;

    if (!persons || persons.length === 0) {
      this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
      return null;
    }

    const personIdsArray = persons.map(person => person.id);

    if (await checkpoint(10, 'after getting persons')) return null;

    const bookletQueryStart = Date.now();
    const booklets = await this.data.fetchBooklets(
      personIdsArray,
      manager
    );
    metrics.bookletQuery = Date.now() - bookletQueryStart;

    if (!booklets || booklets.length === 0) {
      this.logger.log(
        'Keine Booklets für die angegebenen Personen gefunden.'
      );
      return null;
    }

    const bookletIds = booklets.map(booklet => booklet.id);

    if (await checkpoint(20, 'after getting booklets')) return null;

    const unitQueryStart = Date.now();
    const units = await this.data.fetchUnits(
      workspace_id,
      bookletIds,
      targetUnitIds,
      manager
    );
    metrics.unitQuery = Date.now() - unitQueryStart;

    if (!units || units.length === 0) {
      this.logger.log(
        'Keine Aufgaben für die angegebenen Testhefte gefunden.'
      );
      return null;
    }

    if (await checkpoint(30, 'after getting units')) return null;
    return units;
  }

  private async loadBatchResponses(
    workspace_id: number,
    units: Unit[],
    resolvedAutoCoderRun: 1 | 2,
    metrics: Record<string, number>,
    checkpoint: BatchCheckpoint,
    manager?: EntityManager
  ) {
    const unitIds = new Set<number>();
    const unitAliasesSet = new Set<string>();

    for (const unit of units) {
      unitIds.add(unit.id);
      const unitFileId = getUnitFileId(unit);
      if (unitFileId) {
        unitAliasesSet.add(unitFileId);
      }
    }

    const unitIdsArray = Array.from(unitIds);
    const unitAliasesArray = Array.from(unitAliasesSet);

    if (await checkpoint(40, 'after processing units')) return null;

    const responseQueryStart = Date.now();
    const allResponses = await this.data.fetchResponses(
      unitIdsArray,
      resolvedAutoCoderRun,
      manager
    );
    metrics.responseQuery = Date.now() - responseQueryStart;

    if (!allResponses || allResponses.length === 0) {
      this.logger.log('Keine zu kodierenden Antworten gefunden.');
      return null;
    }

    if (await checkpoint(50, 'after getting responses')) return null;

    const filteredResponses = await this.codingReadinessService.filterResponsesCodeable(
      workspace_id,
      allResponses,
      units,
      manager
    );

    this.logger.log(
      `Filtered codeable responses: ${allResponses.length} -> ${filteredResponses.length
      } (removed ${allResponses.length - filteredResponses.length
      } non-codeable responses)`
    );

    if (filteredResponses.length === 0) {
      this.logger.log('Keine kodierbaren Antworten nach Readiness-Filter gefunden.');
      return null;
    }

    if (await checkpoint(undefined, 'after filtering responses')) return null;

    const unitToResponsesMap = new Map<number, ResponseEntity[]>();
    for (const response of filteredResponses) {
      if (!unitToResponsesMap.has(response.unitid)) {
        unitToResponsesMap.set(response.unitid, []);
      }
      unitToResponsesMap.get(response.unitid)!.push(response);
    }

    if (await checkpoint(60, 'after processing responses')) return null;
    return {
      unitIdsArray, unitAliasesArray, unitToResponsesMap
    };
  }

  private async loadBatchSchemes(
    workspace_id: number,
    units: Unit[],
    unitAliasesArray: string[],
    metrics: Record<string, number>,
    checkpoint: BatchCheckpoint,
    progressCallback?: (progress: number) => void,
    jobId?: string,
    manager?: EntityManager
  ) {
    const isJobCancelled = () => this.isJobCancelled(jobId);
    const fileQueryStart = Date.now();
    const fileIdToTestFileMap = await this.schemes.getTestFilesWithCache(
      workspace_id,
      unitAliasesArray,
      manager
    );
    metrics.fileQuery = Date.now() - fileQueryStart;

    if (await checkpoint(70, 'after getting test files')) return null;

    const schemeExtractStart = Date.now();
    const {
      codingSchemeRefs,
      unitToCodingSchemeRefMap
    } =
      await this.schemes.extractCodingSchemeReferences(
        units,
        fileIdToTestFileMap,
        jobId,
        isJobCancelled
      );
    metrics.schemeExtract = Date.now() - schemeExtractStart;

    if (await checkpoint(80, 'after extracting scheme references')) return null;

    const schemeQueryStart = Date.now();
    const fileIdToCodingSchemeMap = await this.schemes.getCodingSchemeFiles(
      workspace_id,
      codingSchemeRefs,
      jobId,
      manager,
      isJobCancelled
    );
    metrics.schemeQuery = Date.now() - schemeQueryStart;
    metrics.schemeParsing = 0;

    if (progressCallback) {
      progressCallback(85);
    }

    if (await checkpoint(90, 'after parsing coding schemes')) return null;
    return { unitToCodingSchemeRefMap, fileIdToCodingSchemeMap };
  }

  createAutocoderPreflightContext(): AutocoderPreflightContext {
    return {
      codingSchemeValidations: new Map<string, Promise<void>>()
    };
  }

  prepareAutocoderPreflight(workspaceId: number): void {
    // The workspace file lock keeps the preflight input stable. Clear local
    // caches after acquiring it so the run cannot reuse an older parsed file.
    this.invalidateWorkspaceCaches(workspaceId);
  }

  async beginAutocoderPersistenceSession(
    workspaceId: number
  ): Promise<QueryRunner> {
    const queryRunner =
      this.responseRepository.manager.connection.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.query(`SET lock_timeout = '${AUTOCODER_LOCK_TIMEOUT}'`);
      await lockWorkspaceTestResultsMutation(queryRunner, workspaceId);
      try {
        await lockWorkspaceFilesMutation(queryRunner, workspaceId);
      } catch (error) {
        await unlockWorkspaceTestResultsMutation(queryRunner, workspaceId);
        throw error;
      }
      return queryRunner;
    } catch (error) {
      if (!queryRunner.isReleased) {
        await this.resetAutocoderLockTimeout(queryRunner);
        await queryRunner.release();
      }
      throw error;
    }
  }

  async releaseAutocoderPersistenceSession(
    queryRunner: QueryRunner,
    workspaceId: number
  ): Promise<void> {
    try {
      await unlockWorkspaceFilesMutation(queryRunner, workspaceId);
    } finally {
      try {
        await unlockWorkspaceTestResultsMutation(queryRunner, workspaceId);
      } finally {
        if (!queryRunner.isReleased) {
          await this.resetAutocoderLockTimeout(queryRunner);
          await queryRunner.release();
        }
      }
    }
  }

  private async resetAutocoderLockTimeout(
    queryRunner: QueryRunner
  ): Promise<void> {
    try {
      await queryRunner.query('RESET lock_timeout');
    } catch (error) {
      this.logger.warn(
        `Could not reset autocoder lock timeout: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async persistAutocoderBatchPlan(
    plan: AutocoderBatchPlan,
    queryRunner: QueryRunner,
    jobId?: string,
    progressCallback?: (progress: number) => void
  ): Promise<boolean> {
    const metrics: { [key: string]: number } = {};
    return this.responseManagementService.updateResponsesInDatabase(
      plan.workspaceId,
      plan.codedResponses,
      queryRunner,
      jobId,
      this.isJobCancelled.bind(this),
      progressCallback,
      metrics,
      {
        unitIds: plan.unitIds,
        autoCoderRun: plan.autoCoderRun,
        markCurrentVersion: plan.autoCoderRun === 2 ? 'v3' : 'v1',
        expectedSourceRevision: plan.freshnessSourceRevision
      },
      { managedExternally: true }
    );
  }

  private async isJobCancelled(jobId: string | number | undefined): Promise<boolean> {
    if (!jobId) return false;
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(
        jobId.toString()
      );
      if (bullJob) {
        if (bullJob.data.isPaused) {
          return true;
        }
        return false;
      }
      return false;
    } catch (error) {
      this.logger.error(
        `Error checking job cancellation or pause: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }
}
