import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, EntityManager, In, Repository, QueryRunner
} from 'typeorm';
import { VariableCodingData, CodingScheme } from '@iqbspecs/coding-scheme';
import type { Response as AutocoderResponse } from '@iqbspecs/response/response.interface';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';

import {
  STATISTICS_IGNORED_STATUSES,
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
import { getOpenManualCodingPlaceholderCondition } from '../../utils/effective-coding-status-expression.util';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  CodedResponse,
  CodingStatistics,
  CodingStatisticsWithJob
} from '../shared';
import { ResponseManagementService } from '../test-results/response-management.service';
import { AutocoderSourceRevisionStaleError } from '../test-results/autocoder-source-revision-stale.error';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { CodingReadinessService } from './coding-readiness.service';
import {
  AutocoderOutputShadow,
  createAutocoderOutputShadows
} from './autocoder-output-shadow.util';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  lockWorkspaceTestResultsMutation,
  unlockWorkspaceTestResultsMutation
} from '../shared/workspace-test-results-lock.util';
import {
  lockWorkspaceFilesMutation,
  unlockWorkspaceFilesMutation
} from '../shared/workspace-files-lock.util';
import { RuntimeConfigService } from '../../../config/runtime-config.service';
import { applyAutocoderSchemaValidationMode } from './autocoder-schema-validation.util';

type UnitCodingJobMetadata = {
  source?: 'manual-selection' | 'coding-freshness';
  freshnessVersion?: 'v1' | 'v3';
  freshnessStates?: ('PENDING' | 'STALE')[];
  freshnessSourceRevision?: number;
  groupNames?: string;
};

type ProcessTestPersonsBatchOptions = {
  persist?: boolean;
  capturePlan?: (plan: AutocoderBatchPlan) => void;
  preflightContext?: AutocoderPreflightContext;
  maxCodedResponses?: number;
  preflightManager?: EntityManager;
};

export type AutocoderPreflightContext = {
  codingSchemeValidations: Map<string, Promise<void>>;
};

export type AutocoderBatchPlan = {
  workspaceId: number;
  codedResponses: CodedResponse[];
  statistics: CodingStatistics;
  unitIds: number[];
  autoCoderRun: 1 | 2;
  freshnessSourceRevision?: number;
};

type AutocoderPersistenceSource = {
  resultId: string;
  resultIndex: number;
  targetVariableId: string;
  unitId: number;
  unitName: string;
  codingSchemeRef?: string;
  subform: string;
  status: string;
  code: number | null;
  possibleOrigins: string[];
};

type AutocoderNamespace = {
  variableCodings: VariableCodingData[];
  inputTechnicalIdByAlias: Map<string, string>;
  outputAliasByTechnicalId: Map<string, string>;
  componentById: Map<string, AutocoderNamespaceComponent>;
  outputShadows: AutocoderOutputShadow[];
};

type AutocoderNamespaceComponent = {
  aliasOnlyIds: Set<string>;
  outputAliasIds: Set<string>;
  technicalOnlyIds: Set<string>;
};

type AutocoderInputOrigin = {
  responseId: number;
  storedVariableId: string;
  isAutocoderGenerated: boolean;
};

type CompleteDerivedTuple = {
  version: 'v1' | 'v2';
  code: number | null;
  score: number | null;
};

type CompleteDerivedTupleResolution =
  { action: 'NOT_APPLICABLE' } |
  {
    action: 'PRESERVE';
    tuple: CompleteDerivedTuple;
    reason: CompleteDerivedTuplePreservationReason;
  } |
  {
    action: 'RECALCULATE_INVALIDATED';
    recalculatedResult: AutocoderResponse;
  } |
  {
    action: 'DERIVED_VALUE_CHANGED';
    tuple: CompleteDerivedTuple;
    recalculatedResult: AutocoderResponse;
  };

type CompleteDerivedTuplePreservationReason =
  'UNCHANGED' |
  'V2_RECALCULATION_NOT_COMPLETE';

type CompleteDerivedRecalculation = {
  targetResults: Map<string, AutocoderResponse>;
  authoritativeResults: AutocoderResponse[] | null;
  independentRecalculationAvailable: boolean;
};

const CODING_COMPLETE_STATUS = statusStringToNumber('CODING_COMPLETE');
const CODING_INCOMPLETE_STATUS = statusStringToNumber('CODING_INCOMPLETE');
const DERIVE_ERROR_STATUS = statusStringToNumber('DERIVE_ERROR');
const INVALID_STATUS = statusStringToNumber('INVALID');
const UNSET_STATUS = statusStringToNumber('UNSET') as number;
const COMPARABLE_RECALCULATED_STATUSES = new Set([
  'VALUE_CHANGED',
  'NO_CODING',
  'CODING_INCOMPLETE',
  'CODING_COMPLETE'
]);
const NON_AUTHORITATIVE_V2_RECALCULATION_STATUSES = new Set([
  'DERIVE_ERROR',
  'CODING_INCOMPLETE',
  'INVALID'
]);
const AUTOCODER_LOCK_TIMEOUT = '30s';

@Injectable()
export class CodingProcessService {
  private readonly logger = new Logger(CodingProcessService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private jobQueueService: JobQueueService,
    private responseManagementService: ResponseManagementService,
    private workspaceCoreService: WorkspaceCoreService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private codingReadinessService: CodingReadinessService,
    private workspaceFilesService: WorkspaceFilesService,
    private runtimeConfigService: RuntimeConfigService
  ) { }

  private codingSchemeCache: Map<
  string,
  { scheme: CodingScheme; timestamp: number }
  > = new Map();

  private readonly SCHEME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL

  private testFileCache: Map<
  number,
  { files: Map<string, FileUpload>; timestamp: number }
  > = new Map();

  private readonly TEST_FILE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache TTL

  async codeTestPersons(
    workspace_id: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number
  ): Promise<CodingStatisticsWithJob> {
    const resolvedAutoCoderRun = this.normalizeAutoCoderRun(autoCoderRun);

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
          `Error fetching persons for groups: ${error.message}`,
          error.stack
        );
        return {
          totalResponses: 0,
          statusCounts: {},
          message: `Error fetching persons for groups: ${error.message}`
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
      jobId: bullJob.id.toString(),
      message: `Processing ${personIds.length} test persons in the background. Check job status with jobId: ${bullJob.id}`
    };
  }

  async codeUnitIds(
    workspace_id: number,
    unitIds: number[],
    autoCoderRun: number,
    metadata: UnitCodingJobMetadata = {}
  ): Promise<CodingStatisticsWithJob> {
    const resolvedAutoCoderRun = this.normalizeAutoCoderRun(autoCoderRun);
    const ids = this.uniquePositiveIds(unitIds);
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

    const includedUnitIds = this.uniquePositiveIds(rows.map(row => Number(row.unitId)));
    const personIds = this.uniquePositiveIds(rows.map(row => Number(row.personId)))
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
      jobId: bullJob.id.toString(),
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
    const resolvedAutoCoderRun = this.normalizeAutoCoderRun(autoCoderRun);
    this.cleanupCaches();

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

    let queryRunner: QueryRunner | undefined;

    try {
      // Step 1: Get persons - 10% progress
      const personsQueryStart = Date.now();
      const persons = await this.fetchPersons(
        workspace_id,
        personIds,
        options.preflightManager
      );
      metrics.personsQuery = Date.now() - personsQueryStart;

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        return statistics;
      }

      const personIdsArray = persons.map(person => person.id);

      // Report progress after step 1
      if (progressCallback) {
        progressCallback(10);
      }

      // Check for cancellation or pause after step 1
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after getting persons`
        );
        return statistics;
      }

      // Step 2: Get booklets - 20% progress
      const bookletQueryStart = Date.now();
      const booklets = await this.fetchBooklets(
        personIdsArray,
        options.preflightManager
      );
      metrics.bookletQuery = Date.now() - bookletQueryStart;

      if (!booklets || booklets.length === 0) {
        this.logger.log(
          'Keine Booklets für die angegebenen Personen gefunden.'
        );
        return statistics;
      }

      const bookletIds = booklets.map(booklet => booklet.id);

      // Report progress after step 2
      if (progressCallback) {
        progressCallback(20);
      }

      // Check for cancellation or pause after step 2
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after getting booklets`
        );
        return statistics;
      }

      // Step 3: Get units - 30% progress
      const unitQueryStart = Date.now();
      const units = await this.fetchUnits(
        workspace_id,
        bookletIds,
        targetUnitIds,
        options.preflightManager
      );
      metrics.unitQuery = Date.now() - unitQueryStart;

      if (!units || units.length === 0) {
        this.logger.log(
          'Keine Aufgaben für die angegebenen Testhefte gefunden.'
        );
        return statistics;
      }

      // Report progress after step 3
      if (progressCallback) {
        progressCallback(30);
      }

      // Check for cancellation or pause after step 3
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after getting units`
        );
        return statistics;
      }

      // Step 4: Process units and build maps - 40% progress
      const unitIds = new Set<number>();
      const unitAliasesSet = new Set<string>();

      for (const unit of units) {
        unitIds.add(unit.id);
        const unitFileId = this.getUnitFileId(unit);
        if (unitFileId) {
          unitAliasesSet.add(unitFileId);
        }
      }

      const unitIdsArray = Array.from(unitIds);
      const unitAliasesArray = Array.from(unitAliasesSet);

      // Report progress after step 4
      if (progressCallback) {
        progressCallback(40);
      }

      // Check for cancellation or pause after step 4
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after processing units`
        );
        return statistics;
      }

      // Step 5: Get responses - 50% progress
      const responseQueryStart = Date.now();
      const allResponses = await this.fetchResponses(
        unitIdsArray,
        resolvedAutoCoderRun,
        options.preflightManager
      );
      metrics.responseQuery = Date.now() - responseQueryStart;

      if (!allResponses || allResponses.length === 0) {
        this.logger.log('Keine zu kodierenden Antworten gefunden.');
        return statistics;
      }

      // Report progress after step 5
      if (progressCallback) {
        progressCallback(50);
      }

      // Check for cancellation or pause after step 5
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after getting responses`
        );
        return statistics;
      }

      // Step 6: Keep only responses that the same readiness logic considers codeable - 55% progress
      const filteredResponses = await this.codingReadinessService.filterResponsesCodeable(
        workspace_id,
        allResponses,
        units,
        options.preflightManager
      );

      this.logger.log(
        `Filtered codeable responses: ${allResponses.length} -> ${filteredResponses.length
        } (removed ${allResponses.length - filteredResponses.length
        } non-codeable responses)`
      );

      if (filteredResponses.length === 0) {
        this.logger.log('Keine kodierbaren Antworten nach Readiness-Filter gefunden.');
        return statistics;
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after filtering responses`
        );
        return statistics;
      }

      // Step 7: Process responses and build maps - 60% progress
      const unitToResponsesMap = new Map<number, ResponseEntity[]>();
      for (const response of filteredResponses) {
        if (!unitToResponsesMap.has(response.unitid)) {
          unitToResponsesMap.set(response.unitid, []);
        }
        unitToResponsesMap.get(response.unitid)!.push(response);
      }

      // Report progress after step 7
      if (progressCallback) {
        progressCallback(60);
      }

      // Check for cancellation or pause after step 7
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after processing responses`
        );
        return statistics;
      }

      // Step 8: Get test files - 70% progress
      const fileQueryStart = Date.now();
      // Use cache for test files
      const fileIdToTestFileMap = await this.getTestFilesWithCache(
        workspace_id,
        unitAliasesArray,
        options.preflightManager
      );
      metrics.fileQuery = Date.now() - fileQueryStart;

      // Report progress after step 8
      if (progressCallback) {
        progressCallback(70);
      }

      // Check for cancellation or pause after step 8
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after getting test files`
        );
        return statistics;
      }

      // Step 9: Extract coding scheme references - 80% progress
      const schemeExtractStart = Date.now();
      const {
        codingSchemeRefs,
        unitToCodingSchemeRefMap
      } =
        await this.extractCodingSchemeReferences(
          units,
          fileIdToTestFileMap,
          jobId
        );
      metrics.schemeExtract = Date.now() - schemeExtractStart;

      // Report progress after step 9
      if (progressCallback) {
        progressCallback(80);
      }

      // Check for cancellation or pause after step 9
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after extracting scheme references`
        );
        return statistics;
      }

      // Step 10: Get coding scheme files - 85% progress
      const schemeQueryStart = Date.now();
      const fileIdToCodingSchemeMap = await this.getCodingSchemeFiles(
        workspace_id,
        codingSchemeRefs,
        jobId,
        options.preflightManager
      );
      metrics.schemeQuery = Date.now() - schemeQueryStart;
      // No separate parsing step needed as it's handled by the cache helper
      metrics.schemeParsing = 0;

      // Report progress after step 10
      if (progressCallback) {
        progressCallback(85);
      }

      // Report progress after step 10
      if (progressCallback) {
        progressCallback(90);
      }

      // Check for cancellation or pause after step 10
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after parsing coding schemes`
        );
        return statistics;
      }

      // Step 11: Process and code responses - 95% progress
      const processingStart = Date.now();

      const { allCodedResponses } = await this.processAndCodeResponses(
        workspace_id,
        units,
        unitToResponsesMap,
        unitToCodingSchemeRefMap,
        fileIdToCodingSchemeMap,
        filteredResponses,
        statistics,
        resolvedAutoCoderRun,
        jobId,
        progressCallback,
        options.preflightContext,
        options.maxCodedResponses,
        options.preflightManager
      );

      metrics.processing = Date.now() - processingStart;

      // Check for cancellation or pause after step 11
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after coding responses`
        );
        return statistics;
      }

      if (options.persist === false) {
        options.capturePlan?.({
          workspaceId: workspace_id,
          codedResponses: allCodedResponses,
          statistics,
          unitIds: unitIdsArray,
          autoCoderRun: resolvedAutoCoderRun,
          freshnessSourceRevision
        });
        this.logger.log(
          `Autocoder preflight completed for ${personIds.length} persons without database writes`
        );
        return statistics;
      }

      // Step 12: Update responses in database - 100% progress
      queryRunner =
        this.responseRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      const updateSuccess =
        await this.responseManagementService.updateResponsesInDatabase(
          workspace_id,
          allCodedResponses,
          queryRunner,
          jobId,
          this.isJobCancelled.bind(this),
          progressCallback,
          metrics,
          {
            unitIds: unitIdsArray,
            autoCoderRun: resolvedAutoCoderRun,
            markCurrentVersion: resolvedAutoCoderRun === 2 ? 'v3' : 'v1',
            expectedSourceRevision: freshnessSourceRevision
          }
        );

      if (!updateSuccess) {
        return statistics;
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

      return statistics;
    } catch (error) {
      if (error instanceof AutocoderSourceRevisionStaleError) {
        this.logger.warn(error.message);
        throw error;
      }

      this.logger.error(
        `Error while processing test persons in batch: ${error.message} \n ${error.stack}`
      );
      throw error;
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

  private async fetchPersons(
    workspaceId: number,
    personIds: string[],
    manager?: EntityManager
  ): Promise<Persons[]> {
    const repository = manager?.getRepository(Persons) || this.personsRepository;
    return repository.find({
      where: { workspace_id: workspaceId, id: In(personIds) },
      select: ['id', 'group', 'login', 'code', 'uploaded_at']
    });
  }

  private async fetchBooklets(
    personIds: number[],
    manager?: EntityManager
  ): Promise<Booklet[]> {
    const repository = manager?.getRepository(Booklet) || this.bookletRepository;
    return repository.createQueryBuilder('booklet')
      .where('booklet.personid = ANY(:personIds)', { personIds })
      .select(['booklet.id', 'booklet.personid'])
      .getMany();
  }

  private async fetchUnits(
    workspace_id: number,
    bookletIds: number[],
    unitIds?: number[],
    manager?: EntityManager
  ): Promise<Unit[]> {
    const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspace_id,
        manager
      );
    const repository = manager?.getRepository(Unit) || this.unitRepository;
    const query = repository.createQueryBuilder('unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .where('unit.bookletid = ANY(:bookletIds)', { bookletIds })
      .select(['unit.id', 'unit.bookletid', 'unit.name', 'unit.alias']);

    const ids = this.uniquePositiveIds(unitIds || []);
    if (ids.length > 0) {
      query.andWhere('unit.id = ANY(:unitIds)', { unitIds: ids });
    }

    applyResolvedExclusionsToQuery(query, { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits });

    return query.getMany();
  }

  private async markEffectiveV2Placeholders(
    responses: ResponseEntity[],
    manager: EntityManager | undefined,
    repository: Repository<ResponseEntity>
  ): Promise<void> {
    const candidateIds = responses
      .filter(response => (
        response.status_v2 === CODING_INCOMPLETE_STATUS &&
        response.code_v2 === null &&
        response.score_v2 === null
      ))
      .map(response => response.id);

    responses.forEach(response => {
      response.inherits_v1_for_v2 = false;
    });

    if (candidateIds.length === 0) {
      return;
    }

    const executeQuery = manager ?
      manager.query.bind(manager) :
      repository.query.bind(repository);
    const placeholderCondition = getOpenManualCodingPlaceholderCondition(
      'candidate_response'
    );
    const rows: Array<{ id: number | string }> = await executeQuery(
      `
        SELECT candidate_response.id
        FROM response candidate_response
        WHERE candidate_response.id = ANY($1::int[])
          AND ${placeholderCondition}
      `,
      [candidateIds]
    );
    const placeholderIds = new Set(rows.map(row => Number(row.id)));
    responses.forEach(response => {
      response.inherits_v1_for_v2 = placeholderIds.has(response.id);
    });
  }

  private async fetchResponses(
    unitIds: number[],
    autoCoderRun: number,
    manager?: EntityManager
  ): Promise<ResponseEntity[]> {
    const repository = manager?.getRepository(ResponseEntity) ||
      this.responseRepository;
    const query = repository
      .createQueryBuilder('ResponseEntity')
      .select([
        'ResponseEntity.id',
        'ResponseEntity.unitid',
        'ResponseEntity.variableid',
        'ResponseEntity.value',
        'ResponseEntity.status',
        'ResponseEntity.subform',
        'ResponseEntity.is_autocoder_generated',
        'ResponseEntity.autocoder_invalidated_version',
        'ResponseEntity.status_v1',
        'ResponseEntity.code_v1',
        'ResponseEntity.score_v1',
        'ResponseEntity.status_v2',
        'ResponseEntity.code_v2',
        'ResponseEntity.score_v2',
        'ResponseEntity.status_v3',
        'ResponseEntity.code_v3',
        'ResponseEntity.score_v3'
      ])
      .where('ResponseEntity.unitid = ANY(:unitIds)', {
        unitIds
      })
      .andWhere(
        new Brackets(qb => {
          qb.where('ResponseEntity.status IN (:...statuses)', {
            statuses: [3, 2, 1]
          }).orWhere('ResponseEntity.status_v1 = :derivePending', {
            derivePending: statusStringToNumber('DERIVE_PENDING') as number
          });
        })
      );

    if (autoCoderRun === 1) {
      query.andWhere(
        '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
        { isAutocoderGenerated: false }
      );
    } else {
      query.andWhere(
        new Brackets(qb => {
          qb.where(
            '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
            { isAutocoderGenerated: false }
          ).orWhere(
            `ResponseEntity.is_autocoder_generated = :generatedWithSourceCoding
              AND (
                ResponseEntity.status_v1 IS NOT NULL
                OR ResponseEntity.status_v2 IS NOT NULL
              )`,
            { generatedWithSourceCoding: true }
          );
        })
      );
    }

    const responses = await query.getMany();
    await this.markEffectiveV2Placeholders(responses, manager, repository);
    return responses;
  }

  private async getTestFilesWithCache(
    workspace_id: number,
    unitAliasesArray: string[],
    manager?: EntityManager
  ): Promise<Map<string, FileUpload>> {
    const repository = manager?.getRepository(FileUpload) ||
      this.fileUploadRepository;
    const cacheEntry = this.testFileCache.get(workspace_id);
    const now = Date.now();

    if (
      cacheEntry &&
      now - cacheEntry.timestamp < this.TEST_FILE_CACHE_TTL_MS
    ) {
      this.logger.log(`Using cached test files for workspace ${workspace_id}`);
      const missingAliases = unitAliasesArray.filter(
        alias => !cacheEntry.files.has(alias)
      );
      if (missingAliases.length === 0) {
        return cacheEntry.files;
      }

      this.logger.log(
        `Fetching ${missingAliases.length} missing test files for workspace ${workspace_id}`
      );
      const missingFiles = await repository.find({
        where: { workspace_id, file_id: In(missingAliases) },
        select: ['file_id', 'data', 'filename']
      });

      missingFiles.forEach(file => {
        cacheEntry.files.set(file.file_id, file);
      });

      cacheEntry.timestamp = now;

      return cacheEntry.files;
    }

    this.logger.log(`Fetching all test files for workspace ${workspace_id}`);
    const testFiles = await repository.find({
      where: { workspace_id, file_id: In(unitAliasesArray) },
      select: ['file_id', 'data', 'filename']
    });

    const fileMap = new Map<string, FileUpload>();
    testFiles.forEach(file => {
      fileMap.set(file.file_id, file);
    });

    this.testFileCache.set(workspace_id, { files: fileMap, timestamp: now });
    return fileMap;
  }

  private async getCodingSchemesWithCache(
    workspaceId: number,
    codingSchemeRefs: string[],
    manager?: EntityManager
  ): Promise<Map<string, CodingScheme>> {
    const repository = manager?.getRepository(FileUpload) ||
      this.fileUploadRepository;
    const now = Date.now();
    const result = new Map<string, CodingScheme>();
    const emptyScheme = new CodingScheme({});

    const missingSchemeRefs = codingSchemeRefs.filter(ref => {
      const cacheEntry = this.codingSchemeCache.get(
        this.codingSchemeCacheKey(workspaceId, ref)
      );
      if (cacheEntry && now - cacheEntry.timestamp < this.SCHEME_CACHE_TTL_MS) {
        result.set(ref, cacheEntry.scheme);
        return false;
      }
      return true;
    });

    if (missingSchemeRefs.length === 0) {
      this.logger.log('Using all cached coding schemes');
      return result;
    }

    this.logger.log(
      `Fetching ${missingSchemeRefs.length} missing coding schemes`
    );
    const codingSchemeFiles = await repository.find({
      where: { workspace_id: workspaceId, file_id: In(missingSchemeRefs) },
      select: ['file_id', 'data', 'filename']
    });

    codingSchemeFiles.forEach(file => {
      try {
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = new CodingScheme(data);
        result.set(file.file_id, scheme);
        this.codingSchemeCache.set(
          this.codingSchemeCacheKey(workspaceId, file.file_id),
          { scheme, timestamp: now }
        );
      } catch (error) {
        this.logger.error(
          `--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`
        );
        result.set(file.file_id, emptyScheme);
      }
    });

    return result;
  }

  private normalizeAutoCoderRun(autoCoderRun: number): 1 | 2 {
    if (autoCoderRun === 1 || autoCoderRun === 2) {
      return autoCoderRun;
    }

    throw new BadRequestException('autoCoderRun must be 1 or 2');
  }

  private getUnitFileId(unit: Unit): string | null {
    const candidate = unit.alias?.trim() || unit.name?.trim() || '';
    return candidate ? candidate.toUpperCase() : null;
  }

  private codingSchemeCacheKey(workspaceId: number, fileId: string): string {
    return `${workspaceId}:${fileId}`;
  }

  invalidateWorkspaceCaches(workspaceId: number): void {
    this.testFileCache.delete(workspaceId);

    const schemeCachePrefix = `${workspaceId}:`;
    for (const key of Array.from(this.codingSchemeCache.keys())) {
      if (key.startsWith(schemeCachePrefix)) {
        this.codingSchemeCache.delete(key);
      }
    }
  }

  private cleanupCaches(): void {
    const now = Date.now();
    for (const [key, entry] of this.codingSchemeCache.entries()) {
      if (now - entry.timestamp > this.SCHEME_CACHE_TTL_MS) {
        this.codingSchemeCache.delete(key);
      }
    }
    for (const [key, entry] of this.testFileCache.entries()) {
      if (now - entry.timestamp > this.TEST_FILE_CACHE_TTL_MS) {
        this.testFileCache.delete(key);
      }
    }
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
        const state = await bullJob.getState();
        return state === 'paused';
      }
      return false;
    } catch (error) {
      this.logger.error(
        `Error checking job cancellation or pause: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  private async processAndCodeResponses(
    workspaceId: number,
    units: Unit[],
    unitToResponsesMap: Map<number | string, ResponseEntity[]>,
    unitToCodingSchemeRefMap: Map<number, string>,
    fileIdToCodingSchemeMap: Map<string, CodingScheme>,
    allResponses: ResponseEntity[],
    statistics: CodingStatistics,
    autoCoderRun: 1 | 2,
    jobId?: string,
    progressCallback?: (progress: number) => void,
    preflightContext?: AutocoderPreflightContext,
    maxCodedResponses: number = Number.MAX_SAFE_INTEGER,
    preflightManager?: EntityManager
  ): Promise<{
      allCodedResponses: CodedResponse[];
      statistics: CodingStatistics;
    }> {
    const allCodedResponses: CodedResponse[] = [];
    const persistenceSources: AutocoderPersistenceSource[] = [];
    let responseIndex = 0;
    const batchSize = 50;
    const emptyScheme = new CodingScheme({});
    const codingSchemeValidations = preflightContext?.codingSchemeValidations ||
      new Map<string, Promise<void>>();

    for (let i = 0; i < units.length; i += batchSize) {
      const unitBatch = units.slice(i, i + batchSize);

      for (const unit of unitBatch) {
        const responses = unitToResponsesMap.get(unit.id) || [];
        if (responses.length === 0) continue;

        statistics.totalResponses += responses.length;
        const codingSchemeRef = unitToCodingSchemeRefMap.get(unit.id);
        const scheme = codingSchemeRef ?
          fileIdToCodingSchemeMap.get(codingSchemeRef) || emptyScheme :
          emptyScheme;

        if (codingSchemeRef) {
          const unitFileId = this.getUnitFileId(unit);
          const validationKey = [
            codingSchemeRef,
            unitFileId || unit.id
          ].join(':');
          let validation = codingSchemeValidations.get(validationKey);
          if (!validation) {
            validation = this.validateCodingSchemeForUnit(
              workspaceId,
              codingSchemeRef,
              unitFileId,
              unit,
              scheme,
              preflightManager
            );
            codingSchemeValidations.set(validationKey, validation);
          }
          await validation;
        }

        const technicalIdFallbackByAlias =
          this.createUnambiguousTechnicalIdFallbacks(
            scheme.variableCodings || []
          );

        const inputResponses = responses.map(response => {
          let inputStatus = response.status;
          let inputCode: number | undefined;
          let inputScore: number | undefined;
          if (autoCoderRun === 2) {
            if (response.autocoder_invalidated_version) {
              inputStatus = response.status_v3 ?? UNSET_STATUS;
              inputCode = this.normalizeAutocoderNumericInput(
                response.code_v3
              );
              inputScore = this.normalizeAutocoderNumericInput(
                response.score_v3
              );
            } else {
              const isOpenV2Placeholder =
                response.status_v2 === CODING_INCOMPLETE_STATUS &&
                response.code_v2 === null &&
                response.score_v2 === null &&
                response.inherits_v1_for_v2 === true;
              const isIgnoredV2Placeholder =
                response.code_v2 === null &&
                response.score_v2 === null &&
                response.status_v2 !== null &&
                STATISTICS_IGNORED_STATUSES.includes(response.status_v2);
              const hasV2Result =
                !isOpenV2Placeholder &&
                !isIgnoredV2Placeholder && (
                  response.status_v2 !== null ||
                  response.code_v2 !== null ||
                  response.score_v2 !== null
                );
              if (hasV2Result) {
                inputStatus =
                  response.status_v2 ?? response.status_v1 ?? response.status;
                inputCode = this.normalizeAutocoderNumericInput(
                  response.code_v2
                );
                inputScore = this.normalizeAutocoderNumericInput(
                  response.score_v2
                );
              } else {
                inputStatus = response.status_v1 ?? response.status;
                inputCode = this.normalizeAutocoderNumericInput(
                  response.code_v1
                );
                inputScore = this.normalizeAutocoderNumericInput(
                  response.score_v1
                );
              }
            }

            // Older run-1 data can contain empty generated derived targets as
            // INVALID. Re-open only those untouched legacy targets so run 2
            // derives them again; imported and V2-reviewed rows stay intact.
            if (
              this.isLegacyGeneratedInvalidDerivedResponse(
                response,
                inputStatus,
                inputCode,
                inputScore,
                scheme.variableCodings || []
              )
            ) {
              inputStatus = UNSET_STATUS;
            }
          }
          let responseValue = response.value as import('@iqbspecs/response/response.interface').ResponseValueType;
          const isArrayString = /^\[.*]$/.test(response.value);
          if (isArrayString) {
            try {
              responseValue = JSON.parse(response.value);
            } catch (e) {
              // ignore
            }
          }
          return {
            id: String(response.variableid),
            value: responseValue,
            status: statusNumberToString(inputStatus) as import('@iqbspecs/response/response.interface').ResponseStatusType,
            subform: response.subform,
            code: inputCode,
            score: inputScore
          };
        });

        const codedResults = this.codeAutocoderResponses(
          inputResponses,
          scheme.variableCodings || [],
          responses.map(response => ({
            responseId: response.id,
            storedVariableId: String(response.variableid),
            isAutocoderGenerated: response.is_autocoder_generated === true
          }))
        );
        const completeDerivedRecalculation =
          this.recalculateCompleteDerivedResults(
            autoCoderRun,
            responses,
            inputResponses,
            scheme.variableCodings || []
          );
        const resultsToPersist =
          completeDerivedRecalculation.authoritativeResults || codedResults;

        if (responseIndex + resultsToPersist.length > maxCodedResponses) {
          throw new Error(
            'Auto-coding batch exceeds its remaining in-memory plan budget ' +
            `of ${maxCodedResponses} responses.`
          );
        }

        for (const codedResult of resultsToPersist) {
          const codedStatus = this.normalizeAutocoderStatus(codedResult.status);
          const codedSubform = codedResult.subform || '';
          const existingResponse = this.findExistingResponseForAutocoderResult(
            responses,
            codedResult.id,
            codedSubform,
            technicalIdFallbackByAlias
          );
          const completeTupleResolution =
            this.resolveCompleteDerivedTuple(
              autoCoderRun,
              existingResponse,
              codedResult.id,
              codedSubform,
              completeDerivedRecalculation.targetResults,
              completeDerivedRecalculation.independentRecalculationAvailable,
              scheme.variableCodings || []
            );
          let persistedStatus = codedStatus;
          let persistedCode = codedResult.code ?? null;
          let persistedScore = codedResult.score ?? null;

          if (completeTupleResolution.action === 'PRESERVE') {
            persistedStatus = 'CODING_COMPLETE';
            persistedCode = completeTupleResolution.tuple.code;
            persistedScore = completeTupleResolution.tuple.score;
          } else if (
            completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' ||
            completeTupleResolution.action === 'RECALCULATE_INVALIDATED'
          ) {
            const recalculatedResult =
              completeTupleResolution.recalculatedResult;
            persistedStatus = this.normalizeAutocoderStatus(
              recalculatedResult.status
            );
            persistedCode = recalculatedResult.code ?? null;
            persistedScore = recalculatedResult.score ?? null;
          }

          if (!statistics.statusCounts[persistedStatus]) {
            statistics.statusCounts[persistedStatus] = 0;
          }
          statistics.statusCounts[persistedStatus] += 1;

          if (
            completeTupleResolution.action === 'PRESERVE' &&
            existingResponse &&
            (
              completeTupleResolution.reason ===
                'V2_RECALCULATION_NOT_COMPLETE' ||
              codedStatus !== 'CODING_COMPLETE' ||
              persistedCode !== (codedResult.code ?? null) ||
              persistedScore !== (codedResult.score ?? null)
            )
          ) {
            const preservationReason =
              completeTupleResolution.reason ===
                'V2_RECALCULATION_NOT_COMPLETE' ?
                'because its independent recalculation did not produce a ' +
                  'complete result' :
                'because its independently recalculated derived value is ' +
                  'unchanged';
            this.logger.warn(
              `Preserving complete ${completeTupleResolution.tuple.version.toUpperCase()} ` +
              'tuple for response ' +
              `${existingResponse.id}, variable ` +
              `"${existingResponse.variableid}", ${preservationReason}.`
            );
          } else if (
            completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' &&
            existingResponse
          ) {
            this.logger.warn(
              `Not preserving complete ${completeTupleResolution.tuple.version.toUpperCase()} ` +
              'tuple for response ' +
              `${existingResponse.id}, variable ` +
              `"${existingResponse.variableid}", because the recalculated ` +
              'derived value changed.'
            );
          }

          const codedResponse: CodedResponse = {
            id: existingResponse ? existingResponse.id : -1
          };
          const hasAuthoritativeDerivedValueChange =
            completeTupleResolution.action !== 'PRESERVE' &&
            completeDerivedRecalculation.authoritativeResults !== null &&
            existingResponse?.is_autocoder_generated === true &&
            this.normalizeAutocoderValueForComparison(codedResult.value) !==
              this.normalizeAutocoderValueForComparison(
                existingResponse.value
              );

          if (existingResponse?.is_autocoder_generated) {
            codedResponse.isAutocoderGenerated = true;
            codedResponse.unitid = existingResponse.unitid;
            codedResponse.variableid = existingResponse.variableid;
            codedResponse.subform = existingResponse.subform;
            if (
              completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' ||
              completeTupleResolution.action === 'RECALCULATE_INVALIDATED' ||
              hasAuthoritativeDerivedValueChange
            ) {
              codedResponse.value = this.serializeAutocoderValue(
                completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' ||
                completeTupleResolution.action === 'RECALCULATE_INVALIDATED' ?
                  completeTupleResolution.recalculatedResult.value :
                  codedResult.value
              );
              codedResponse.status = statusStringToNumber('VALUE_CHANGED');
            }
          } else if (!existingResponse) {
            codedResponse.isNew = true;
            codedResponse.unitid = unit.id;
            codedResponse.variableid = codedResult.id;
            codedResponse.value = this.serializeAutocoderValue(
              codedResult.value
            );
            codedResponse.status = statusStringToNumber('VALUE_CHANGED');
            codedResponse.subform = codedResult.subform;
            codedResponse.isAutocoderGenerated = true;
          }

          if (autoCoderRun === 1) {
            codedResponse.autocoderInvalidatedVersion = null;
            codedResponse.code_v1 = persistedCode;
            codedResponse.status_v1 = persistedStatus;
            codedResponse.score_v1 = persistedScore;
            codedResponse.code_v2 = null;
            codedResponse.status_v2 = null;
            codedResponse.score_v2 = null;
            codedResponse.code_v3 = null;
            codedResponse.status_v3 = null;
            codedResponse.score_v3 = null;
          } else if (autoCoderRun === 2) {
            codedResponse.code_v3 = persistedCode;
            codedResponse.status_v3 = persistedStatus;
            codedResponse.score_v3 = persistedScore;
            if (
              completeTupleResolution.action === 'DERIVED_VALUE_CHANGED'
            ) {
              this.invalidateCompleteDerivedTuple(
                codedResponse,
                completeTupleResolution.tuple
              );
            } else if (
              completeTupleResolution.action === 'PRESERVE' ||
              completeTupleResolution.action === 'RECALCULATE_INVALIDATED'
            ) {
              codedResponse.autocoderInvalidatedVersion = null;
            }
          }

          allCodedResponses.push(codedResponse);
          persistenceSources.push({
            resultId: String(codedResult.id),
            resultIndex: responseIndex,
            targetVariableId: String(
              existingResponse?.variableid ?? codedResult.id
            ),
            unitId: unit.id,
            unitName: unit.name,
            codingSchemeRef,
            subform: String(codedResult.subform || ''),
            status: persistedStatus,
            code: persistedCode,
            possibleOrigins: this.describeAutocoderResultCandidates(
              String(codedResult.id),
              inputResponses,
              scheme.variableCodings || []
            )
          });
          responseIndex += 1;
        }
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during response processing`
        );
        return { allCodedResponses, statistics };
      }
    }

    this.assertUniqueAutocoderPersistenceTargets(
      allCodedResponses,
      persistenceSources
    );

    if (progressCallback) {
      progressCallback(95);
    }

    return { allCodedResponses, statistics };
  }

  private async validateCodingSchemeForUnit(
    workspaceId: number,
    codingSchemeRef: string,
    unitFileId: string | undefined,
    unit: Unit,
    scheme: CodingScheme,
    manager?: EntityManager
  ): Promise<void> {
    const baseVariables = unitFileId ?
      await this.workspaceFilesService.getVariableInfoForScheme(
        workspaceId,
        unitFileId,
        manager
      ) :
      [];
    let namespace: AutocoderNamespace;
    try {
      namespace = this.createAutocoderNamespace(
        scheme.variableCodings || []
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Autocoder rejected coding scheme "${codingSchemeRef}" ` +
        `for unit "${unit.name}" (${unit.id}): ${message}.`
      );
    }

    const validation = applyAutocoderSchemaValidationMode(
      Autocoder.CodingSchemeFactory.validate(
        baseVariables,
        namespace.variableCodings
      ),
      this.runtimeConfigService.autocoderSchemaValidationMode,
      baseVariables,
      namespace.variableCodings
    );

    if (validation.toleratedProblems.length > 0) {
      const problemCounts = validation.toleratedProblems.reduce(
        (counts, problem) => {
          counts.set(problem.type, (counts.get(problem.type) || 0) + 1);
          return counts;
        },
        new Map<string, number>()
      );
      const problemSummary = [...problemCounts.entries()]
        .map(([type, count]) => `${type}=${count}`)
        .join(', ');
      this.logger.warn(
        [
          'Autocoder schema compatibility mode tolerated',
          `${validation.toleratedProblems.length} legacy source problem(s)`,
          `for coding scheme "${codingSchemeRef}" and unit`,
          `"${unit.name}" (${unit.id}): ${problemSummary}`
        ].join(' ')
      );
    }

    const breakingProblems = validation.blockingProblems;

    if (breakingProblems.length > 0) {
      const details = breakingProblems.map(problem => {
        const outputAlias = namespace.outputAliasByTechnicalId.get(
          this.normalizeVariableId(problem.variableId)
        ) || problem.variableId;
        return `${problem.type} for variable "${outputAlias}"` +
          `${problem.code ? ` (${problem.code})` : ''}`;
      }).join(', ');
      throw new Error(
        `Autocoder rejected coding scheme "${codingSchemeRef}" ` +
        `for unit "${unit.name}" (${unit.id}): ${details}.`
      );
    }
  }

  private createUnambiguousTechnicalIdFallbacks(
    variableCodings: VariableCodingData[]
  ): Map<string, string> {
    const outputVariableIds = new Set(
      variableCodings
        .map(coding => this.normalizeVariableId(coding.alias || coding.id))
        .filter(Boolean)
    );
    const technicalIdFallbackByAlias = new Map<string, string>();

    variableCodings.forEach(coding => {
      const alias = coding.alias || coding.id;
      const technicalId = coding.id;
      if (!alias || !technicalId) {
        return;
      }

      const normalizedAlias = this.normalizeVariableId(alias);
      const normalizedTechnicalId = this.normalizeVariableId(technicalId);

      // A technical ID that is also another coding's output alias is
      // ambiguous and must never be used as a compatibility fallback.
      if (
        normalizedAlias === normalizedTechnicalId ||
        outputVariableIds.has(normalizedTechnicalId)
      ) {
        return;
      }

      technicalIdFallbackByAlias.set(normalizedAlias, technicalId);
    });

    return technicalIdFallbackByAlias;
  }

  private createAutocoderNamespace(
    variableCodings: VariableCodingData[]
  ): AutocoderNamespace {
    const outputShadows = createAutocoderOutputShadows(variableCodings);

    const shadowingDerivedIds = new Set(
      outputShadows.map(pair => (
        this.normalizeVariableId(pair.derivedTechnicalId)
      ))
    );
    const inputTechnicalIdByAlias = new Map<string, string>();
    const outputAliasByTechnicalId = new Map<string, string>();

    variableCodings.forEach(coding => {
      const technicalId = String(coding.id);
      const outputAlias = String(coding.alias || coding.id);
      outputAliasByTechnicalId.set(
        this.normalizeVariableId(technicalId),
        outputAlias
      );

      // In the supported derived-shadowing pattern, the imported alias is the
      // base variable. The derived coding owns the final output only after its
      // derivation has run.
      if (!shadowingDerivedIds.has(this.normalizeVariableId(technicalId))) {
        inputTechnicalIdByAlias.set(
          this.normalizeVariableId(outputAlias),
          technicalId
        );
      }
    });

    return {
      variableCodings: variableCodings.map(coding => ({
        ...coding,
        sourceParameters: coding.sourceType === 'SOLVER' &&
          coding.sourceParameters?.solverExpression ?
          {
            ...coding.sourceParameters,
            solverExpression: this.rewriteSolverExpressionAliases(
              coding.sourceParameters.solverExpression,
              inputTechnicalIdByAlias
            )
          } :
          coding.sourceParameters,
        // The response library otherwise merges the technical-ID and alias
        // namespaces. Internally use technical IDs only and map results back
        // to their public aliases after coding.
        alias: String(coding.id)
      })),
      inputTechnicalIdByAlias,
      outputAliasByTechnicalId,
      componentById: this.createAutocoderNamespaceComponents(variableCodings),
      outputShadows
    };
  }

  private rewriteSolverExpressionAliases(
    solverExpression: string,
    inputTechnicalIdByAlias: Map<string, string>
  ): string {
    return solverExpression.replace(/\$\{([^{}]*)}/g, (token, content) => {
      const policySeparator = content.indexOf(':');
      const sourceReference = policySeparator >= 0 ?
        content.slice(0, policySeparator) :
        content;
      const policies = policySeparator >= 0 ?
        content.slice(policySeparator) :
        '';
      const fragmentStart = sourceReference.lastIndexOf('[');
      const alias = (
        fragmentStart >= 0 ?
          sourceReference.slice(0, fragmentStart) :
          sourceReference
      ).trim();
      const fragment = fragmentStart >= 0 ?
        sourceReference.slice(fragmentStart).trim() :
        '';
      const technicalId = inputTechnicalIdByAlias.get(
        this.normalizeVariableId(alias)
      );

      return technicalId ?
        `\${${technicalId}${fragment}${policies}}` :
        token;
    });
  }

  private createAutocoderNamespaceComponents(
    variableCodings: VariableCodingData[]
  ): Map<string, AutocoderNamespaceComponent> {
    const technicalIds = new Set<string>();
    const outputAliases = new Set<string>();
    const neighbors = new Map<string, Set<string>>();
    const addNode = (id: string): void => {
      if (!neighbors.has(id)) {
        neighbors.set(id, new Set<string>());
      }
    };

    variableCodings.forEach(coding => {
      const technicalId = this.normalizeVariableId(coding.id);
      const outputAlias = this.normalizeVariableId(coding.alias || coding.id);
      technicalIds.add(technicalId);
      outputAliases.add(outputAlias);
      addNode(technicalId);
      addNode(outputAlias);
      if (technicalId !== outputAlias) {
        neighbors.get(technicalId)!.add(outputAlias);
        neighbors.get(outputAlias)!.add(technicalId);
      }
    });

    const componentById = new Map<string, AutocoderNamespaceComponent>();
    const visited = new Set<string>();
    neighbors.forEach((_unused, startId) => {
      if (visited.has(startId)) {
        return;
      }

      const componentIds = new Set<string>();
      const pending = [startId];
      while (pending.length > 0) {
        const currentId = pending.pop()!;
        if (visited.has(currentId)) {
          continue;
        }
        visited.add(currentId);
        componentIds.add(currentId);
        neighbors.get(currentId)?.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            pending.push(neighbor);
          }
        });
      }

      const component: AutocoderNamespaceComponent = {
        aliasOnlyIds: new Set(
          Array.from(componentIds).filter(
            id => outputAliases.has(id) && !technicalIds.has(id)
          )
        ),
        outputAliasIds: new Set(
          Array.from(componentIds).filter(id => outputAliases.has(id))
        ),
        technicalOnlyIds: new Set(
          Array.from(componentIds).filter(
            id => technicalIds.has(id) && !outputAliases.has(id)
          )
        )
      };
      componentIds.forEach(id => componentById.set(id, component));
    });

    return componentById;
  }

  private codeAutocoderResponses(
    responses: AutocoderResponse[],
    variableCodings: VariableCodingData[],
    inputOrigins?: AutocoderInputOrigin[]
  ): AutocoderResponse[] {
    if (inputOrigins && inputOrigins.length !== responses.length) {
      throw new Error(
        'Autocoder input provenance does not match the response count.'
      );
    }

    const namespace = this.createAutocoderNamespace(variableCodings);
    // A generated derived target in this validated shadow uses the same ID as
    // the structural variable's public alias by design. The generic alias-chain
    // proof cannot contain an alias-only ID for this two-node namespace.
    const baseNoValueShadowDerivedIds = new Set(
      namespace.outputShadows
        .filter(shadow => shadow.kind === 'BASE_NO_VALUE_DERIVED')
        .map(shadow => this.normalizeVariableId(shadow.derivedTechnicalId))
    );
    const generatedInputIdsBySubform = new Map<string, Set<string>>();
    responses.forEach((response, index) => {
      if (inputOrigins?.[index]?.isAutocoderGenerated !== true) {
        return;
      }
      const subform = String(response.subform || '');
      const inputIds =
        generatedInputIdsBySubform.get(subform) || new Set<string>();
      inputIds.add(this.normalizeVariableId(response.id));
      generatedInputIdsBySubform.set(subform, inputIds);
    });
    const describeInput = (inputIndex: number): string => {
      const origin = inputOrigins?.[inputIndex];
      const rawVariableId = origin?.storedVariableId ||
        String(responses[inputIndex].id);
      if (!origin) {
        return `input ${inputIndex + 1} (stored variable ` +
          `"${rawVariableId}")`;
      }
      const originType = origin.isAutocoderGenerated ?
        'autocoder-generated' :
        'imported';
      return `response:${origin.responseId} (stored variable ` +
        `"${rawVariableId}", ${originType})`;
    };
    const canonicalResponses = responses.map((response, index) => {
      const normalizedInputId = this.normalizeVariableId(response.id);
      const mappedTechnicalId = namespace.inputTechnicalIdByAlias.get(
        normalizedInputId
      );
      const isAmbiguousGeneratedInput =
        inputOrigins?.[index]?.isAutocoderGenerated === true &&
        mappedTechnicalId !== undefined &&
        this.normalizeVariableId(mappedTechnicalId) !== normalizedInputId &&
        namespace.outputAliasByTechnicalId.has(normalizedInputId);
      const isEmptyGeneratedPlaceholder =
        inputOrigins?.[index]?.isAutocoderGenerated === true &&
        response.status === 'UNSET' &&
        (
          response.value === '' ||
          response.value === null ||
          response.value === undefined
        ) &&
        (response.code === null || response.code === undefined) &&
        (response.score === null || response.score === undefined);

      if (
        isAmbiguousGeneratedInput &&
        !isEmptyGeneratedPlaceholder &&
        !baseNoValueShadowDerivedIds.has(normalizedInputId)
      ) {
        const subform = String(response.subform || '');
        const component = namespace.componentById.get(normalizedInputId);
        // Only rows previously produced by the Autocoder can prove how an
        // ambiguous generated ID was persisted. Imported rows may use the
        // same public aliases but provide no provenance for this row.
        const inputIds =
          generatedInputIdsBySubform.get(subform) || new Set<string>();
        const aliasEvidence = Array.from(component?.aliasOnlyIds || []).filter(
          id => inputIds.has(id)
        );
        const technicalEvidence = Array.from(
          component?.technicalOnlyIds || []
        ).filter(id => inputIds.has(id));
        const missingOutputAliases = Array.from(
          component?.outputAliasIds || []
        ).filter(id => !inputIds.has(id));
        const hasProvenAliasNamespace =
          aliasEvidence.length > 0 &&
          technicalEvidence.length === 0 &&
          missingOutputAliases.length === 0;

        if (!hasProvenAliasNamespace) {
          const formatEvidence = (ids: string[]): string => (
            ids.length > 0 ? ids.map(id => `"${id}"`).join(', ') : 'none'
          );
          throw new Error(
            'Autocoder input namespace is ambiguous for ' +
              `${describeInput(index)}, subform "${subform}": stored variable ` +
              `"${response.id}" is both the output alias for technical ` +
              `variable "${mappedTechnicalId}" and a technical variable. ` +
              'Alias encoding is not proven for this namespace component ' +
              `(alias-only evidence: ${formatEvidence(aliasEvidence)}; ` +
              'technical-only evidence: ' +
              `${formatEvidence(technicalEvidence)}; missing output aliases: ` +
              `${formatEvidence(missingOutputAliases)}).`
          );
        }
      }

      return {
        ...response,
        id: mappedTechnicalId || response.id,
        // null, empty string and undefined all mean "no subform" in the
        // database. The response library must receive one canonical form so it
        // does not create a second placeholder for the same persistence target.
        subform: response.subform || undefined
      };
    });
    const canonicalInputIndexes = new Map<string, number>();
    canonicalResponses.forEach((response, index) => {
      const subform = String(response.subform || '');
      const key = this.autocoderResultKey(response.id, subform);
      const previousIndex = canonicalInputIndexes.get(key);
      if (previousIndex !== undefined) {
        throw new Error(
          'Autocoder input namespace collision for technical variable ' +
          `"${response.id}", subform "${subform}": ` +
          `${describeInput(previousIndex)} and ${describeInput(index)}.`
        );
      }
      canonicalInputIndexes.set(key, index);
    });

    const canonicalResults = Autocoder.CodingSchemeFactory.code(
      canonicalResponses,
      namespace.variableCodings
    );
    const missingAwareResults = this.deferAllMissingSumScoreResults(
      canonicalResults,
      namespace.variableCodings
    );
    const derivedResultKeys = new Set<string>();

    namespace.outputShadows.forEach(pair => {
      missingAwareResults
        .filter(result => (
          this.normalizeVariableId(result.id) ===
            this.normalizeVariableId(pair.derivedTechnicalId)
        ))
        .forEach(result => {
          derivedResultKeys.add(this.autocoderResultKey(
            pair.baseTechnicalId,
            String(result.subform || '')
          ));
        });
    });

    return missingAwareResults
      .filter(result => !namespace.outputShadows.some(pair => (
        this.normalizeVariableId(result.id) ===
          this.normalizeVariableId(pair.baseTechnicalId) &&
        (
          pair.kind === 'BASE_NO_VALUE_DERIVED' ||
          derivedResultKeys.has(this.autocoderResultKey(
            pair.baseTechnicalId,
            String(result.subform || '')
          ))
        )
      )))
      .map(result => ({
        ...result,
        id: namespace.outputAliasByTechnicalId.get(
          this.normalizeVariableId(result.id)
        ) || result.id,
        subform: result.subform || undefined
      }));
  }

  private deferAllMissingSumScoreResults(
    results: AutocoderResponse[],
    variableCodings: VariableCodingData[]
  ): AutocoderResponse[] {
    const sumScoreCodings = variableCodings.filter(coding => (
      coding.sourceType === 'SUM_SCORE' &&
      (coding.deriveSources?.length || 0) > 0
    ));
    if (sumScoreCodings.length === 0) {
      return results;
    }

    const resultByKey = new Map(results.map(result => [
      this.autocoderResultKey(result.id, String(result.subform || '')),
      result
    ]));
    const allMissingTargetKeys = new Set<string>();

    results.forEach(result => {
      const resultId = this.normalizeVariableId(result.id);
      const coding = sumScoreCodings.find(candidate => (
        this.normalizeVariableId(candidate.id) === resultId
      ));
      if (!coding) {
        return;
      }

      const subform = String(result.subform || '');
      const sourceResults = (coding.deriveSources || []).map(sourceId => (
        resultByKey.get(this.autocoderResultKey(sourceId, subform))
      ));
      const allSourcesArePersistedMissing = sourceResults.every(source => (
        source?.status === 'CODING_COMPLETE' &&
        typeof source.code === 'number' &&
        source.code < 0
      ));
      if (allSourcesArePersistedMissing) {
        allMissingTargetKeys.add(this.autocoderResultKey(result.id, subform));
      }
    });

    // REQ-741 requires Autocoder results to stay independent of the selected
    // missing profile. Keep the derived target unresolved so the export layer
    // can aggregate the concrete missing category from its source responses.
    return results.map(result => (
      allMissingTargetKeys.has(this.autocoderResultKey(
        result.id,
        String(result.subform || '')
      )) ? {
          ...result,
          value: null,
          status: 'DERIVE_PENDING',
          code: undefined,
          score: undefined
        } : result
    ));
  }

  private findExistingResponseForAutocoderResult(
    responses: ResponseEntity[],
    codedResultId: string,
    codedSubform: string,
    technicalIdFallbackByAlias: Map<string, string>
  ): ResponseEntity | undefined {
    const normalizedResultId = this.normalizeVariableId(codedResultId);
    const hasMatchingSubform = (response: ResponseEntity) => (
      String(response.subform || '') === codedSubform
    );
    const newestResponse = (matchingResponses: ResponseEntity[]) => (
      matchingResponses.sort((a, b) => b.id - a.id)[0]
    );

    // Test-result response IDs use the variable alias. An exact alias match
    // must win even when that alias is also another variable's technical ID.
    const exactAliasMatch = responses
      .filter(response => (
        this.normalizeVariableId(response.variableid) === normalizedResultId &&
        hasMatchingSubform(response)
      ))
      .sort((a, b) => (
        Number(a.is_autocoder_generated) -
          Number(b.is_autocoder_generated) ||
        b.id - a.id
      ))[0];
    if (exactAliasMatch) {
      return exactAliasMatch;
    }

    const mappedTechnicalId = technicalIdFallbackByAlias.get(
      normalizedResultId
    );
    if (
      !mappedTechnicalId ||
      this.normalizeVariableId(mappedTechnicalId) === normalizedResultId
    ) {
      return undefined;
    }

    // Older runs may have persisted generated derived responses under the
    // technical ID. Keep that compatibility fallback strictly limited to
    // generated rows so an imported response with a colliding alias can never
    // receive another variable's result.
    return newestResponse(
      responses.filter(response => (
        response.is_autocoder_generated === true &&
        this.normalizeVariableId(response.variableid) ===
          this.normalizeVariableId(mappedTechnicalId) &&
        hasMatchingSubform(response)
      ))
    );
  }

  private isLegacyGeneratedInvalidDerivedResponse(
    response: ResponseEntity,
    inputStatus: number | null,
    inputCode: number | undefined,
    inputScore: number | undefined,
    variableCodings: VariableCodingData[]
  ): boolean {
    if (
      response.is_autocoder_generated !== true ||
      response.autocoder_invalidated_version !== null ||
      inputStatus !== INVALID_STATUS ||
      inputCode !== undefined ||
      inputScore !== undefined ||
      response.status_v2 !== null ||
      response.code_v2 !== null ||
      response.score_v2 !== null
    ) {
      return false;
    }

    const normalizedVariableId = this.normalizeVariableId(
      response.variableid
    );
    const isDerivedCoding = (coding: VariableCodingData) => (
      (coding.deriveSources?.length || 0) > 0
    );
    const outputMatches = variableCodings.filter(coding => (
      this.normalizeVariableId(coding.alias || coding.id) ===
        normalizedVariableId
    ));
    if (outputMatches.length > 0) {
      return outputMatches.filter(isDerivedCoding).length === 1;
    }

    const matchingDerivedCodings = variableCodings.filter(coding => (
      isDerivedCoding(coding) &&
      this.normalizeVariableId(coding.id) === normalizedVariableId
    ));

    return matchingDerivedCodings.length === 1;
  }

  private resolveCompleteDerivedTuple(
    autoCoderRun: 1 | 2,
    existingResponse: ResponseEntity | undefined,
    codedResultId: string,
    codedSubform: string,
    independentlyRecalculatedResults: Map<string, AutocoderResponse>,
    independentRecalculationAvailable: boolean,
    variableCodings: VariableCodingData[]
  ): CompleteDerivedTupleResolution {
    if (
      autoCoderRun !== 2 ||
      !existingResponse ||
      !independentRecalculationAvailable
    ) {
      return { action: 'NOT_APPLICABLE' };
    }

    const tuple = this.getCompleteDerivedTuple(existingResponse);
    const hasInvalidatedTuple =
      this.hasInvalidatedCompleteDerivedTuple(existingResponse);
    if (!tuple && !hasInvalidatedTuple) {
      return { action: 'NOT_APPLICABLE' };
    }

    const normalizedResultId = this.normalizeVariableId(codedResultId);
    const matchingCodings = variableCodings.filter(coding => (
      this.normalizeVariableId(coding.alias || coding.id) ===
        normalizedResultId
    ));

    if (
      matchingCodings.length !== 1 ||
      (matchingCodings[0].deriveSources?.length || 0) === 0
    ) {
      return { action: 'NOT_APPLICABLE' };
    }

    const recalculatedResult = independentlyRecalculatedResults.get(
      this.autocoderResultKey(codedResultId, codedSubform)
    );

    if (!recalculatedResult) {
      throw new Error(
        'Autocoder did not return independently recalculated result ' +
        `"${codedResultId}" for response ${existingResponse.id}.`
      );
    }

    if (!tuple) {
      return {
        action: 'RECALCULATE_INVALIDATED',
        recalculatedResult
      };
    }

    const preservationReason = this.getCompleteDerivedTuplePreservationReason(
      tuple,
      existingResponse,
      recalculatedResult
    );

    return preservationReason ?
      { action: 'PRESERVE', tuple, reason: preservationReason } :
      { action: 'DERIVED_VALUE_CHANGED', tuple, recalculatedResult };
  }

  private getCompleteDerivedTuple(
    response: ResponseEntity
  ): CompleteDerivedTuple | null {
    if (response.is_autocoder_generated !== true) {
      return null;
    }

    const hasV2Tuple = response.code_v2 !== null || response.score_v2 !== null;
    const canRecoverFromNonAuthoritativeV3Result =
      response.autocoder_invalidated_version === 'v2' &&
      (
        response.status_v3 === DERIVE_ERROR_STATUS ||
        response.status_v3 === CODING_INCOMPLETE_STATUS ||
        response.status_v3 === INVALID_STATUS
      );
    if (
      (
        response.autocoder_invalidated_version !== 'v2' ||
        canRecoverFromNonAuthoritativeV3Result
      ) &&
      response.status_v2 === CODING_COMPLETE_STATUS &&
      hasV2Tuple
    ) {
      return {
        version: 'v2',
        code: response.code_v2,
        score: response.score_v2
      };
    }

    if (response.autocoder_invalidated_version) {
      return null;
    }

    const hasNoV2Tuple =
      response.code_v2 === null &&
      response.score_v2 === null;
    const inheritsV1Status =
      response.status_v2 === null ||
      (
        response.status_v2 === CODING_INCOMPLETE_STATUS &&
        response.inherits_v1_for_v2 === true
      ) ||
      (
        response.status_v2 !== null &&
        STATISTICS_IGNORED_STATUSES.includes(response.status_v2)
      );
    const hasNoV2Result = hasNoV2Tuple && inheritsV1Status;
    const hasV1Tuple = response.code_v1 !== null || response.score_v1 !== null;
    if (
      hasNoV2Result &&
      response.status_v1 === CODING_COMPLETE_STATUS &&
      hasV1Tuple
    ) {
      return {
        version: 'v1',
        code: response.code_v1,
        score: response.score_v1
      };
    }

    return null;
  }

  private hasInvalidatedCompleteDerivedTuple(
    response: ResponseEntity
  ): boolean {
    return response.is_autocoder_generated === true &&
      (
        response.autocoder_invalidated_version === 'v1' ||
        response.autocoder_invalidated_version === 'v2'
      );
  }

  private recalculateCompleteDerivedResults(
    autoCoderRun: 1 | 2,
    responses: ResponseEntity[],
    inputResponses: AutocoderResponse[],
    variableCodings: VariableCodingData[]
  ): CompleteDerivedRecalculation {
    if (autoCoderRun !== 2) {
      return {
        targetResults: new Map(),
        authoritativeResults: null,
        independentRecalculationAvailable: true
      };
    }

    const targetsWithoutLevels = variableCodings.flatMap(coding => {
      if ((coding.deriveSources?.length || 0) === 0) {
        return [];
      }

      const outputId = coding.alias || coding.id;
      const normalizedOutputId = this.normalizeVariableId(outputId);
      const exactOutputResponses = responses
        .filter(response => (
          this.normalizeVariableId(response.variableid) ===
            normalizedOutputId &&
          (
            this.getCompleteDerivedTuple(response) !== null ||
            this.hasInvalidatedCompleteDerivedTuple(response)
          )
        ));
      const legacyTechnicalIdResponses = exactOutputResponses.length === 0 &&
        coding.alias ?
        responses.filter(response => (
          response.is_autocoder_generated === true &&
          this.normalizeVariableId(response.variableid) ===
            this.normalizeVariableId(coding.id) &&
          (
            this.getCompleteDerivedTuple(response) !== null ||
            this.hasInvalidatedCompleteDerivedTuple(response)
          )
        )) :
        [];
      return [...exactOutputResponses, ...legacyTechnicalIdResponses]
        .map(response => {
          const tuple = this.getCompleteDerivedTuple(response);
          return {
            outputId,
            codingId: coding.id,
            inputId: this.normalizeVariableId(response.variableid),
            subform: String(response.subform || ''),
            response,
            tuple
          };
        })
        .filter(target => target !== null);
    });

    if (targetsWithoutLevels.length === 0) {
      return {
        targetResults: new Map(),
        authoritativeResults: null,
        independentRecalculationAvailable: true
      };
    }

    let dependencyLevels: Map<string, number>;
    try {
      dependencyLevels = new Map(
        Autocoder.CodingSchemeFactory.getVariableDependencyTree(variableCodings)
          .map(node => [node.id, node.level] as const)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        'Skipping independent complete-derived-result recalculation because ' +
        `the coding-scheme dependency graph cannot be ordered: ${message}. ` +
        'Falling back to the regular autocoder result.'
      );
      return {
        targetResults: new Map(),
        authoritativeResults: null,
        independentRecalculationAvailable: false
      };
    }
    const targets = targetsWithoutLevels.map(target => {
      const level = dependencyLevels.get(target.codingId);
      if (level === undefined) {
        throw new Error(
          `Autocoder dependency level is missing for derived target "${target.outputId}".`
        );
      }
      return { ...target, level };
    });

    const resultsByTarget = new Map<string, AutocoderResponse>();
    let requiresAuthoritativeRecalculation = false;
    let workingInput: AutocoderResponse[] = inputResponses.map(response => ({
      ...response,
      // The response library treats null and empty subforms as no subform.
      // Normalize them to undefined so its no-subform pipeline does not
      // duplicate stale pass-through responses during recalculation.
      subform: response.subform || undefined
    }));
    const levels = Array.from(new Set(targets.map(target => target.level)))
      .sort((a, b) => a - b);

    levels.forEach(level => {
      const levelTargets = targets.filter(target => target.level === level);
      const levelInputKeys = new Set(levelTargets.map(target => (
        this.autocoderResultKey(target.inputId, target.subform)
      )));
      const levelOutputKeys = new Set(levelTargets.map(target => (
        this.autocoderResultKey(target.outputId, target.subform)
      )));
      const recalculationInput = workingInput.map(response => {
        const key = this.autocoderResultKey(
          response.id,
          String(response.subform || '')
        );
        return levelInputKeys.has(key) ? {
          ...response,
          status: 'UNSET' as const,
          code: undefined,
          score: undefined
        } : response;
      });
      const recalculatedResults = this.codeAutocoderResponses(
        recalculationInput,
        variableCodings
      );
      const levelResults = new Map<string, AutocoderResponse>();

      recalculatedResults.forEach(result => {
        const key = this.autocoderResultKey(
          result.id,
          String(result.subform || '')
        );
        if (!levelOutputKeys.has(key)) {
          return;
        }
        if (levelResults.has(key)) {
          throw new Error(
            'Autocoder returned multiple independently recalculated results ' +
            `for derived target "${result.id}".`
          );
        }
        levelResults.set(key, result);
      });

      const nextStatesByInput = new Map<string, AutocoderResponse>();
      levelTargets.forEach(target => {
        const outputKey = this.autocoderResultKey(
          target.outputId,
          target.subform
        );
        const recalculatedResult = levelResults.get(outputKey);
        if (!recalculatedResult) {
          throw new Error(
            'Autocoder did not return independently recalculated result ' +
            `"${target.outputId}" for response ${target.response.id}.`
          );
        }
        resultsByTarget.set(outputKey, recalculatedResult);

        const inputKey = this.autocoderResultKey(
          target.inputId,
          target.subform
        );
        const currentInput = workingInput.find(response => (
          this.autocoderResultKey(
            response.id,
            String(response.subform || '')
          ) === inputKey
        ));
        if (!currentInput) {
          throw new Error(
            `Autocoder input is missing for derived response ${target.response.id}.`
          );
        }

        const shouldRestoreTuple = target.tuple &&
          this.getCompleteDerivedTuplePreservationReason(
            target.tuple,
            target.response,
            recalculatedResult
          ) !== null;
        if (!shouldRestoreTuple) {
          requiresAuthoritativeRecalculation = true;
        }
        nextStatesByInput.set(inputKey, shouldRestoreTuple ? {
          ...currentInput,
          status: 'CODING_COMPLETE',
          code: target.tuple.code ?? undefined,
          score: target.tuple.score ?? undefined
        } : {
          ...currentInput,
          value: recalculatedResult.value,
          status: recalculatedResult.status,
          code: recalculatedResult.code,
          score: recalculatedResult.score
        });
      });

      workingInput = workingInput.map(response => (
        nextStatesByInput.get(this.autocoderResultKey(
          response.id,
          String(response.subform || '')
        )) || response
      ));
    });

    return {
      targetResults: resultsByTarget,
      authoritativeResults: requiresAuthoritativeRecalculation ?
        this.codeAutocoderResponses(workingInput, variableCodings) :
        null,
      independentRecalculationAvailable: true
    };
  }

  private autocoderResultKey(variableId: unknown, subform: string): string {
    return `${this.normalizeVariableId(variableId)}\u0000${subform}`;
  }

  private normalizeAutocoderValueForComparison(value: unknown): string {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value) ?? '';
    }
    return String(value ?? '');
  }

  private serializeAutocoderValue(value: unknown): string {
    return typeof value === 'object' && value !== null ?
      JSON.stringify(value) :
      String(value ?? '');
  }

  private invalidateCompleteDerivedTuple(
    codedResponse: CodedResponse,
    tuple: CompleteDerivedTuple
  ): void {
    codedResponse.autocoderInvalidatedVersion = tuple.version;
  }

  private hasUnchangedDerivedValue(
    response: ResponseEntity,
    recalculatedResult: AutocoderResponse
  ): boolean {
    return COMPARABLE_RECALCULATED_STATUSES.has(recalculatedResult.status) &&
      this.normalizeAutocoderValueForComparison(recalculatedResult.value) ===
        this.normalizeAutocoderValueForComparison(response.value);
  }

  private getCompleteDerivedTuplePreservationReason(
    tuple: CompleteDerivedTuple,
    response: ResponseEntity,
    recalculatedResult: AutocoderResponse
  ): CompleteDerivedTuplePreservationReason | null {
    if (
      tuple.version === 'v2' &&
      NON_AUTHORITATIVE_V2_RECALCULATION_STATUSES.has(
        recalculatedResult.status
      )
    ) {
      return 'V2_RECALCULATION_NOT_COMPLETE';
    }

    return this.hasUnchangedDerivedValue(response, recalculatedResult) ?
      'UNCHANGED' :
      null;
  }

  private assertUniqueAutocoderPersistenceTargets(
    codedResponses: CodedResponse[],
    sources?: AutocoderPersistenceSource[]
  ): void {
    const targetIndexes = new Map<string, number>();

    codedResponses.forEach((response, index) => {
      const target = response.isNew ?
        `generated:${response.unitid}:${this.normalizeVariableId(
          response.variableid
        )}:${String(response.subform || '')}` :
        `response:${response.id}`;
      const previousIndex = targetIndexes.get(target);

      if (previousIndex !== undefined) {
        const previousSource = sources?.[previousIndex];
        const currentSource = sources?.[index];
        if (previousSource && currentSource) {
          const schemeRef = currentSource.codingSchemeRef ||
            previousSource.codingSchemeRef ||
            'unknown';
          throw new Error(
            `Autocoder produced multiple updates for ${target} in coding scheme ` +
            `"${schemeRef}", unit "${currentSource.unitName}" ` +
            `(${currentSource.unitId}), target variable ` +
            `"${currentSource.targetVariableId}". Results: ` +
            `${this.formatAutocoderPersistenceSource(previousSource)} and ` +
            `${this.formatAutocoderPersistenceSource(currentSource)}. ` +
            'Possible origins are diagnostic hints, not proven provenance.'
          );
        }

        throw new Error(
          `Autocoder produced multiple updates for ${target} ` +
          `(results ${previousIndex + 1} and ${index + 1}).`
        );
      }

      targetIndexes.set(target, index);
    });
  }

  private describeAutocoderResultCandidates(
    resultId: string,
    inputResponses: Array<{ id: string }>,
    variableCodings: VariableCodingData[]
  ): string[] {
    const normalizedResultId = this.normalizeVariableId(resultId);
    const candidates: string[] = [];

    if (inputResponses.some(response => (
      this.normalizeVariableId(response.id) === normalizedResultId
    ))) {
      candidates.push(`input/pass-through "${resultId}"`);
    }

    variableCodings
      .filter(coding => (
        this.normalizeVariableId(coding.alias || coding.id) ===
          normalizedResultId
      ))
      .forEach(coding => {
        const alias = coding.alias && coding.alias !== coding.id ?
          ` -> alias "${coding.alias}"` :
          '';
        candidates.push(
          `${coding.sourceType || 'unknown'} coding "${coding.id}"${alias}`
        );
      });

    return candidates.length > 0 ? candidates : [`result "${resultId}"`];
  }

  private formatAutocoderPersistenceSource(
    source: AutocoderPersistenceSource
  ): string {
    return `result ${source.resultIndex + 1} ` +
      `("${source.resultId}", subform "${source.subform}", ` +
      `status "${source.status}", code ${String(source.code)}; ` +
      `possible origins: ${source.possibleOrigins.join(' or ')})`;
  }

  private normalizeVariableId(variableId: unknown): string {
    return String(variableId ?? '').toUpperCase();
  }

  private normalizeAutocoderNumericInput(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error(
        `Autocoder input contains a non-numeric code or score: ${String(value)}`
      );
    }

    return numericValue;
  }

  private async getCodingSchemeFiles(
    workspaceId: number,
    codingSchemeRefs: Set<string>,
    jobId?: string,
    manager?: EntityManager
  ): Promise<Map<string, CodingScheme>> {
    const fileIdToCodingSchemeMap = await this.getCodingSchemesWithCache(
      workspaceId,
      [...codingSchemeRefs],
      manager
    );
    if (jobId && (await this.isJobCancelled(jobId))) {
      this.logger.log(
        `Job ${jobId} was cancelled or paused after getting coding scheme files`
      );
      return fileIdToCodingSchemeMap;
    }

    return fileIdToCodingSchemeMap;
  }

  private async extractCodingSchemeReferences(
    units: Unit[],
    fileIdToTestFileMap: Map<string, FileUpload>,
    jobId?: string
  ): Promise<{
      codingSchemeRefs: Set<string>;
      unitToCodingSchemeRefMap: Map<number, string>;
    }> {
    const codingSchemeRefs = new Set<string>();
    const unitToCodingSchemeRefMap = new Map<number, string>();
    const batchSize = 50;

    for (let i = 0; i < units.length; i += batchSize) {
      const unitBatch = units.slice(i, i + batchSize);

      for (const unit of unitBatch) {
        const unitFileId = this.getUnitFileId(unit);
        if (!unitFileId) {
          this.logger.warn(
            `Skipping coding scheme lookup for unit ${unit.id}: missing unit alias and name.`
          );
          continue;
        }

        const testFile = fileIdToTestFileMap.get(unitFileId);
        if (!testFile) continue;

        try {
          const $ = cheerio.load(testFile.data);
          const codingSchemeRefText = $('codingSchemeRef').text();
          if (codingSchemeRefText) {
            const codingSchemeRefUpper = codingSchemeRefText.toUpperCase();
            codingSchemeRefs.add(codingSchemeRefUpper);
            unitToCodingSchemeRefMap.set(unit.id, codingSchemeRefUpper);
            this.logger.debug(
              `Extracted coding scheme mapping: unitId=${unit.id
              }, unitFileId=${unitFileId}, codingSchemeRef=${codingSchemeRefUpper}`
            );
          }
        } catch (error) {
          this.logger.error(
            `--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${error.message}`
          );
        }
      }
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during scheme extraction`
        );
        return {
          codingSchemeRefs,
          unitToCodingSchemeRefMap
        };
      }
    }

    return {
      codingSchemeRefs,
      unitToCodingSchemeRefMap
    };
  }

  private normalizeAutocoderStatus(status: string): string {
    const nonCodingStatuses = [];
    if (nonCodingStatuses.includes(status)) {
      return 'NO_CODING';
    }
    return status;
  }

  private uniquePositiveIds(ids: number[]): number[] {
    return Array.from(
      new Set(
        ids
          .map(id => Number(id))
          .filter(id => Number.isInteger(id) && id > 0)
      )
    );
  }
}
