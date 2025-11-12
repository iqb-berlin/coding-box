import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CodingScheme } from '@iqbspecs/coding-scheme/coding-scheme.interface';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import * as ExcelJS from 'exceljs';
import { statusNumberToString, statusStringToNumber } from '../utils/response-status-converter';
import { CacheService } from '../../cache/cache.service';
import { MissingsProfilesService } from './missings-profiles.service';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { CodingStatistics, CodingStatisticsWithJob } from './shared-types';
import { CodebookGenerator } from '../../admin/code-book/codebook-generator.class';
import { CodeBookContentSetting, UnitPropertiesForCodebook, Missing } from '../../admin/code-book/codebook.interfaces';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { VariableAnalysisReplayService } from './variable-analysis-replay.service';
import { ExportValidationResultsService } from './export-validation-results.service';
import { ExternalCodingImportService, ExternalCodingImportBody } from './external-coding-import.service';
import { BullJobManagementService } from './bull-job-management.service';
import { WorkspaceFilesService } from './workspace-files.service';
import { CodingResultsService } from './coding-results.service';
import { CodingJobService } from './coding-job.service';

interface CodedResponse {
  id: number;
  code_v1?: number;
  status_v1?: string;
  score_v1?: number;
  code_v3?: number;
  status_v3?: string;
  score_v3?: number;
}

@Injectable()
export class WorkspaceCodingService {
  private readonly logger = new Logger(WorkspaceCodingService.name);

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
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService,
    private missingsProfilesService: MissingsProfilesService,
    private codingStatisticsService: CodingStatisticsService,
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private externalCodingImportService: ExternalCodingImportService,
    private bullJobManagementService: BullJobManagementService,
    private workspaceFilesService: WorkspaceFilesService,
    private codingResultsService: CodingResultsService,
    private codingJobService: CodingJobService
  ) {}

  private codingSchemeCache: Map<string, { scheme: CodingScheme; timestamp: number }> = new Map();
  private readonly SCHEME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL

  private testFileCache: Map<number, { files: Map<string, FileUpload>; timestamp: number }> = new Map();
  private readonly TEST_FILE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache TTL

  private generateExpectedCombinationsHash(expectedCombinations: ExpectedCombinationDto[]): string {
    const sortedData = expectedCombinations
      .map(combo => `${combo.unit_key}|${combo.login_name}|${combo.login_code}|${combo.booklet_id}|${combo.variable_id}`)
      .sort()
      .join('||');

    return crypto.createHash('sha256').update(sortedData).digest('hex').substring(0, 16);
  }

  private async getTestFilesWithCache(workspace_id: number, unitAliasesArray: string[]): Promise<Map<string, FileUpload>> {
    const cacheEntry = this.testFileCache.get(workspace_id);
    const now = Date.now();

    if (cacheEntry && (now - cacheEntry.timestamp) < this.TEST_FILE_CACHE_TTL_MS) {
      this.logger.log(`Using cached test files for workspace ${workspace_id}`);
      const missingAliases = unitAliasesArray.filter(alias => !cacheEntry.files.has(alias));
      if (missingAliases.length === 0) {
        return cacheEntry.files;
      }

      this.logger.log(`Fetching ${missingAliases.length} missing test files for workspace ${workspace_id}`);
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

  private async getCodingSchemesWithCache(codingSchemeRefs: string[]): Promise<Map<string, CodingScheme>> {
    const now = Date.now();
    const result = new Map<string, CodingScheme>();
    const emptyScheme = new CodingScheme({});

    const missingSchemeRefs = codingSchemeRefs.filter(ref => {
      const cacheEntry = this.codingSchemeCache.get(ref);
      if (cacheEntry && (now - cacheEntry.timestamp) < this.SCHEME_CACHE_TTL_MS) {
        result.set(ref, cacheEntry.scheme);
        return false;
      }
      return true;
    });

    if (missingSchemeRefs.length === 0) {
      this.logger.log('Using all cached coding schemes');
      return result;
    }

    this.logger.log(`Fetching ${missingSchemeRefs.length} missing coding schemes`);
    const codingSchemeFiles = await this.fileUploadRepository.find({
      where: { file_id: In(missingSchemeRefs) },
      select: ['file_id', 'data', 'filename']
    });

    codingSchemeFiles.forEach(file => {
      try {
        const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = new CodingScheme(data);
        result.set(file.file_id, scheme);
        this.codingSchemeCache.set(file.file_id, { scheme, timestamp: now });
      } catch (error) {
        this.logger.error(`--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`);
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

  async getJobStatus(jobId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused'; progress: number; result?: CodingStatistics; error?: string } | null> {
    try {
      let bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);

      if (!bullJob) {
        bullJob = await this.jobQueueService.getCodingStatisticsJob(jobId) as never;
      }

      if (bullJob) {
        const state = await bullJob.getState();
        const progress = await bullJob.progress() || 0;

        let status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
        switch (state) {
          case 'active':
            status = 'processing';
            break;
          case 'completed':
            status = 'completed';
            break;
          case 'failed':
            status = 'failed';
            break;
          case 'delayed':
          case 'waiting':
            status = 'pending';
            break;
          case 'paused':
            status = 'paused';
            break;
          default:
            status = 'pending';
        }

        let result: CodingStatistics | undefined;
        let error: string | undefined;

        if (state === 'completed' && bullJob.returnvalue) {
          result = bullJob.returnvalue as CodingStatistics;
        } else if (state === 'failed' && bullJob.failedReason) {
          error = bullJob.failedReason;
        }

        return {
          status,
          progress: typeof progress === 'number' ? progress : 0,
          result,
          error
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Error getting job status: ${error.message}`, error.stack);
      return null;
    }
  }

  async createCodingStatisticsJob(workspaceId: number): Promise<{ jobId: string; message: string }> {
    try {
      const cacheKey = `coding-statistics:${workspaceId}`;
      const cachedResult = await this.cacheService.get<CodingStatistics>(cacheKey);
      if (cachedResult) {
        this.logger.log(`Cached coding statistics exist for workspace ${workspaceId}, returning empty jobId to use cache`);
        return { jobId: '', message: 'Using cached coding statistics' };
      }
      await this.cacheService.delete(cacheKey); // Clear any stale cache
      this.logger.log(`No cached coding statistics for workspace ${workspaceId}, creating job to recalculate`);

      const job = await this.jobQueueService.addCodingStatisticsJob(workspaceId);
      this.logger.log(`Created coding statistics job ${job.id} for workspace ${workspaceId}`);
      return { jobId: job.id.toString(), message: 'Created coding statistics job - no cache available' };
    } catch (error) {
      this.logger.error(`Error creating coding statistics job: ${error.message}`, error.stack);
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const state = await bullJob.getState();
      if (state === 'completed' || state === 'failed') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${state}`
        };
      }

      const result = await this.jobQueueService.cancelTestPersonCodingJob(jobId);
      if (result) {
        this.logger.log(`Job ${jobId} has been cancelled successfully`);
        return { success: true, message: `Job ${jobId} has been cancelled successfully` };
      }
      return { success: false, message: `Failed to cancel job ${jobId}` };
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return { success: false, message: `Error cancelling job: ${error.message}` };
    }
  }

  async deleteJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const result = await this.jobQueueService.deleteTestPersonCodingJob(jobId);
      if (result) {
        this.logger.log(`Job ${jobId} has been deleted successfully`);
        return { success: true, message: `Job ${jobId} has been deleted successfully` };
      }
      return { success: false, message: `Failed to delete job ${jobId}` };
    } catch (error) {
      this.logger.error(`Error deleting job: ${error.message}`, error.stack);
      return { success: false, message: `Error deleting job: ${error.message}` };
    }
  }

  private async isJobCancelled(jobId: string | number): Promise<boolean> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId.toString());
      if (bullJob) {
        if (bullJob.data.isPaused) {
          return true;
        }
        const state = await bullJob.getState();
        return state === 'paused';
      }
      return false;
    } catch (error) {
      this.logger.error(`Error checking job cancellation or pause: ${error.message}`, error.stack);
      return false;
    }
  }

  private async updateResponsesInDatabase(
    allCodedResponses: CodedResponse[],
    queryRunner: import('typeorm').QueryRunner,
    jobId?: string,
    progressCallback?: (progress: number) => void,
    metrics?: { [key: string]: number }
  ): Promise<boolean> {
    if (allCodedResponses.length === 0) {
      await queryRunner.release();
      return true;
    }
    const updateStart = Date.now();
    try {
      const updateBatchSize = 500;
      const batches = [];
      for (let i = 0; i < allCodedResponses.length; i += updateBatchSize) {
        batches.push(allCodedResponses.slice(i, i + updateBatchSize));
      }

      this.logger.log(`Starte die Aktualisierung von ${allCodedResponses.length} Responses in ${batches.length} Batches (sequential).`);

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        this.logger.log(`Starte Aktualisierung für Batch #${index + 1} (Größe: ${batch.length}).`);

        if (jobId && await this.isJobCancelled(jobId)) {
          this.logger.log(`Job ${jobId} was cancelled or paused before updating batch #${index + 1}`);
          await queryRunner.rollbackTransaction();
          await queryRunner.release();
          return false;
        }

        try {
          if (batch.length > 0) {
            const updatePromises = batch.map(response => {
              const updateData: Partial<Pick<ResponseEntity, 'code_v1' | 'status_v1' | 'score_v1' | 'code_v3' | 'status_v3' | 'score_v3'>> = {};

              if (response.code_v1 !== undefined) {
                updateData.code_v1 = response.code_v1;
              }
              if (response.status_v1 !== undefined) {
                const statusNumber = statusStringToNumber(response.status_v1);
                updateData.status_v1 = statusNumber;
              }
              if (response.score_v1 !== undefined) {
                updateData.score_v1 = response.score_v1;
              }

              if (response.code_v3 !== undefined) {
                updateData.code_v3 = response.code_v3;
              }
              if (response.status_v3 !== undefined) {
                const statusNumber = statusStringToNumber(response.status_v3);
                updateData.status_v3 = statusNumber;
                this.logger.debug(`Response ${response.id}: status_v3='${response.status_v3}' -> statusNumber=${statusNumber}`);
              }
              if (response.score_v3 !== undefined) {
                updateData.score_v3 = response.score_v3;
              }

              if (Object.keys(updateData).length > 0) {
                return queryRunner.manager.update(ResponseEntity, response.id, updateData);
              }
              return Promise.resolve();
            });

            await Promise.all(updatePromises);
          }

          this.logger.log(`Batch #${index + 1} (Größe: ${batch.length}) erfolgreich aktualisiert.`);

          if (progressCallback) {
            const batchProgress = 95 + (5 * ((index + 1) / batches.length));
            progressCallback(Math.round(Math.min(batchProgress, 99))); // Cap at 99% until fully complete and round to integer
          }
        } catch (error) {
          this.logger.error(`Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${batch.length}):`, error.message);
          await queryRunner.rollbackTransaction();
          await queryRunner.release();
          return false;
        }
      }

      await queryRunner.commitTransaction();
      this.logger.log(`${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`);

      if (metrics) {
        metrics.update = Date.now() - updateStart;
      }

      await queryRunner.release();
      return true;
    } catch (error) {
      this.logger.error('Fehler beim Aktualisieren der Responses:', error.message);
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error('Fehler beim Rollback der Transaktion:', rollbackError.message);
      }
      await queryRunner.release();
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
  ): Promise<{ allCodedResponses: CodedResponse[]; statistics: CodingStatistics }> {
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
          (fileIdToCodingSchemeMap.get(codingSchemeRef) || emptyScheme) :
          emptyScheme;
        for (const response of responses) {
          let inputStatus = response.status;
          if (autoCoderRun === 2) {
            inputStatus = response.status_v2 || response.status_v1 || response.status;
          }

          const codedResult = Autocoder.CodingFactory.code({
            id: response.variableid,
            value: response.value,
            status: statusNumberToString(inputStatus) || 'UNSET'
          }, scheme.variableCodings[0]);
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

      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused during response processing`);
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
    const fileIdToCodingSchemeMap = await this.getCodingSchemesWithCache([...codingSchemeRefs]);
    if (jobId && await this.isJobCancelled(jobId)) {
      this.logger.log(`Job ${jobId} was cancelled or paused after getting coding scheme files`);
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
  ): Promise<{ codingSchemeRefs: Set<string>; unitToCodingSchemeRefMap: Map<number, string> }> {
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
            codingSchemeRefs.add(codingSchemeRefText.toUpperCase());
            unitToCodingSchemeRefMap.set(unit.id, codingSchemeRefText.toUpperCase());
          }
        } catch (error) {
          this.logger.error(`--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${error.message}`);
        }
      }
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused during scheme extraction`);
        if (queryRunner) {
          await queryRunner.release();
        }
        return { codingSchemeRefs, unitToCodingSchemeRefMap };
      }
    }

    return { codingSchemeRefs, unitToCodingSchemeRefMap };
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

    if (jobId && await this.isJobCancelled(jobId)) {
      this.logger.log(`Job ${jobId} was cancelled or paused before processing started`);
      return statistics;
    }

    const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      // Step 1: Get persons - 10% progress
      const personsQueryStart = Date.now();
      const persons = await this.personsRepository.find({
        where: { workspace_id, id: In(personIds) },
        select: ['id', 'group', 'login', 'code', 'uploaded_at']
      });
      metrics.personsQuery = Date.now() - personsQueryStart;

      if (!persons || persons.length === 0) {
        this.logger.warn('Keine Personen gefunden mit den angegebenen IDs.');
        await queryRunner.release();
        return statistics;
      }

      // Report progress after step 1
      if (progressCallback) {
        progressCallback(10);
      }

      // Check for cancellation or pause after step 1
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting persons`);
        await queryRunner.release();
        return statistics;
      }

      // Step 2: Get booklets - 20% progress
      const personIdsArray = persons.map(person => person.id);
      const bookletQueryStart = Date.now();
      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIdsArray) },
        select: ['id', 'personid'] // Only select needed fields
      });
      metrics.bookletQuery = Date.now() - bookletQueryStart;

      if (!booklets || booklets.length === 0) {
        this.logger.log('Keine Booklets für die angegebenen Personen gefunden.');
        await queryRunner.release();
        return statistics;
      }

      // Report progress after step 2
      if (progressCallback) {
        progressCallback(20);
      }

      // Check for cancellation or pause after step 2
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting booklets`);
        await queryRunner.release();
        return statistics;
      }

      // Step 3: Get units - 30% progress
      const bookletIds = booklets.map(booklet => booklet.id);
      const unitQueryStart = Date.now();
      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'bookletid', 'name', 'alias'] // Only select needed fields
      });
      metrics.unitQuery = Date.now() - unitQueryStart;

      if (!units || units.length === 0) {
        this.logger.log('Keine Aufgaben für die angegebenen Testhefte gefunden.');
        await queryRunner.release();
        return statistics;
      }

      // Report progress after step 3
      if (progressCallback) {
        progressCallback(30);
      }

      // Check for cancellation or pause after step 3
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting units`);
        await queryRunner.release();
        return statistics;
      }

      // Step 4: Process units and build maps - 40% progress
      const bookletToUnitsMap = new Map();
      const unitIds = new Set<number>();
      const unitAliasesSet = new Set<string>();

      for (const unit of units) {
        if (!bookletToUnitsMap.has(unit.bookletid)) {
          bookletToUnitsMap.set(unit.bookletid, []);
        }
        bookletToUnitsMap.get(unit.bookletid).push(unit);
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
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after processing units`);
        await queryRunner.release();
        return statistics;
      }

      // Step 5: Get responses - 50% progress
      const responseQueryStart = Date.now();
      const allResponses = await this.responseRepository.find({
        where: { unitid: In(unitIdsArray), status: In([3, 2, 1]) },
        select: ['id', 'unitid', 'variableid', 'value', 'status'] // Only select needed fields
      });
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
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting responses`);
        await queryRunner.release();
        return statistics;
      }

      // Step 6: Get unit variables for filtering - 55% progress
      const unitVariables = await this.workspaceFilesService.getUnitVariableMap(workspace_id);
      const validVariableSets = new Map<string, Set<string>>();
      unitVariables.forEach((vars: Set<string>, unitName: string) => {
        validVariableSets.set(unitName.toUpperCase(), vars);
      });

      const unitIdToNameMap = new Map<number, string>();
      units.forEach(unit => {
        unitIdToNameMap.set(unit.id, unit.name);
      });

      const filteredResponses = allResponses.filter(response => {
        const unitName = unitIdToNameMap.get(response.unitid)?.toUpperCase();
        const validVars = validVariableSets.get(unitName || '');
        return validVars?.has(response.variableid);
      });

      this.logger.log(`Filtered responses: ${allResponses.length} -> ${filteredResponses.length} (removed ${allResponses.length - filteredResponses.length} invalid variable responses)`);

      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after filtering responses`);
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
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after processing responses`);
        await queryRunner.release();
        return statistics;
      }

      // Step 8: Get test files - 70% progress
      const fileQueryStart = Date.now();
      // Use cache for test files
      const fileIdToTestFileMap = await this.getTestFilesWithCache(workspace_id, unitAliasesArray);
      metrics.fileQuery = Date.now() - fileQueryStart;

      // Report progress after step 8
      if (progressCallback) {
        progressCallback(70);
      }

      // Check for cancellation or pause after step 8
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting test files`);
        await queryRunner.release();
        return statistics;
      }

      // Step 9: Extract coding scheme references - 80% progress
      const schemeExtractStart = Date.now();
      const { codingSchemeRefs, unitToCodingSchemeRefMap } = await this.extractCodingSchemeReferences(
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
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after extracting scheme references`);
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
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after parsing coding schemes`);
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
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after processing responses`);
        await queryRunner.release();
        return statistics;
      }

      // Step 12: Update responses in database - 100% progress
      const updateSuccess = await this.updateResponsesInDatabase(
        allCodedResponses,
        queryRunner,
        jobId,
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
      this.logger.log(`Performance metrics for processTestPersonsBatch (total: ${totalTime}ms):
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

      await this.invalidateIncompleteVariablesCache(workspace_id);
      await this.codingStatisticsService.refreshStatistics(workspace_id);

      return statistics;
    } catch (error) {
      this.logger.error('Fehler beim Verarbeiten der Personen:', error);

      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error('Fehler beim Rollback der Transaktion:', rollbackError.message);
      } finally {
        await queryRunner.release();
      }

      return statistics;
    }
  }

  async codeTestPersons(workspace_id: number, testPersonIdsOrGroups: string, autoCoderRun: number = 1): Promise<CodingStatisticsWithJob> {
    this.cleanupCaches();

    if (!workspace_id || !testPersonIdsOrGroups || testPersonIdsOrGroups.trim() === '') {
      this.logger.warn('Ungültige Eingabeparameter: workspace_id oder testPersonIdsOrGroups fehlen.');
      return { totalResponses: 0, statusCounts: {} };
    }

    const groupsOrIds = testPersonIdsOrGroups.split(',').filter(item => item.trim() !== '');
    if (groupsOrIds.length === 0) {
      this.logger.warn('Keine gültigen Gruppen oder Personen-IDs angegeben.');
      return { totalResponses: 0, statusCounts: {} };
    }

    const areAllNumbers = groupsOrIds.every(item => !Number.isNaN(Number(item)));

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
        this.logger.log(`Found ${personIds.length} persons in the specified groups`);

        if (personIds.length === 0) {
          this.logger.warn(`No persons found in groups: ${groupsOrIds.join(', ')}`);
          return {
            totalResponses: 0,
            statusCounts: {},
            message: `No persons found in the selected groups: ${groupsOrIds.join(', ')}`
          };
        }
      } catch (error) {
        this.logger.error(`Error fetching persons for groups: ${error.message}`, error.stack);
        return {
          totalResponses: 0,
          statusCounts: {},
          message: `Error fetching persons for groups: ${error.message}`
        };
      }
    }

    this.logger.log(`Starting job for ${personIds.length} test persons in workspace ${workspace_id}`);

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

  async getManualTestPersons(workspace_id: number, personIds?: string): Promise<Array<ResponseEntity & { unitname: string }>> {
    this.logger.log(
      `Fetching responses for workspace_id = ${workspace_id} ${
        personIds ? `and personIds = ${personIds}` : ''
      }.`
    );

    try {
      const persons = await this.personsRepository.find({
        where: { workspace_id: workspace_id, consider: true }
      });

      if (!persons.length) {
        this.logger.log(`No persons found for workspace_id = ${workspace_id}.`);
        return [];
      }

      const filteredPersons = personIds ?
        persons.filter(person => personIds.split(',').includes(String(person.id))) :
        persons;

      if (!filteredPersons.length) {
        this.logger.log(`No persons match the personIds in workspace_id = ${workspace_id}.`);
        return [];
      }

      const personIdsArray = filteredPersons.map(person => person.id);

      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIdsArray) },
        select: ['id']
      });

      const bookletIds = booklets.map(booklet => booklet.id);

      if (!bookletIds.length) {
        this.logger.log(
          `No booklets found for persons = [${personIdsArray.join(', ')}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const units = await this.unitRepository.find({
        where: { bookletid: In(bookletIds) },
        select: ['id', 'name']
      });

      const unitIdToNameMap = new Map(units.map(unit => [unit.id, unit.name]));
      const unitIds = Array.from(unitIdToNameMap.keys());

      if (!unitIds.length) {
        this.logger.log(
          `No units found for booklets = [${bookletIds.join(', ')}] in workspace_id = ${workspace_id}.`
        );
        return [];
      }

      const responses = await this.responseRepository.find({
        where: {
          unitid: In(unitIds),
          status_v1: In([statusStringToNumber('CODING_INCOMPLETE'), statusStringToNumber('INTENDED_INCOMPLETE'), statusStringToNumber('CODE_SELECTION_PENDING')])
        }
      });

      const enrichedResponses = responses.map(response => ({
        ...response,
        unitname: unitIdToNameMap.get(response.unitid) || 'Unknown Unit'
      }));

      this.logger.log(
        `Fetched ${responses.length} responses for the given criteria in workspace_id = ${workspace_id}.`
      );

      return enrichedResponses;
    } catch (error) {
      this.logger.error(`Failed to fetch responses: ${error.message}`, error.stack);
      throw new Error('Could not retrieve responses. Please check the database connection or query.');
    }
  }

  async getCodingStatistics(workspace_id: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(workspace_id, version);
  }

  async generateCodebook(
    workspaceId: number,
    missingsProfile: number,
    contentOptions: CodeBookContentSetting,
    unitIds: number[]
  ): Promise<Buffer | null> {
    try {
      this.logger.log(`Generating codebook for workspace ${workspaceId} with ${unitIds.length} units`);
      const units = await this.fileUploadRepository.findBy({
        id: In(unitIds)
      });

      if (!units || units.length === 0) {
        this.logger.warn(`No units found for workspace ${workspaceId} with IDs ${unitIds}`);
        return null;
      }

      const unitProperties: UnitPropertiesForCodebook[] = units.map(unit => ({
        id: unit.id,
        key: unit.file_id,
        name: unit.filename,
        scheme: unit.data || ''
      }));

      let missings: Missing[] = [
        {
          code: '999',
          label: 'Missing',
          description: 'Value is missing'
        }
      ];

      if (missingsProfile) {
        const profile = await this.missingsProfilesService.getMissingsProfileDetails(workspaceId, missingsProfile);
        if (profile && profile.missings) {
          try {
            const profileMissings = typeof profile.missings === 'string' ? JSON.parse(profile.missings) : profile.missings;
            if (Array.isArray(profileMissings) && profileMissings.length > 0) {
              missings = profileMissings.map(m => ({
                code: m.code.toString(),
                label: m.label,
                description: m.description
              }));
            }
          } catch (parseError) {
            this.logger.error(`Error parsing missings from profile: ${parseError.message}`, parseError.stack);
          }
        }
      }

      return await CodebookGenerator.generateCodebook(unitProperties, contentOptions, missings);
    } catch (error) {
      this.logger.error(`Error generating codebook for workspace ${workspaceId}: ${error.message}`, error.stack);
      return null;
    }
  }

  async pauseJob(jobId: string): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.pauseJob(jobId);
  }

  async resumeJob(jobId: string): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.resumeJob(jobId);
  }

  async restartJob(jobId: string): Promise<{ success: boolean; message: string; jobId?: string }> {
    return this.bullJobManagementService.restartJob(jobId);
  }

  async getBullJobs(workspaceId: number): Promise<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]> {
    return this.bullJobManagementService.getBullJobs(workspaceId);
  }

  async getVariableAnalysis(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    page: number = 1,
    limit: number = 100,
    unitIdFilter?: string,
    variableIdFilter?: string,
    derivationFilter?: string
  ): Promise<{
      data: VariableAnalysisItemDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    return this.variableAnalysisReplayService.getVariableAnalysis(
      workspace_id,
      authToken,
      serverUrl,
      page,
      limit,
      unitIdFilter,
      variableIdFilter,
      derivationFilter
    );
  }

  async exportValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Promise<Buffer> {
    return this.exportValidationResultsService.exportValidationResultsAsExcel(workspaceId, cacheKey);
  }

  async validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<ValidateCodingCompletenessResponseDto> {
    try {
      this.logger.log(`Validating coding completeness for workspace ${workspaceId} with ${expectedCombinations.length} expected combinations`);
      const startTime = Date.now();

      const combinationsHash = this.generateExpectedCombinationsHash(expectedCombinations);
      const cacheKey = this.cacheService.generateValidationCacheKey(workspaceId, combinationsHash);

      // Try to get paginated results from cache first
      let cachedResults = await this.cacheService.getPaginatedValidationResults(cacheKey, page, pageSize);

      if (cachedResults) {
        this.logger.log(`Returning cached validation results for workspace ${workspaceId} (page ${page})`);
        return {
          results: cachedResults.results,
          total: cachedResults.metadata.total,
          missing: cachedResults.metadata.missing,
          currentPage: cachedResults.metadata.currentPage,
          pageSize: cachedResults.metadata.pageSize,
          totalPages: cachedResults.metadata.totalPages,
          hasNextPage: cachedResults.metadata.hasNextPage,
          hasPreviousPage: cachedResults.metadata.hasPreviousPage,
          cacheKey
        };
      }

      const allResults: ValidationResultDto[] = [];
      let totalMissingCount = 0;

      const batchSize = 100;
      for (let i = 0; i < expectedCombinations.length; i += batchSize) {
        const batch = expectedCombinations.slice(i, i + batchSize);
        this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(expectedCombinations.length / batchSize)}`);

        for (const expected of batch) {
          const responseExists = await this.responseRepository
            .createQueryBuilder('response')
            .innerJoin('response.unit', 'unit')
            .innerJoin('unit.booklet', 'booklet')
            .innerJoin('booklet.person', 'person')
            .innerJoin('booklet.bookletinfo', 'bookletinfo')
            .where('unit.alias = :unitKey', { unitKey: expected.unit_key })
            .andWhere('person.login = :loginName', { loginName: expected.login_name })
            .andWhere('person.code = :loginCode', { loginCode: expected.login_code })
            .andWhere('bookletinfo.name = :bookletId', { bookletId: expected.booklet_id })
            .andWhere('response.variableid = :variableId', { variableId: expected.variable_id })
            .andWhere('response.value IS NOT NULL')
            .andWhere('response.value != :empty', { empty: '' })
            .getCount();

          const status = responseExists > 0 ? 'EXISTS' : 'MISSING';
          if (status === 'MISSING') {
            totalMissingCount += 1;
          }

          allResults.push({
            combination: expected,
            status
          });
        }
      }

      const metadata = {
        total: expectedCombinations.length,
        missing: totalMissingCount,
        timestamp: Date.now()
      };

      const cacheSuccess = await this.cacheService.storeValidationResults(cacheKey, allResults, metadata);

      if (cacheSuccess) {
        this.logger.log(`Successfully cached validation results for workspace ${workspaceId}`);
      } else {
        this.logger.warn(`Failed to cache validation results for workspace ${workspaceId}`);
      }

      cachedResults = await this.cacheService.getPaginatedValidationResults(cacheKey, page, pageSize);

      const endTime = Date.now();
      this.logger.log(`Validation completed in ${endTime - startTime}ms. Processed all ${expectedCombinations.length} combinations with ${totalMissingCount} missing responses.`);

      if (cachedResults) {
        return {
          results: cachedResults.results,
          total: cachedResults.metadata.total,
          missing: cachedResults.metadata.missing,
          currentPage: cachedResults.metadata.currentPage,
          pageSize: cachedResults.metadata.pageSize,
          totalPages: cachedResults.metadata.totalPages,
          hasNextPage: cachedResults.metadata.hasNextPage,
          hasPreviousPage: cachedResults.metadata.hasPreviousPage,
          cacheKey
        };
      }

      const totalPages = Math.ceil(expectedCombinations.length / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, expectedCombinations.length);
      const paginatedResults = allResults.slice(startIndex, endIndex);

      return {
        results: paginatedResults,
        total: expectedCombinations.length,
        missing: totalMissingCount,
        currentPage: page,
        pageSize,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        cacheKey
      };
    } catch (error) {
      this.logger.error(`Error validating coding completeness: ${error.message}`, error.stack);
      throw new Error('Could not validate coding completeness. Please check the database connection or query.');
    }
  }

  async getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string
  ): Promise<{ unitName: string; variableId: string; responseCount: number }[]> {
    try {
      if (unitName) {
        this.logger.log(`Querying CODING_INCOMPLETE variables for workspace ${workspaceId} and unit ${unitName} (not cached)`);
        return await this.fetchCodingIncompleteVariablesFromDb(workspaceId, unitName);
      }
      const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
      const cachedResult = await this.cacheService.get<{ unitName: string; variableId: string; responseCount: number }[]>(cacheKey);
      if (cachedResult) {
        this.logger.log(`Retrieved ${cachedResult.length} CODING_INCOMPLETE variables from cache for workspace ${workspaceId}`);
        return cachedResult;
      }
      this.logger.log(`Cache miss: Querying CODING_INCOMPLETE variables for workspace ${workspaceId}`);
      const result = await this.fetchCodingIncompleteVariablesFromDb(workspaceId);

      const cacheSet = await this.cacheService.set(cacheKey, result, 0);
      if (cacheSet) {
        this.logger.log(`Cached ${result.length} CODING_INCOMPLETE variables for workspace ${workspaceId}`);
      } else {
        this.logger.warn(`Failed to cache CODING_INCOMPLETE variables for workspace ${workspaceId}`);
      }
      return result;
    } catch (error) {
      this.logger.error(`Error getting CODING_INCOMPLETE variables: ${error.message}`, error.stack);
      throw new Error('Could not get CODING_INCOMPLETE variables. Please check the database connection.');
    }
  }

  private async fetchCodingIncompleteVariablesFromDb(
    workspaceId: number,
    unitName?: string
  ): Promise<{ unitName: string; variableId: string; responseCount: number }[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('COUNT(response.id)', 'responseCount')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId });

    if (unitName) {
      queryBuilder.andWhere('unit.name = :unitName', { unitName });
    }

    queryBuilder
      .groupBy('unit.name')
      .addGroupBy('response.variableid');

    const rawResults = await queryBuilder.getRawMany();

    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitNameKey: string) => {
      validVariableSets.set(unitNameKey.toUpperCase(), variables);
    });

    const filteredResult = rawResults.filter(row => {
      const unitNamesValidVars = validVariableSets.get(row.unitName?.toUpperCase());
      return unitNamesValidVars?.has(row.variableId);
    });

    const result = filteredResult.map(row => ({
      unitName: row.unitName,
      variableId: row.variableId,
      responseCount: parseInt(row.responseCount, 10)
    }));

    this.logger.log(`Found ${rawResults.length} CODING_INCOMPLETE variable groups, filtered to ${filteredResult.length} valid variables${unitName ? ` for unit ${unitName}` : ''}`);

    return result;
  }

  private generateIncompleteVariablesCacheKey(workspaceId: number): string {
    return `coding_incomplete_variables:${workspaceId}`;
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated CODING_INCOMPLETE variables cache for workspace ${workspaceId}`);
  }

  async importExternalCodingWithProgress(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback: (progress: number, message: string) => void
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    return this.externalCodingImportService.importExternalCodingWithProgress(workspaceId, body, progressCallback);
  }

  async importExternalCoding(
    workspaceId: number,
    body: ExternalCodingImportBody
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    return this.externalCodingImportService.importExternalCoding(workspaceId, body);
  }

  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100
  ): Promise<{
      data: ResponseEntity[];
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      const statusNumber = statusStringToNumber(status);
      if (statusNumber === null) {
        this.logger.warn(`Invalid status string: ${status}`);
        return {
          data: [], total: 0, page, limit
        };
      }

      const offset = (page - 1) * limit;

      const selectFields = [
        'response.id',
        'response.unitId',
        'response.variableid',
        'response.value',
        'response.status',
        'response.codedstatus'
      ];

      selectFields.push('response.code_v1', 'response.score_v1');
      selectFields.push('response.code_v2', 'response.score_v2');
      selectFields.push('response.code_v3', 'response.score_v3');
      selectFields.push('response.status_v1', 'response.status_v2', 'response.status_v3');

      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .select(selectFields)
        .where('person.workspace_id = :workspaceId', { workspaceId });

      switch (version) {
        case 'v1':
          queryBuilder.andWhere('response.status_v1 = :status', { status: statusNumber });
          break;
        case 'v2':
          queryBuilder.andWhere('response.status_v2 = :status', { status: statusNumber });
          break;
        case 'v3':
          queryBuilder.andWhere('response.status_v3 = :status', { status: statusNumber });
          break;
        default:
          queryBuilder.andWhere('response.status_v1 = :status', { status: statusNumber });
          break;
      }

      const total = await queryBuilder.getCount();
      const data = await queryBuilder
        .orderBy('response.id', 'ASC')
        .skip(offset)
        .take(limit)
        .getMany();

      this.logger.log(`Retrieved ${data.length} responses with status ${status} for version ${version} in workspace ${workspaceId}`);

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(`Error getting responses by status: ${error.message}`, error.stack);
      throw new Error('Could not retrieve responses. Please check the database connection or query.');
    }
  }

  async applyCodingResults(workspaceId: number, codingJobId: number): Promise<{
    success: boolean;
    updatedResponsesCount: number;
    skippedReviewCount: number;
    message: string;
  }> {
    return this.codingResultsService.applyCodingResults(workspaceId, codingJobId);
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
    }
  ): Promise<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    return this.codingJobService.createDistributedCodingJobs(workspaceId, request);
  }

  private getLatestCode(response: ResponseEntity): { code: number | null; score: number | null; version: string } {
    // Priority: v3 > v2 > v1
    if (response.code_v3 !== null && response.code_v3 !== undefined) {
      return { code: response.code_v3, score: response.score_v3, version: 'v3' };
    }
    if (response.code_v2 !== null && response.code_v2 !== undefined) {
      return { code: response.code_v2, score: response.score_v2, version: 'v2' };
    }
    return { code: response.code_v1, score: response.score_v1, version: 'v1' };
  }

  private generateUniqueWorksheetName(workbook: ExcelJS.Workbook, baseName: string): string {
    // Clean the base name and limit to 20 characters initially
    // First decode any URL encoding, then replace special characters with underscores
    let cleanName = decodeURIComponent(baseName).replace(/[^a-zA-Z0-9\s\-_]/g, '_').substring(0, 20).trim();

    // If empty after cleaning, use a default
    if (!cleanName) {
      cleanName = 'Sheet';
    }

    let finalName = cleanName;
    let counter = 1;

    // Keep trying until we find a unique name
    while (workbook.getWorksheet(finalName)) {
      const suffix = `_${counter}`;
      const availableLength = 31 - suffix.length; // Excel limit is 31 chars
      finalName = cleanName.substring(0, availableLength) + suffix;
      counter += 1;

      // Safety check to prevent infinite loop
      if (counter > 1000) {
        finalName = `Sheet_${Date.now()}`;
        break;
      }
    }

    return finalName;
  }

  async exportCodingResultsAggregated(workspaceId: number): Promise<Buffer> {
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId}`);

    try {
      // Get all responses with coding data
      const responses = await this.responseRepository.find({
        where: { },
        relations: ['unit', 'unit.booklet', 'unit.booklet.person', 'unit.booklet.bookletinfo'],
        select: {
          id: true,
          variableid: true,
          code_v1: true,
          score_v1: true,
          code_v2: true,
          score_v2: true,
          code_v3: true,
          score_v3: true,
          unit: {
            id: true,
            name: true,
            alias: true,
            booklet: {
              id: true,
              person: {
                id: true,
                login: true,
                code: true,
                group: true
              },
              bookletinfo: {
                id: true,
                name: true
              }
            }
          }
        }
      });

      // Filter responses that belong to the workspace and have coding data
      const workspaceResponses = responses.filter(response => {
        const person = response.unit?.booklet?.person;
        return person?.workspace_id === workspaceId &&
               (response.code_v1 !== null || response.code_v2 !== null || response.code_v3 !== null);
      });

      if (workspaceResponses.length === 0) {
        throw new Error('No coded responses found for this workspace');
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding Results');

      // Create pivot table: testpersons as rows, variables as columns
      const testPersonMap = new Map<string, Map<string, { code: number | null; score: number | null }>>();
      const variableSet = new Set<string>();
      const testPersonList: string[] = [];

      // Collect all data
      for (const response of workspaceResponses) {
        const person = response.unit?.booklet?.person;
        const testPersonKey = `${person?.login}_${person?.code}`;
        const variableId = response.variableid;
        const latestCoding = this.getLatestCode(response);

        if (!testPersonMap.has(testPersonKey)) {
          testPersonMap.set(testPersonKey, new Map());
          testPersonList.push(testPersonKey);
        }

        testPersonMap.get(testPersonKey)!.set(variableId, {
          code: latestCoding.code,
          score: latestCoding.score
        });
        variableSet.add(variableId);
      }

      const variables = Array.from(variableSet).sort();

      // Set up headers
      const headers = ['Test Person Login', 'Test Person Code', 'Group', ...variables];
      worksheet.columns = headers.map(header => ({ header, key: header, width: 15 }));

      // Add data rows
      for (const testPersonKey of testPersonList) {
        const [login, code] = testPersonKey.split('_');
        const personData = testPersonMap.get(testPersonKey)!;

        // Find group for this test person
        const group = workspaceResponses.find(r => r.unit?.booklet?.person?.login === login &&
          r.unit?.booklet?.person?.code === code
        )?.unit?.booklet?.person?.group || '';

        const row: Record<string, string | number | null> = {
          'Test Person Login': login,
          'Test Person Code': code,
          Group: group
        };

        for (const variable of variables) {
          const coding = personData.get(variable);
          row[variable] = coding?.code ?? '';
        }

        worksheet.addRow(row);
      }

      // Style the header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting aggregated coding results: ${error.message}`, error.stack);
      throw new Error('Could not export aggregated coding results. Please check the database connection or query.');
    }
  }

  async exportCodingResultsByCoder(workspaceId: number): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}`);

    try {
      // Get coding jobs with their assignments
      const codingJobs = await this.codingJobRepository.find({
        where: { workspace_id: workspaceId },
        relations: ['codingJobCoders', 'codingJobCoders.user', 'codingJobUnits', 'codingJobUnits.response', 'codingJobUnits.response.unit']
      });

      if (codingJobs.length === 0) {
        throw new Error('No coding jobs found for this workspace');
      }

      // Get coding job variables separately
      const jobIds = codingJobs.map(job => job.id);
      const codingJobVariables = await this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      });

      // Group variables by job ID
      const variablesByJobId = new Map<number, CodingJobVariable[]>();
      codingJobVariables.forEach(variable => {
        if (!variablesByJobId.has(variable.coding_job_id)) {
          variablesByJobId.set(variable.coding_job_id, []);
        }
        variablesByJobId.get(variable.coding_job_id)!.push(variable);
      });

      const workbook = new ExcelJS.Workbook();

      // Group jobs by coder
      const coderJobs = new Map<string, CodingJob[]>();

      for (const job of codingJobs) {
        for (const jobCoder of job.codingJobCoders) {
          const coderKey = `${jobCoder.user.username}_${jobCoder.user.id}`;
          if (!coderJobs.has(coderKey)) {
            coderJobs.set(coderKey, []);
          }
          coderJobs.get(coderKey)!.push(job);
        }
      }

      // Create a sheet for each coder
      for (const [coderKey, jobs] of coderJobs) {
        const [coderName] = coderKey.split('_');
        const worksheetName = this.generateUniqueWorksheetName(workbook, coderName);
        const worksheet = workbook.addWorksheet(worksheetName);

        // Collect all variables and testpersons for this coder
        const variableSet = new Set<string>();
        const testPersonMap = new Map<string, Map<string, { code: number | null; score: number | null }>>();
        const testPersonList: string[] = [];

        for (const job of jobs) {
          // Get responses for this job's variables and units
          const unitIds = job.codingJobUnits.map(ju => ju.response?.unit?.id).filter((id): id is number => id !== undefined);
          const jobVariables = variablesByJobId.get(job.id) || [];
          const variableIds = jobVariables.map(jv => jv.variable_id);

          if (unitIds.length === 0 || variableIds.length === 0) continue;

          const responses = await this.responseRepository.find({
            where: {
              unitid: In(unitIds),
              variableid: In(variableIds)
            },
            relations: ['unit', 'unit.booklet', 'unit.booklet.person'],
            select: {
              id: true,
              variableid: true,
              code_v1: true,
              score_v1: true,
              code_v2: true,
              score_v2: true,
              code_v3: true,
              score_v3: true,
              unit: {
                id: true,
                booklet: {
                  id: true,
                  person: {
                    id: true,
                    login: true,
                    code: true,
                    group: true
                  }
                }
              }
            }
          });

          for (const response of responses) {
            const person = response.unit?.booklet?.person;
            const testPersonKey = `${person?.login}_${person?.code}`;
            const variableId = response.variableid;
            const latestCoding = this.getLatestCode(response);

            if (!testPersonMap.has(testPersonKey)) {
              testPersonMap.set(testPersonKey, new Map());
              testPersonList.push(testPersonKey);
            }

            testPersonMap.get(testPersonKey)!.set(variableId, {
              code: latestCoding.code,
              score: latestCoding.score
            });
            variableSet.add(variableId);
          }
        }

        const variables = Array.from(variableSet).sort();

        if (variables.length === 0) continue;

        // Set up headers
        const headers = ['Test Person Login', 'Test Person Code', 'Group', ...variables];
        worksheet.columns = headers.map(header => ({ header, key: header, width: 15 }));

        // Add data rows
        for (const testPersonKey of testPersonList) {
          const [login, code] = testPersonKey.split('_');
          const personData = testPersonMap.get(testPersonKey)!;

          // Find group for this test person
          const group = Array.from(testPersonMap.values()).find((data: Map<string, { code: number | null; score: number | null }>) => data.has(variables[0])
          ) ? 'Group' : ''; // Simplified - would need to look up actual group

          const row: Record<string, string | number | null> = {
            'Test Person Login': login,
            'Test Person Code': code,
            Group: group
          };

          for (const variable of variables) {
            const coding = personData.get(variable);
            row[variable] = coding?.code ?? '';
          }

          worksheet.addRow(row);
        }

        // Style the header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding results by coder: ${error.message}`, error.stack);
      throw new Error('Could not export coding results by coder. Please check the database connection or query.');
    }
  }

  async exportCodingResultsByVariable(workspaceId: number): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}`);

    try {
      // Get all unique variables in the workspace
      const variableResults = await this.responseRepository
        .createQueryBuilder('response')
        .select('DISTINCT response.variableid', 'variableId')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('(response.code_v1 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.code_v3 IS NOT NULL)')
        .getRawMany();

      const variables = variableResults.map((row: { variableId: string }) => row.variableId).sort();

      if (variables.length === 0) {
        throw new Error('No coded variables found for this workspace');
      }

      const workbook = new ExcelJS.Workbook();

      // Create a sheet for each variable
      for (const variableId of variables) {
        const worksheetName = this.generateUniqueWorksheetName(workbook, variableId);
        const worksheet = workbook.addWorksheet(worksheetName);

        // Get all responses for this variable
        const responses = await this.responseRepository.find({
          where: { variableid: variableId },
          relations: ['unit', 'unit.booklet', 'unit.booklet.person'],
          select: {
            id: true,
            code_v1: true,
            score_v1: true,
            code_v2: true,
            score_v2: true,
            code_v3: true,
            score_v3: true,
            unit: {
              id: true,
              booklet: {
                id: true,
                person: {
                  id: true,
                  login: true,
                  code: true,
                  group: true
                }
              }
            }
          }
        });

        // Filter responses that belong to this workspace
        const workspaceResponses = responses.filter(response => {
          const person = response.unit?.booklet?.person;
          return person?.workspace_id === workspaceId;
        });

        if (workspaceResponses.length === 0) continue;

        // Create pivot: testpersons as rows, coders as columns
        const testPersonMap = new Map<string, Map<string, { code: number | null; score: number | null }>>();
        const testPersonList: string[] = [];

        for (const response of workspaceResponses) {
          const person = response.unit?.booklet?.person;
          const testPersonKey = `${person?.login}_${person?.code}`;
          const coderKey = testPersonKey; // In this context, each testperson represents a "coder" who provided the coding
          const latestCoding = this.getLatestCode(response);

          if (!testPersonMap.has(testPersonKey)) {
            testPersonMap.set(testPersonKey, new Map());
            testPersonList.push(testPersonKey);
          }

          testPersonMap.get(testPersonKey)!.set(coderKey, {
            code: latestCoding.code,
            score: latestCoding.score
          });
        }

        // Set up headers
        const headers = ['Test Person Login', 'Test Person Code', 'Group', ...testPersonList.map(tp => `Coder_${tp}`)];
        worksheet.columns = headers.map(header => ({ header, key: header, width: 15 }));

        // Add data rows (one row per testperson who has this variable)
        for (const testPersonKey of testPersonList) {
          const [login, code] = testPersonKey.split('_');
          const personData = testPersonMap.get(testPersonKey)!;

          // Find group for this test person
          const group = workspaceResponses.find(r => `${r.unit?.booklet?.person?.login}_${r.unit?.booklet?.person?.code}` === testPersonKey
          )?.unit?.booklet?.person?.group || '';

          const row: Record<string, string | number | null> = {
            'Test Person Login': login,
            'Test Person Code': code,
            Group: group
          };

          for (const coderKey of testPersonList) {
            const coding = personData.get(coderKey);
            row[`Coder_${coderKey}`] = coding?.code ?? '';
          }

          worksheet.addRow(row);
        }

        // Style the header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding results by variable: ${error.message}`, error.stack);
      throw new Error('Could not export coding results by variable. Please check the database connection or query.');
    }
  }
}
