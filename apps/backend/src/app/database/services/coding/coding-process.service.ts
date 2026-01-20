import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, In, Repository, QueryRunner
} from 'typeorm';
import {
  VariableCodingData,
  CodingScheme
} from '@iqbspecs/coding-scheme';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import {
  statusNumberToString,
  statusStringToNumber
} from '../../utils/response-status-converter';
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
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

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
    private workspaceFilesService: WorkspaceFilesService
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
    autoCoderRun: number = 1
  ): Promise<CodingStatisticsWithJob> {
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

    const bullJob = await this.jobQueueService.addTestPersonCodingJob({
      workspaceId: workspace_id,
      personIds,
      groupNames: !areAllNumbers ? groupsOrIds.join(',') : undefined,
      autoCoderRun
    });

    this.logger.log(`Added job to Redis queue with ID ${bullJob.id}`);

    return {
      totalResponses: 0,
      statusCounts: {},
      jobId: bullJob.id.toString(),
      message: `Processing ${personIds.length} test persons in the background. Check job status with jobId: ${bullJob.id}`
    };
  }

  async processTestPersonsBatch(
    workspace_id: number,
    personIds: string[],
    autoCoderRun: number = 1,
    progressCallback?: (progress: number) => void,
    jobId?: string
  ): Promise<CodingStatistics> {
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

    const queryRunner =
      this.responseRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      // Step 1: Get persons - 10% progress
      const personsQueryStart = Date.now();
      const persons = await this.fetchPersons(workspace_id, personIds);
      metrics.personsQuery = Date.now() - personsQueryStart;

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        await queryRunner.release();
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
        await queryRunner.release();
        return statistics;
      }

      // Step 2: Get booklets - 20% progress
      const bookletQueryStart = Date.now();
      const booklets = await this.fetchBooklets(personIdsArray);
      metrics.bookletQuery = Date.now() - bookletQueryStart;

      if (!booklets || booklets.length === 0) {
        this.logger.log(
          'Keine Booklets für die angegebenen Personen gefunden.'
        );
        await queryRunner.release();
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
        await queryRunner.release();
        return statistics;
      }

      // Step 3: Get units - 30% progress
      const unitQueryStart = Date.now();
      const units = await this.fetchUnits(bookletIds);
      metrics.unitQuery = Date.now() - unitQueryStart;

      if (!units || units.length === 0) {
        this.logger.log(
          'Keine Aufgaben für die angegebenen Testhefte gefunden.'
        );
        await queryRunner.release();
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
        await queryRunner.release();
        return statistics;
      }

      // Step 4: Process units and build maps - 40% progress
      const unitIds = new Set<number>();
      const unitAliasesSet = new Set<string>();

      for (const unit of units) {
        unitIds.add(unit.id);
        unitAliasesSet.add(unit.alias.toUpperCase());
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
        await queryRunner.release();
        return statistics;
      }

      // Step 5: Get responses - 50% progress
      const responseQueryStart = Date.now();
      const allResponses = await this.fetchResponses(unitIdsArray, queryRunner);
      metrics.responseQuery = Date.now() - responseQueryStart;

      if (!allResponses || allResponses.length === 0) {
        this.logger.log('Keine zu kodierenden Antworten gefunden.');
        await queryRunner.release();
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
        await queryRunner.release();
        return statistics;
      }

      // Step 6: Get unit variables for filtering - 55% progress
      const filteredResponses = await this.filterResponsesValidVariables(
        workspace_id,
        allResponses,
        units
      );

      this.logger.log(
        `Filtered responses: ${allResponses.length} -> ${filteredResponses.length
        } (removed ${allResponses.length - filteredResponses.length
        } invalid variable responses)`
      );

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after filtering responses`
        );
        await queryRunner.release();
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
        await queryRunner.release();
        return statistics;
      }

      // Step 8: Get test files - 70% progress
      const fileQueryStart = Date.now();
      // Use cache for test files
      const fileIdToTestFileMap = await this.getTestFilesWithCache(
        workspace_id,
        unitAliasesArray
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
        await queryRunner.release();
        return statistics;
      }

      // Step 9: Extract coding scheme references - 80% progress
      const schemeExtractStart = Date.now();
      const { codingSchemeRefs, unitToCodingSchemeRefMap } =
        await this.extractCodingSchemeReferences(
          units,
          fileIdToTestFileMap,
          jobId,
          queryRunner
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
        await queryRunner.release();
        return statistics;
      }

      // Step 10: Get coding scheme files - 85% progress
      const schemeQueryStart = Date.now();
      const fileIdToCodingSchemeMap = await this.getCodingSchemeFiles(
        codingSchemeRefs,
        jobId,
        queryRunner
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
        await queryRunner.release();
        return statistics;
      }

      // Step 11: Process and code responses - 95% progress
      const processingStart = Date.now();

      const { allCodedResponses } = await this.processAndCodeResponses(
        units,
        unitToResponsesMap,
        unitToCodingSchemeRefMap,
        fileIdToCodingSchemeMap,
        filteredResponses,
        statistics,
        autoCoderRun,
        jobId,
        queryRunner,
        progressCallback
      );

      metrics.processing = Date.now() - processingStart;

      // Check for cancellation or pause after step 11
      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused after coding responses`
        );
        await queryRunner.release();
        return statistics;
      }

      // Step 12: Update responses in database - 100% progress
      const updateSuccess =
        await this.responseManagementService.updateResponsesInDatabase(
          allCodedResponses,
          queryRunner,
          jobId,
          this.isJobCancelled.bind(this),
          progressCallback,
          metrics
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
      this.logger.error(
        `Error while processing test persons in batch: ${error.message} \n ${error.stack}`
      );
      await queryRunner.rollbackTransaction();
      return statistics;
    } finally {
      await queryRunner.release();
    }
  }

  private async fetchPersons(
    workspaceId: number,
    personIds: string[]
  ): Promise<Persons[]> {
    return this.personsRepository.find({
      where: { workspace_id: workspaceId, id: In(personIds) },
      select: ['id', 'group', 'login', 'code', 'uploaded_at']
    });
  }

  private async fetchBooklets(personIds: number[]): Promise<Booklet[]> {
    return this.bookletRepository.find({
      where: { personid: In(personIds) },
      select: ['id', 'personid']
    });
  }

  private async fetchUnits(bookletIds: number[]): Promise<Unit[]> {
    return this.unitRepository.find({
      where: { bookletid: In(bookletIds) },
      select: ['id', 'bookletid', 'name', 'alias']
    });
  }

  private async fetchResponses(
    unitIds: number[],
    queryRunner: QueryRunner
  ): Promise<ResponseEntity[]> {
    const responseRepo = queryRunner.manager.getRepository(ResponseEntity);
    return responseRepo
      .createQueryBuilder('ResponseEntity')
      .select([
        'ResponseEntity.id',
        'ResponseEntity.unitid',
        'ResponseEntity.variableid',
        'ResponseEntity.value',
        'ResponseEntity.status',
        'ResponseEntity.status_v1',
        'ResponseEntity.status_v2'
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
      )
      .getMany();
  }

  private async filterResponsesValidVariables(
    workspaceId: number,
    responses: ResponseEntity[],
    units: Unit[]
  ): Promise<ResponseEntity[]> {
    const unitVariables = await this.workspaceFilesService.getUnitVariableMap(
      workspaceId
    );
    const validVariableSets = new Map<string, Set<string>>();
    unitVariables.forEach((vars: Set<string>, unitName: string) => {
      validVariableSets.set(unitName.toUpperCase(), vars);
    });

    const unitIdToNameMap = new Map<number, string>();
    units.forEach(unit => {
      unitIdToNameMap.set(unit.id, unit.name);
    });

    return responses.filter(response => {
      const unitName = unitIdToNameMap.get(response.unitid)?.toUpperCase();
      const validVars = validVariableSets.get(unitName || '');
      return validVars?.has(response.variableid);
    });
  }

  private async getTestFilesWithCache(
    workspace_id: number,
    unitAliasesArray: string[]
  ): Promise<Map<string, FileUpload>> {
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
      const missingFiles = await this.fileUploadRepository.find({
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
    const testFiles = await this.fileUploadRepository.find({
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
    codingSchemeRefs: string[]
  ): Promise<Map<string, CodingScheme>> {
    const now = Date.now();
    const result = new Map<string, CodingScheme>();
    const emptyScheme = new CodingScheme({});

    const missingSchemeRefs = codingSchemeRefs.filter(ref => {
      const cacheEntry = this.codingSchemeCache.get(ref);
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
    const codingSchemeFiles = await this.fileUploadRepository.find({
      where: { file_id: In(missingSchemeRefs) },
      select: ['file_id', 'data', 'filename']
    });

    codingSchemeFiles.forEach(file => {
      try {
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = new CodingScheme(data);
        result.set(file.file_id, scheme);
        this.codingSchemeCache.set(file.file_id, { scheme, timestamp: now });
      } catch (error) {
        this.logger.error(
          `--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`
        );
        result.set(file.file_id, emptyScheme);
      }
    });

    return result;
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
    units: Unit[],
    unitToResponsesMap: Map<number | string, ResponseEntity[]>,
    unitToCodingSchemeRefMap: Map<number, string>,
    fileIdToCodingSchemeMap: Map<string, CodingScheme>,
    allResponses: ResponseEntity[],
    statistics: CodingStatistics,
    autoCoderRun: number = 1,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner,
    progressCallback?: (progress: number) => void
  ): Promise<{
      allCodedResponses: CodedResponse[];
      statistics: CodingStatistics;
    }> {
    const allCodedResponses = [];
    allCodedResponses.length = allResponses.length;
    let responseIndex = 0;
    const batchSize = 50;
    const emptyScheme = new CodingScheme({});

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

        const variableAliasToIdMap = new Map<string, string>();
        if (Array.isArray(scheme.variableCodings)) {
          scheme.variableCodings.forEach((vc: VariableCodingData) => {
            const key = (vc.alias ?? vc.id) as string | undefined;
            const value = vc.id as string | undefined;
            if (key && value) {
              variableAliasToIdMap.set(key, value);
            }
          });
        }

        for (const response of responses) {
          let inputStatus = response.status;
          if (autoCoderRun === 2) {
            inputStatus =
              response.status_v2 || response.status_v1 || response.status;
          }

          const variableAlias = String(response.variableid);
          const resolvedVariableId =
            variableAliasToIdMap.get(variableAlias) ?? variableAlias;

          const variableCoding = Array.isArray(scheme.variableCodings) ?
            scheme.variableCodings.find((vc: VariableCodingData) => {
              const key = (vc.alias ?? vc.id) as string | undefined;
              return key === variableAlias || key === resolvedVariableId;
            }) :
            undefined;

          const codedResult = Autocoder.CodingFactory.code(
            {
              id: response.variableid,
              value: response.value,
              status: statusNumberToString(inputStatus) || 'UNSET'
            },
            variableCoding
          );
          const codedStatus = codedResult?.status;
          if (!statistics.statusCounts[codedStatus]) {
            statistics.statusCounts[codedStatus] = 0;
          }
          statistics.statusCounts[codedStatus] += 1;

          const codedResponse: CodedResponse = {
            id: response.id
          };

          if (autoCoderRun === 1) {
            codedResponse.code_v1 = codedResult?.code;
            codedResponse.status_v1 = codedStatus;
            codedResponse.score_v1 = codedResult?.score;
          } else if (autoCoderRun === 2) {
            codedResponse.code_v3 = codedResult?.code;
            codedResponse.status_v3 = codedStatus;
            codedResponse.score_v3 = codedResult?.score;
          }

          allCodedResponses[responseIndex] = codedResponse;
          responseIndex += 1;
        }
      }

      if (jobId && (await this.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during response processing`
        );
        if (queryRunner) {
          await queryRunner.release();
        }
        return { allCodedResponses, statistics };
      }
    }

    allCodedResponses.length = responseIndex;

    if (progressCallback) {
      progressCallback(95);
    }

    return { allCodedResponses, statistics };
  }

  private async getCodingSchemeFiles(
    codingSchemeRefs: Set<string>,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner
  ): Promise<Map<string, CodingScheme>> {
    const fileIdToCodingSchemeMap = await this.getCodingSchemesWithCache([
      ...codingSchemeRefs
    ]);
    if (jobId && (await this.isJobCancelled(jobId))) {
      this.logger.log(
        `Job ${jobId} was cancelled or paused after getting coding scheme files`
      );
      if (queryRunner) {
        await queryRunner.release();
      }
      return fileIdToCodingSchemeMap;
    }

    return fileIdToCodingSchemeMap;
  }

  private async extractCodingSchemeReferences(
    units: Unit[],
    fileIdToTestFileMap: Map<string, FileUpload>,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner
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
        const testFile = fileIdToTestFileMap.get(unit.alias.toUpperCase());
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
              }, unitAlias=${unit.alias.toUpperCase()}, codingSchemeRef=${codingSchemeRefUpper}`
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
        if (queryRunner) {
          await queryRunner.release();
        }
        return { codingSchemeRefs, unitToCodingSchemeRefMap };
      }
    }

    return { codingSchemeRefs, unitToCodingSchemeRefMap };
  }
}
