import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CodingScheme } from '@iqbspecs/coding-scheme/coding-scheme.interface';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import { statusNumberToString, statusStringToNumber } from '../utils/response-status-converter';
import { CacheService } from '../../cache/cache.service';
import { MissingsProfilesService } from './missings-profiles.service';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { Setting } from '../entities/setting.entity';
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

interface CodedResponse {
  id: number;
  code_v1?: number;
  status_v1?: number;
  score_v1?: number;
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
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService,
    private missingsProfilesService: MissingsProfilesService,
    private codingStatisticsService: CodingStatisticsService,
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private externalCodingImportService: ExternalCodingImportService,
    private bullJobManagementService: BullJobManagementService
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
            const updatePromises = batch.map(response => queryRunner.manager.update(
              ResponseEntity,
              response.id,
              {
                code_v1: response?.code_v1,
                status_v1: statusStringToNumber(response?.status_v1),
                score_v1: response?.score_v1
              }
            ));

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
    unitToResponsesMap: Map<number, ResponseEntity[]>,
    unitToCodingSchemeRefMap: Map<number, string>,
    fileIdToCodingSchemeMap: Map<string, CodingScheme>,
    allResponses: ResponseEntity[],
    statistics: CodingStatistics,
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
          const codedResult = Autocoder.CodingFactory.code({
            id: response.variableid,
            value: response.value,
            status: statusNumberToString(response.status) || 'UNSET'
          }, scheme.variableCodings[0]);
          const codedStatus = codedResult?.status;
          if (!statistics.statusCounts[codedStatus]) {
            statistics.statusCounts[codedStatus] = 0;
          }
          statistics.statusCounts[codedStatus] += 1;

          allCodedResponses[responseIndex] = {
            id: response.id,
            code_v1: codedResult?.code,
            status_v1: codedStatus,
            score_v1: codedResult?.score
          };
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
        this.logger.log('Keine Einheiten für die angegebenen Booklets gefunden.');
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

      // Step 6: Process responses and build maps - 60% progress
      const unitToResponsesMap = new Map();
      for (const response of allResponses) {
        if (!unitToResponsesMap.has(response.unitid)) {
          unitToResponsesMap.set(response.unitid, []);
        }
        unitToResponsesMap.get(response.unitid).push(response);
      }

      // Report progress after step 6
      if (progressCallback) {
        progressCallback(60);
      }

      // Check for cancellation or pause after step 6
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after processing responses`);
        await queryRunner.release();
        return statistics;
      }

      // Step 7: Get test files - 70% progress
      const fileQueryStart = Date.now();
      // Use cache for test files
      const fileIdToTestFileMap = await this.getTestFilesWithCache(workspace_id, unitAliasesArray);
      metrics.fileQuery = Date.now() - fileQueryStart;

      // Report progress after step 7
      if (progressCallback) {
        progressCallback(70);
      }

      // Check for cancellation or pause after step 7
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting test files`);
        await queryRunner.release();
        return statistics;
      }

      // Step 8: Extract coding scheme references - 80% progress
      const schemeExtractStart = Date.now();
      const { codingSchemeRefs, unitToCodingSchemeRefMap } = await this.extractCodingSchemeReferences(
        units,
        fileIdToTestFileMap,
        jobId,
        queryRunner
      );
      metrics.schemeExtract = Date.now() - schemeExtractStart;

      // Report progress after step 8
      if (progressCallback) {
        progressCallback(80);
      }

      // Check for cancellation or pause after step 8
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after extracting scheme references`);
        await queryRunner.release();
        return statistics;
      }

      // Step 9: Get coding scheme files - 85% progress
      const schemeQueryStart = Date.now();
      const fileIdToCodingSchemeMap = await this.getCodingSchemeFiles(
        codingSchemeRefs,
        jobId,
        queryRunner
      );
      metrics.schemeQuery = Date.now() - schemeQueryStart;
      // No separate parsing step needed as it's handled by the cache helper
      metrics.schemeParsing = 0;

      // Report progress after step 9
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
        allResponses,
        statistics,
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

      // Log performance metrics
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

      // Ensure transaction is rolled back on error
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

  async codeTestPersons(workspace_id: number, testPersonIdsOrGroups: string): Promise<CodingStatisticsWithJob> {
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
      // Input contains group names, fetch all persons in these groups
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

    // Always process as a job, regardless of the number of test persons
    this.logger.log(`Starting job for ${personIds.length} test persons in workspace ${workspace_id}`);

    // Add the job to the Redis queue
    const bullJob = await this.jobQueueService.addTestPersonCodingJob({
      workspaceId: workspace_id,
      personIds,
      groupNames: !areAllNumbers ? groupsOrIds.join(',') : undefined
    });

    this.logger.log(`Added job to Redis queue with ID ${bullJob.id}`);

    return {
      totalResponses: 0,
      statusCounts: {},
      jobId: bullJob.id.toString(),
      message: `Processing ${personIds.length} test persons in the background. Check job status with jobId: ${bullJob.id}`
    };
  }

  async getManualTestPersons(workspace_id: number, personIds?: string): Promise<unknown> {
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

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(workspace_id);
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
          cacheKey // Include cache key in response for subsequent requests
        };
      }

      this.logger.log(`No cached results found. Processing all ${expectedCombinations.length} combinations for workspace ${workspaceId}`);

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
  ): Promise<{ unitName: string; variableId: string }[]> {
    try {
      if (unitName) {
        // If filtering by unit name, we can't use cache (would require complex cache indexing)
        this.logger.log(`Querying CODING_INCOMPLETE variables for workspace ${workspaceId} and unit ${unitName} (not cached)`);
        return await this.fetchCodingIncompleteVariablesFromDb(workspaceId, unitName);
      }

      // Try to get from cache first
      const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
      const cachedResult = await this.cacheService.get<{ unitName: string; variableId: string }[]>(cacheKey);

      if (cachedResult) {
        this.logger.log(`Retrieved ${cachedResult.length} CODING_INCOMPLETE variables from cache for workspace ${workspaceId}`);
        return cachedResult;
      }

      // Not in cache, fetch from database
      this.logger.log(`Cache miss: Querying CODING_INCOMPLETE variables for workspace ${workspaceId}`);
      const result = await this.fetchCodingIncompleteVariablesFromDb(workspaceId);

      // Cache the result for 1 hour (3600 seconds)
      const cacheSet = await this.cacheService.set(cacheKey, result, 3600);
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
  ): Promise<{ unitName: string; variableId: string }[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .distinct()
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId });

    if (unitName) {
      queryBuilder.andWhere('unit.name = :unitName', { unitName });
    }

    const rawResults = await queryBuilder.getRawMany();

    const result = rawResults.map(row => ({
      unitName: row.unitName,
      variableId: row.variableId
    }));

    this.logger.log(`Found ${result.length} unique CODING_INCOMPLETE variables${unitName ? ` for unit ${unitName}` : ''}`);

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
}
