import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import * as crypto from 'crypto';
import { ResponseStatusType } from '@iqb/responses';
import { CacheService } from '../../cache/cache.service';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { Setting } from '../entities/setting.entity';
import { CodingStatistics, CodingStatisticsWithJob } from './shared-types';
import { extractVariableLocation } from '../../utils/voud/extractVariableLocation';
import { CodebookGenerator } from '../../admin/code-book/codebook-generator.class';
import { CodeBookContentSetting, UnitPropertiesForCodebook, Missing } from '../../admin/code-book/codebook.interfaces';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';

interface CodedResponse {
  id: number;
  code?: string;
  codedstatus?: string;
  score?: number;
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
    private cacheService: CacheService
  ) {}

  private codingSchemeCache: Map<string, { scheme: Autocoder.CodingScheme; timestamp: number }> = new Map();
  private readonly SCHEME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL

  private testFileCache: Map<number, { files: Map<string, FileUpload>; timestamp: number }> = new Map();
  private readonly TEST_FILE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache TTL

  /**
   * Generate a hash for expected combinations to create unique cache keys
   * @param expectedCombinations Array of expected combinations
   * @returns Hash string for cache key generation
   */
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

      // Check if all requested unit aliases are in the cache
      const missingAliases = unitAliasesArray.filter(alias => !cacheEntry.files.has(alias));

      if (missingAliases.length === 0) {
        // All files are in the cache, return the cached files
        return cacheEntry.files;
      }

      // Some files are missing, fetch only the missing ones
      this.logger.log(`Fetching ${missingAliases.length} missing test files for workspace ${workspace_id}`);
      const missingFiles = await this.fileUploadRepository.find({
        where: { workspace_id, file_id: In(missingAliases) },
        select: ['file_id', 'data', 'filename']
      });

      // Add the missing files to the cache
      missingFiles.forEach(file => {
        cacheEntry.files.set(file.file_id, file);
      });

      // Update the timestamp
      cacheEntry.timestamp = now;

      return cacheEntry.files;
    }

    // No valid cache entry, fetch all files
    this.logger.log(`Fetching all test files for workspace ${workspace_id}`);
    const testFiles = await this.fileUploadRepository.find({
      where: { workspace_id, file_id: In(unitAliasesArray) },
      select: ['file_id', 'data', 'filename']
    });

    // Create a new cache entry
    const fileMap = new Map<string, FileUpload>();
    testFiles.forEach(file => {
      fileMap.set(file.file_id, file);
    });

    // Store in cache
    this.testFileCache.set(workspace_id, { files: fileMap, timestamp: now });

    return fileMap;
  }

  private async getCodingSchemesWithCache(codingSchemeRefs: string[]): Promise<Map<string, Autocoder.CodingScheme>> {
    const now = Date.now();
    const result = new Map<string, Autocoder.CodingScheme>();
    const emptyScheme = new Autocoder.CodingScheme({});

    // Check which schemes are in the cache and still valid
    const missingSchemeRefs = codingSchemeRefs.filter(ref => {
      const cacheEntry = this.codingSchemeCache.get(ref);
      if (cacheEntry && (now - cacheEntry.timestamp) < this.SCHEME_CACHE_TTL_MS) {
        // Scheme is in cache and still valid
        result.set(ref, cacheEntry.scheme);
        return false;
      }
      return true;
    });

    if (missingSchemeRefs.length === 0) {
      // All schemes are in the cache
      this.logger.log('Using all cached coding schemes');
      return result;
    }

    // Fetch missing schemes
    this.logger.log(`Fetching ${missingSchemeRefs.length} missing coding schemes`);
    const codingSchemeFiles = await this.fileUploadRepository.find({
      where: { file_id: In(missingSchemeRefs) },
      select: ['file_id', 'data', 'filename']
    });

    // Parse and cache the schemes
    codingSchemeFiles.forEach(file => {
      try {
        const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = new Autocoder.CodingScheme(data);

        // Store in result map
        result.set(file.file_id, scheme);

        // Store in cache
        this.codingSchemeCache.set(file.file_id, { scheme, timestamp: now });
      } catch (error) {
        this.logger.error(`--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`);
        // Use empty scheme for invalid schemes
        result.set(file.file_id, emptyScheme);
      }
    });

    return result;
  }

  private cleanupCaches(): void {
    const now = Date.now();

    // Clean up coding scheme cache
    for (const [key, entry] of this.codingSchemeCache.entries()) {
      if (now - entry.timestamp > this.SCHEME_CACHE_TTL_MS) {
        this.codingSchemeCache.delete(key);
      }
    }

    // Clean up test file cache
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
        bullJob = await this.jobQueueService.getCodingStatisticsJob(jobId) as any;
      }

      if (bullJob) {
        // Get job state and progress
        const state = await bullJob.getState();
        const progress = await bullJob.progress() || 0;

        // Map Bull job state to our job status
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

        // Get result from job return value if completed
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
      const job = await this.jobQueueService.addCodingStatisticsJob(workspaceId);
      this.logger.log(`Created coding statistics job ${job.id} for workspace ${workspaceId}`);
      return { jobId: job.id.toString(), message: 'Coding statistics job created' };
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

      // Check if job can be cancelled
      const state = await bullJob.getState();
      if (state === 'completed' || state === 'failed') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${state}`
        };
      }

      // Cancel the job
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

      // Delete the job
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
      // Check Redis queue
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId.toString());
      if (bullJob) {
        // Check if job is paused via our custom isPaused property
        if (bullJob.data.isPaused) {
          return true;
        }

        // Also check Bull's native state
        const state = await bullJob.getState();
        return state === 'paused';
      }
      return false;
    } catch (error) {
      this.logger.error(`Error checking job cancellation or pause: ${error.message}`, error.stack);
      return false; // Assume not cancelled or paused on error
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

        // Check for cancellation or pause before updating batch
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
                code: response.code,
                codedstatus: response.codedstatus,
                score: response.score
              }
            ));

            await Promise.all(updatePromises);
          }

          this.logger.log(`Batch #${index + 1} (Größe: ${batch.length}) erfolgreich aktualisiert.`);

          // Update progress during batch updates
          if (progressCallback) {
            const batchProgress = 95 + (5 * ((index + 1) / batches.length));
            progressCallback(Math.round(Math.min(batchProgress, 99))); // Cap at 99% until fully complete and round to integer
          }
        } catch (error) {
          this.logger.error(`Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${batch.length}):`, error.message);
          // Rollback transaction on error
          await queryRunner.rollbackTransaction();
          await queryRunner.release();
          return false;
        }
      }

      // Commit transaction if all updates were successful
      await queryRunner.commitTransaction();
      this.logger.log(`${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`);

      if (metrics) {
        metrics.update = Date.now() - updateStart;
      }

      // Always release the query runner
      await queryRunner.release();
      return true;
    } catch (error) {
      this.logger.error('Fehler beim Aktualisieren der Responses:', error.message);
      // Ensure transaction is rolled back on error
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error('Fehler beim Rollback der Transaktion:', rollbackError.message);
      }
      // Always release the query runner
      await queryRunner.release();
      return false;
    }
  }

  private async processAndCodeResponses(
    units: Unit[],
    unitToResponsesMap: Map<number, ResponseEntity[]>,
    unitToCodingSchemeRefMap: Map<number, string>,
    fileIdToCodingSchemeMap: Map<string, Autocoder.CodingScheme>,
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
    const emptyScheme = new Autocoder.CodingScheme({});

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
          const codedResult = scheme.code([{
            id: response.variableid,
            value: response.value,
            status: response.status as ResponseStatusType
          }]);

          const codedStatus = codedResult[0]?.status;
          if (!statistics.statusCounts[codedStatus]) {
            statistics.statusCounts[codedStatus] = 0;
          }
          statistics.statusCounts[codedStatus] += 1;

          allCodedResponses[responseIndex] = {
            id: response.id,
            code: codedResult[0]?.code,
            codedstatus: codedStatus,
            score: codedResult[0]?.score
          };
          responseIndex += 1;
        }
      }

      // Check for cancellation or pause during response processing
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused during response processing`);
        if (queryRunner) {
          await queryRunner.release();
        }
        return { allCodedResponses, statistics };
      }
    }

    allCodedResponses.length = responseIndex;

    // Report progress after processing
    if (progressCallback) {
      progressCallback(95);
    }

    return { allCodedResponses, statistics };
  }

  private async getCodingSchemeFiles(
    codingSchemeRefs: Set<string>,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner
  ): Promise<Map<string, Autocoder.CodingScheme>> {
    // Use cache for coding schemes
    const fileIdToCodingSchemeMap = await this.getCodingSchemesWithCache([...codingSchemeRefs]);

    // Check for cancellation or pause
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

      // Check for cancellation or pause during scheme extraction
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
    // Clean up expired cache entries
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

    // Check for cancellation or pause before starting work
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
        where: { unitid: In(unitIdsArray), status: In(['VALUE_CHANGED']) },
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
        // If update failed, return early
        return statistics;
      }

      // Report completion
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

    // Check if the input contains groups or person IDs
    // If all items can be parsed as numbers, they are person IDs
    // Otherwise, they are group names
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
          codedstatus: In(['CODING_INCOMPLETE', 'INTENDED_INCOMPLETE', 'CODE_SELECTION_PENDING'])
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

  async getCodingList(workspace_id: number, authToken: string, serverUrl?: string, options?: { page: number; limit: number }): Promise<[{
    unit_key: string;
    unit_alias: string;
    login_name: string;
    login_code: string;
    booklet_id: string;
    variable_id: string;
    variable_page: string;
    variable_anchor: string;
    url: string;
  }[], number]> {
    try {
      const server = serverUrl;

      const voudFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspace_id,
          file_type: 'Resource',
          filename: Like('%.voud')
        }
      });

      this.logger.log(`Found ${voudFiles.length} VOUD files for workspace ${workspace_id}`);

      const voudFileMap = new Map<string, FileUpload>();
      voudFiles.forEach(file => {
        voudFileMap.set(file.file_id, file);
      });
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 10000000;
        const validPage = Math.max(1, page);
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
        const queryBuilder = this.responseRepository.createQueryBuilder('response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where('response.codedStatus = :status', { status: 'CODING_INCOMPLETE' })
          .andWhere('person.workspace_id = :workspace_id', { workspace_id })
          .skip((validPage - 1) * validLimit)
          .take(MAX_LIMIT) // Set a very high limit to fetch all items
          .orderBy('response.id', 'ASC');

        const [responses, total] = await queryBuilder.getManyAndCount();

        const result = await Promise.all(responses.map(async response => {
          const unit = response.unit;
          const booklet = unit?.booklet;
          const person = booklet?.person;
          const bookletInfo = booklet?.bookletinfo;
          const loginName = person?.login || '';
          const loginCode = person?.code || '';
          // const loginGroup = person.group || '';
          const bookletId = bookletInfo?.name || '';
          const unitKey = unit?.name || '';
          const unitAlias = unit?.alias || '';
          let variablePage = '0';
          const variableAnchor = response.variableid || 0;
          const voudFile = voudFileMap.get(`${unitKey}.VOUD`);
          if (voudFile) {
            try {
              const respDefinition = {
                definition: voudFile.data
              };
              // const transformResult = prepareDefinition(respDefinition);
              const variableLocation = extractVariableLocation([respDefinition]);
              const variablePageInfo = variableLocation[0].variable_pages.find(
                pageInfo => pageInfo.variable_ref === response.variableid
              );
              const variablePageAlwaysVisible = variableLocation[0].variable_pages.find(
                pageInfo => pageInfo.variable_page_always_visible === true
              );

              if (variablePageInfo) {
                if (variablePageAlwaysVisible && variablePageInfo.variable_page_always_visible === true) {
                  variablePage = (variablePageInfo.variable_path.pages - 1).toString();
                }
                variablePage = variablePageInfo?.variable_path?.pages.toString();
              }

              this.logger.log(`Processed VOUD file for unit ${unitKey}, variable ${response.variableid}, page ${variablePage}`);
            } catch (error) {
              this.logger.error(`Error processing VOUD file for unit ${unitKey}: ${error.message}`);
            }
          } else {
            this.logger.warn(`VOUD file not found for unit ${unitKey}`);
          }

          const url = `${server}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

          return {
            unit_key: unitKey,
            unit_alias: unitAlias,
            login_name: loginName,
            login_code: loginCode,
            booklet_id: bookletId,
            variable_id: response.variableid || '',
            variable_page: variablePage,
            variable_anchor: response.variableid || '',
            url
          };
        }));

        const sortedResult = result.sort((a, b) => {
          const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
          if (unitKeyComparison !== 0) {
            return unitKeyComparison;
          }
          return a.variable_id.localeCompare(b.variable_id);
        });

        this.logger.log(`Found ${sortedResult.length} coding items (page ${validPage}, limit ${validLimit}, total ${total})`);
        return [sortedResult, total];
      }

      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.codedStatus = :status', { status: 'CODING_INCOMPLETE' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id })
        .orderBy('response.id', 'ASC');

      const responses = await queryBuilder.getMany();

      const result = await Promise.all(responses.map(async response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        // const loginGroup = person.group || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        let variablePage = '0';
        const variableAnchor = response.variableid || 0;
        const voudFile = voudFileMap.get(`${unitKey}.VOUD`);

        if (voudFile) {
          try {
            const respDefinition = {
              definition: voudFile.data
            };
            // const transformResult = prepareDefinition(respDefinition);
            const variableLocation = extractVariableLocation([respDefinition]);
            const variablePageInfo = variableLocation[0].variable_pages.find(
              pageInfo => pageInfo.variable_ref === response.variableid
            );
            const variablePageAlwaysVisible = variableLocation[0].variable_pages.find(
              pageInfo => pageInfo.variable_page_always_visible === true
            );

            if (variablePageInfo) {
              if (variablePageAlwaysVisible && variablePageInfo.variable_page_always_visible === true) {
                variablePage = (variablePageInfo.variable_path.pages - 1).toString();
              }
              variablePage = variablePageInfo?.variable_path?.pages.toString();
            }

            this.logger.log(`Processed VOUD file for unit ${unitKey}, variable ${response.variableid}, page ${variablePage}`);
          } catch (error) {
            this.logger.error(`Error processing VOUD file for unit ${unitKey}: ${error.message}`);
          }
        } else {
          this.logger.warn(`VOUD file not found for unit ${unitKey}`);
        }

        const url = `${server}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;
        return {
          unit_key: unitKey,
          unit_alias: unitAlias,
          login_name: loginName,
          login_code: loginCode,
          booklet_id: bookletId,
          variable_id: response.variableid || '',
          variable_page: variablePage,
          variable_anchor: response.variableid || '',
          url
        };
      }));

      const sortedResult = result.sort((a, b) => {
        const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
        if (unitKeyComparison !== 0) {
          return unitKeyComparison;
        }
        // If unit_key is the same, sort by variable_id
        return a.variable_id.localeCompare(b.variable_id);
      });

      this.logger.log(`Found ${sortedResult.length} coding items`);
      return [sortedResult, sortedResult.length];
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return [[], 0];
    }
  }

  private statisticsCache: Map<number, { data: CodingStatistics; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute cache TTL

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}`);

    const cachedResult = this.statisticsCache.get(workspace_id);
    if (cachedResult && (Date.now() - cachedResult.timestamp) < this.CACHE_TTL_MS) {
      this.logger.log(`Returning cached statistics for workspace ${workspace_id}`);
      return cachedResult.data;
    }

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const statusCountResults = await this.responseRepository.query(`
        SELECT
          response.codedstatus as "statusValue",
          COUNT(response.id) as count
        FROM response
        INNER JOIN unit ON response.unitid = unit.id
        INNER JOIN booklet ON unit.bookletid = booklet.id
        INNER JOIN persons person ON booklet.personid = person.id
        WHERE response.status = $1
          AND person.workspace_id = $2
          AND person.consider = $3
        GROUP BY response.codedstatus
      `, ['VALUE_CHANGED', workspace_id, true]);

      let totalResponses = 0;

      statusCountResults.forEach(result => {
        const count = parseInt(result.count, 10);
        const validCount = Number.isNaN(count) ? 0 : count;
        statistics.statusCounts[result.statusValue] = validCount;
        totalResponses += validCount;
      });

      statistics.totalResponses = totalResponses;

      this.statisticsCache.set(workspace_id, {
        data: statistics,
        timestamp: Date.now()
      });

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);
      return statistics;
    }
  }

  async getCodingListAsCsv(workspace_id: number): Promise<Buffer> {
    this.logger.log(`Generating CSV export for workspace ${workspace_id}`);
    const [items] = await this.getCodingList(workspace_id, '', '');

    if (!items || items.length === 0) {
      this.logger.warn('No coding list items found for CSV export');
      return Buffer.from('No data available');
    }

    const csvStream = fastCsv.format({ headers: true });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      csvStream.on('data', chunk => {
        chunks.push(Buffer.from(chunk));
      });

      csvStream.on('end', () => {
        const csvBuffer = Buffer.concat(chunks);
        this.logger.log(`CSV export generated successfully with ${items.length} items`);
        resolve(csvBuffer);
      });

      csvStream.on('error', error => {
        this.logger.error(`Error generating CSV export: ${error.message}`);
        reject(error);
      });

      items.forEach(item => {
        csvStream.write({
          unit_key: item.unit_key,
          unit_alias: item.unit_alias,
          login_name: item.login_name,
          login_code: item.login_code,
          booklet_id: item.booklet_id,
          variable_id: item.variable_id,
          variable_page: item.variable_page,
          variable_anchor: item.variable_anchor
        });
      });

      csvStream.end();
    });
  }

  async getCodingListAsExcel(workspace_id: number): Promise<Buffer> {
    this.logger.log(`Generating Excel export for workspace ${workspace_id}`);
    return this.getCodingListAsCsv(workspace_id);
  }

  /**
   * Get all missings profiles
   * @param workspaceId Workspace ID (not used, profiles are global)
   * @returns Array of missings profiles with labels
   */
  async getMissingsProfiles(workspaceId: number): Promise<{ label: string }[]> {
    try {
      this.logger.log(`Getting missings profiles for workspace ${workspaceId}`);

      // Get the setting with key 'missings-profile-iqb-standard'
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        // If no profiles exist yet, create a default one
        const defaultProfiles = this.createDefaultMissingsProfiles();
        await this.saveMissingsProfiles(defaultProfiles);

        // Return just the labels
        return defaultProfiles.map(profile => ({ label: profile.label }));
      }

      // Parse the profiles from the setting content
      try {
        const profiles: MissingsProfilesDto[] = JSON.parse(setting.content);
        return profiles.map(profile => ({ label: profile.label }));
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
        return [];
      }
    } catch (error) {
      this.logger.error(`Error getting missings profiles for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }

  private async getMissingsProfileByLabel(label: string): Promise<MissingsProfilesDto | null> {
    try {
      // Get the setting with key 'missings-profile-iqb-standard'
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        return null;
      }

      // Parse the profiles from the setting content
      try {
        const profiles: MissingsProfilesDto[] = JSON.parse(setting.content);
        const profile = profiles.find(p => p.label === label);
        return profile || null;
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
        return null;
      }
    } catch (error) {
      this.logger.error(`Error getting missings profile by label: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Create default missings profiles
   * @returns Array of default missings profiles
   */
  private createDefaultMissingsProfiles(): MissingsProfilesDto[] {
    // Create default profiles
    const defaultProfile = new MissingsProfilesDto();
    defaultProfile.label = 'Default';
    defaultProfile.setMissings([
      {
        id: 'missing',
        label: 'Missing',
        description: 'Value is missing',
        code: 999
      }
    ]);

    const standardProfile = new MissingsProfilesDto();
    standardProfile.label = 'Standard';
    standardProfile.setMissings([
      {
        id: 'missing',
        label: 'Missing',
        description: 'Value is missing',
        code: 999
      },
      {
        id: 'not-reached',
        label: 'Not Reached',
        description: 'Item was not reached by the test taker',
        code: 998
      }
    ]);

    const extendedProfile = new MissingsProfilesDto();
    extendedProfile.label = 'Extended';
    extendedProfile.setMissings([
      {
        id: 'missing',
        label: 'Missing',
        description: 'Value is missing',
        code: 999
      },
      {
        id: 'not-reached',
        label: 'Not Reached',
        description: 'Item was not reached by the test taker',
        code: 998
      },
      {
        id: 'not-applicable',
        label: 'Not Applicable',
        description: 'Item is not applicable for this test taker',
        code: 997
      },
      {
        id: 'invalid',
        label: 'Invalid',
        description: 'Response is invalid',
        code: 996
      }
    ]);

    return [defaultProfile, standardProfile, extendedProfile];
  }

  private async saveMissingsProfiles(profiles: MissingsProfilesDto[]): Promise<void> {
    try {
      // Create or update the setting
      let setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        setting = new Setting();
        setting.key = 'missings-profile-iqb-standard';
      }

      setting.content = JSON.stringify(profiles);
      await this.settingRepository.save(setting);
    } catch (error) {
      this.logger.error(`Error saving missings profiles: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Creating missings profile for workspace ${workspaceId}`);

      // Get all existing profiles
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      let profiles: MissingsProfilesDto[] = [];

      if (setting) {
        try {
          profiles = JSON.parse(setting.content);
        } catch (parseError) {
          this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
          profiles = [];
        }
      }

      // Check if a profile with the same label already exists
      const existingProfile = profiles.find(p => p.label === profile.label);
      if (existingProfile) {
        this.logger.error(`A missings profile with label '${profile.label}' already exists`);
        return null;
      }

      // Add the new profile
      profiles.push(profile);

      // Save the updated profiles
      await this.saveMissingsProfiles(profiles);

      return profile;
    } catch (error) {
      this.logger.error(`Error creating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Updating missings profile '${label}' for workspace ${workspaceId}`);

      // Get all existing profiles
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        this.logger.error('No missings profiles found');
        return null;
      }

      let profiles: MissingsProfilesDto[] = [];

      try {
        profiles = JSON.parse(setting.content);
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
      }

      const index = profiles.findIndex(p => p.label === label);
      if (index === -1) {
        this.logger.error(`Missings profile with label '${label}' not found`);
        return null;
      }
      profiles[index] = profile;
      await this.saveMissingsProfiles(profiles);

      return profile;
    } catch (error) {
      this.logger.error(`Error updating missings profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteMissingsProfile(workspaceId: number, label: string): Promise<boolean> {
    try {
      this.logger.log(`Deleting missings profile '${label}' for workspace ${workspaceId}`);

      // Get all existing profiles
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        return false;
      }

      let profiles: MissingsProfilesDto[] = [];

      try {
        profiles = JSON.parse(setting.content);
      } catch (parseError) {
        this.logger.error(`Error parsing missings profiles: ${parseError.message}`, parseError.stack);
        return false;
      }

      // Find the profile to delete
      const index = profiles.findIndex(p => p.label === label);
      if (index === -1) {
        return false;
      }

      // Remove the profile
      profiles.splice(index, 1);

      // Save the updated profiles
      await this.saveMissingsProfiles(profiles);

      return true;
    } catch (error) {
      this.logger.error(`Error deleting missings profile: ${error.message}`, error.stack);
      return false;
    }
  }

  async getMissingsProfileDetails(workspaceId: number, label: string): Promise<MissingsProfilesDto | null> {
    try {
      this.logger.log(`Getting missings profile details for '${label}' in workspace ${workspaceId}`);
      return await this.getMissingsProfileByLabel(label);
    } catch (error) {
      this.logger.error(`Error getting missings profile details: ${error.message}`, error.stack);
      return null;
    }
  }

  async generateCodebook(
    workspaceId: number,
    missingsProfile: string,
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

      // Get the missings from the selected profile
      let missings: Missing[] = [
        {
          code: '999',
          label: 'Missing',
          description: 'Value is missing'
        }
      ];

      if (missingsProfile) {
        const profile = await this.getMissingsProfileByLabel(missingsProfile);
        if (profile) {
          // Convert MissingDto[] to Missing[]
          const profileMissings = profile.parseMissings();
          if (profileMissings.length > 0) {
            missings = profileMissings.map(m => ({
              code: m.code.toString(),
              label: m.label,
              description: m.description
            }));
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
    try {
      // Get job from Bull queue
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      // Check if job can be paused
      const state = await bullJob.getState();
      if (state !== 'active' && state !== 'waiting' && state !== 'delayed') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be paused because it is ${state}`
        };
      }

      // Update job data to mark it as paused
      const updatedData = {
        ...bullJob.data,
        isPaused: true
      };

      await bullJob.update(updatedData);
      this.logger.log(`Job ${jobId} has been paused successfully`);

      return { success: true, message: `Job ${jobId} has been paused successfully` };
    } catch (error) {
      this.logger.error(`Error pausing job: ${error.message}`, error.stack);
      return { success: false, message: `Error pausing job: ${error.message}` };
    }
  }

  async resumeJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get job from Bull queue
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      // Check if job is paused
      if (!bullJob.data.isPaused) {
        return {
          success: false,
          message: `Job with ID ${jobId} is not paused and cannot be resumed`
        };
      }

      // Update job data to remove the isPaused flag
      const { isPaused, ...restData } = bullJob.data;
      await bullJob.update(restData);

      this.logger.log(`Job ${jobId} has been resumed successfully`);
      return { success: true, message: `Job ${jobId} has been resumed successfully` };
    } catch (error) {
      this.logger.error(`Error resuming job: ${error.message}`, error.stack);
      return { success: false, message: `Error resuming job: ${error.message}` };
    }
  }

  /**
   * Restart a failed job
   * @param jobId The job ID to restart
   * @returns Success status and message, with new job ID if successful
   */
  async restartJob(jobId: string): Promise<{ success: boolean; message: string; jobId?: string }> {
    try {
      // Get job from Bull queue
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      // Check if job is failed
      const state = await bullJob.getState();
      if (state !== 'failed') {
        return {
          success: false,
          message: `Job with ID ${jobId} is not failed and cannot be restarted`
        };
      }

      // Create a new job with the same data
      const newJob = await this.jobQueueService.addTestPersonCodingJob({
        workspaceId: bullJob.data.workspaceId,
        personIds: bullJob.data.personIds,
        groupNames: bullJob.data.groupNames
      });

      // Delete the old job
      await this.jobQueueService.deleteTestPersonCodingJob(jobId);

      this.logger.log(`Job ${jobId} has been restarted as job ${newJob.id}`);
      return {
        success: true,
        message: `Job ${jobId} has been restarted as job ${newJob.id}`,
        jobId: newJob.id.toString()
      };
    } catch (error) {
      this.logger.error(`Error restarting job: ${error.message}`, error.stack);
      return { success: false, message: `Error restarting job: ${error.message}` };
    }
  }

  /**
   * Get jobs only from Redis Bull queue for a workspace
   * @param workspaceId The workspace ID
   * @returns Array of jobs from Redis Bull
   */
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
    const jobs: {
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
    }[] = [];

    try {
      const bullJobs = await this.jobQueueService.getTestPersonCodingJobs(workspaceId);
      for (const bullJob of bullJobs) {
        // Get job state and progress
        const state = await bullJob.getState();
        const progress = await bullJob.progress() || 0;

        // Map Bull job state to our job status
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

        // Get result from job return value if completed
        let result: CodingStatistics | undefined;
        let error: string | undefined;

        if (state === 'completed' && bullJob.returnvalue) {
          result = bullJob.returnvalue as CodingStatistics;
        } else if (state === 'failed' && bullJob.failedReason) {
          error = bullJob.failedReason;
        }

        // Add job to the list
        jobs.push({
          jobId: bullJob.id.toString(),
          status,
          progress: typeof progress === 'number' ? progress : 0,
          result,
          error,
          workspaceId: bullJob.data.workspaceId,
          createdAt: new Date(bullJob.timestamp),
          groupNames: bullJob.data.groupNames,
          completedAt: state === 'completed' ? new Date(bullJob.finishedOn || Date.now()) : undefined,
          durationMs: state === 'completed' && bullJob.finishedOn && bullJob.timestamp ?
            bullJob.finishedOn - bullJob.timestamp :
            undefined
        });
      }
    } catch (bullError) {
      this.logger.error(`Error getting jobs from Redis queue: ${bullError.message}`, bullError.stack);
    }

    // Sort jobs by creation date (newest first)
    return jobs.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  /**
   * Get variable analysis data for a workspace
   * This method retrieves and analyzes responses grouped by unit, variable, and code
   * It also fetches coding scheme information to populate derivation and description fields
   *
   * The analysis includes:
   * - Grouping responses by unit, variable, and code
   * - Calculating occurrence counts and relative occurrences
   * - Generating replay URLs for each combination
   * - Fetching coding scheme information from file_upload table (file_id = unitId+.VOCS)
   *
   * @param workspace_id The workspace ID
   * @param authToken Authentication token for generating replay URLs
   * @param serverUrl Base server URL for replay links
   * @param page Page number for pagination (default: 1)
   * @param limit Number of items per page (default: 100)
   * @param unitIdFilter Optional filter to search for specific unit IDs
   * @param variableIdFilter Optional filter to search for specific variable IDs
   * @param derivationFilter Optional filter to search for specific derivation values
   * @returns Paginated array of variable analysis items with all required information
   */
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
    try {
      this.logger.log(`Getting variable analysis for workspace ${workspace_id} (page ${page}, limit ${limit})`);
      const startTime = Date.now();

      // Step 1: Pre-fetch all coding schemes for the workspace to avoid individual queries
      this.logger.log('Pre-fetching coding schemes...');
      const codingSchemes = await this.fileUploadRepository.find({
        where: {
          workspace_id,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      // Create a map of unitId to parsed coding scheme for quick lookup
      interface CodingScheme {
        variableCodings?: {
          id: string;
          sourceType?: string;
          label?: string;
        }[];
        [key: string]: unknown;
      }

      const codingSchemeMap = new Map<string, CodingScheme>();
      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          const parsedScheme = JSON.parse(scheme.data) as CodingScheme;
          codingSchemeMap.set(unitId, parsedScheme);
        } catch (error) {
          this.logger.error(`Error parsing coding scheme ${scheme.file_id}: ${error.message}`, error.stack);
        }
      }
      this.logger.log(`Pre-fetched ${codingSchemeMap.size} coding schemes in ${Date.now() - startTime}ms`);

      // Step 2: Count total number of unique unit-variable-code combinations
      const countQuery = this.responseRepository.createQueryBuilder('response')
        .select('COUNT(DISTINCT CONCAT(unit.name, response.variableid, response.code))', 'count')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspace_id', { workspace_id });

      // Add filters if provided
      if (unitIdFilter) {
        countQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        countQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      const totalCountResult = await countQuery.getRawOne();
      const totalCount = parseInt(totalCountResult?.count || '0', 10);
      this.logger.log(`Total unique combinations: ${totalCount}`);

      // Step 3: Use direct SQL aggregation to get counts and other data
      // This avoids loading complete response objects and processing them in memory
      const aggregationQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.code', 'code')
        .addSelect('COUNT(response.id)', 'occurrenceCount')
        .addSelect('MAX(response.score)', 'score') // Use MAX as a sample score
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspace_id', { workspace_id });

      // Add filters if provided
      if (unitIdFilter) {
        aggregationQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        aggregationQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      aggregationQuery
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy('response.code')
        .orderBy('unit.name', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('response.code', 'ASC')
        .offset((page - 1) * limit)
        .limit(limit);

      const aggregatedResults = await aggregationQuery.getRawMany();
      this.logger.log(`Retrieved ${aggregatedResults.length} aggregated combinations for page ${page}`);

      // If no combinations found, return empty result
      if (aggregatedResults.length === 0) {
        return {
          data: [],
          total: totalCount,
          page,
          limit
        };
      }

      // Step 4: Get total counts for each unit-variable combination
      // We need this to calculate relative occurrences
      const unitVariableCounts = new Map<string, Map<string, number>>();

      // Extract unique unit-variable combinations from the aggregated results
      const unitVariableCombinations = Array.from(
        new Set(aggregatedResults.map(item => `${item.unitId}|${item.variableId}`))
      ).map(combined => {
        const [unitId, variableId] = combined.split('|');
        return { unitId, variableId };
      });

      // Query to get total counts for each unit-variable combination
      const totalCountsQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(response.id)', 'totalCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspace_id', { workspace_id });

      // Add filters if provided
      if (unitIdFilter) {
        totalCountsQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        totalCountsQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      // Add conditions for the specific unit-variable combinations we need
      if (unitVariableCombinations.length > 0) {
        unitVariableCombinations.forEach((combo, index) => {
          totalCountsQuery.orWhere(
            `(unit.name = :unitId${index} AND response.variableid = :variableId${index})`,
            {
              [`unitId${index}`]: combo.unitId,
              [`variableId${index}`]: combo.variableId
            }
          );
        });
      }

      totalCountsQuery.groupBy('unit.name')
        .addGroupBy('response.variableid');

      const totalCountsResults = await totalCountsQuery.getRawMany();

      // Build a map for quick lookup of total counts
      for (const result of totalCountsResults) {
        if (!unitVariableCounts.has(result.unitId)) {
          unitVariableCounts.set(result.unitId, new Map<string, number>());
        }
        unitVariableCounts.get(result.unitId)?.set(result.variableId, parseInt(result.totalCount, 10));
      }

      // Step 5: Get sample login information for replay URLs
      // We need one sample per unit-variable combination
      const sampleInfoQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('person.login', 'loginName')
        .addSelect('person.code', 'loginCode')
        .addSelect('bookletinfo.name', 'bookletId')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspace_id', { workspace_id });

      // Add conditions for the specific unit-variable combinations we need
      if (unitVariableCombinations.length > 0) {
        unitVariableCombinations.forEach((combo, index) => {
          sampleInfoQuery.orWhere(
            `(unit.name = :unitId${index} AND response.variableid = :variableId${index})`,
            {
              [`unitId${index}`]: combo.unitId,
              [`variableId${index}`]: combo.variableId
            }
          );
        });
      }

      // Limit to one sample per combination
      sampleInfoQuery.groupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy('person.login')
        .addGroupBy('person.code')
        .addGroupBy('bookletinfo.name');

      const sampleInfoResults = await sampleInfoQuery.getRawMany();

      // Build a map for quick lookup of sample info
      const sampleInfoMap = new Map<string, { loginName: string; loginCode: string; bookletId: string }>();
      for (const result of sampleInfoResults) {
        const key = `${result.unitId}|${result.variableId}`;
        sampleInfoMap.set(key, {
          loginName: result.loginName || '',
          loginCode: result.loginCode || '',
          bookletId: result.bookletId || ''
        });
      }

      // Step 6: Convert aggregated data to the required format
      const result: VariableAnalysisItemDto[] = [];

      for (const item of aggregatedResults) {
        const unitId = item.unitId;
        const variableId = item.variableId;
        const code = item.code;
        const occurrenceCount = parseInt(item.occurrenceCount, 10);
        const score = parseFloat(item.score) || 0;

        // Get total count for this unit-variable combination
        const variableTotalCount = unitVariableCounts.get(unitId)?.get(variableId) || 0;

        // Calculate relative occurrence
        const relativeOccurrence = variableTotalCount > 0 ? occurrenceCount / variableTotalCount : 0;

        // Get coding scheme information
        let derivation = '';
        let description = '';
        const codingScheme = codingSchemeMap.get(unitId);
        if (codingScheme && codingScheme.variableCodings && Array.isArray(codingScheme.variableCodings)) {
          const variableCoding = codingScheme.variableCodings.find(vc => vc.id === variableId);
          if (variableCoding) {
            derivation = variableCoding.sourceType || '';
            description = variableCoding.label || '';
          }
        }

        // Skip items where derivation is BASE_NO_VALUE or empty
        if (derivation === 'BASE_NO_VALUE' || derivation === '') {
          continue;
        }

        // Get sample info for replay URL
        const sampleInfo = sampleInfoMap.get(`${unitId}|${variableId}`);
        const loginName = sampleInfo?.loginName || '';
        const loginCode = sampleInfo?.loginCode || '';
        const bookletId = sampleInfo?.bookletId || '';

        // Generate replay URL
        const variablePage = '0';
        const replayUrl = `${serverUrl}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitId}/${variablePage}/${variableId}?auth=${authToken}`;

        // Add to result
        result.push({
          replayUrl,
          unitId,
          variableId,
          derivation,
          code,
          description,
          score,
          occurrenceCount,
          totalCount: variableTotalCount,
          relativeOccurrence
        });
      }

      // Apply derivation filter if provided
      if (derivationFilter && derivationFilter.trim() !== '') {
        const filteredResult = result.filter(item => item.derivation.toLowerCase().includes(derivationFilter.toLowerCase()));

        const filteredCount = filteredResult.length;
        this.logger.log(`Applied derivation filter: ${derivationFilter}, filtered from ${result.length} to ${filteredCount} items`);

        const endTime = Date.now();
        this.logger.log(`Variable analysis completed in ${endTime - startTime}ms`);

        return {
          data: filteredResult,
          total: filteredCount, // Update total count to reflect filtered results
          page,
          limit
        };
      }

      const endTime = Date.now();
      this.logger.log(`Variable analysis completed in ${endTime - startTime}ms`);

      return {
        data: result,
        total: totalCount,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(`Error getting variable analysis: ${error.message}`, error.stack);
      throw new Error('Could not retrieve variable analysis data. Please check the database connection or query.');
    }
  }

  /**
   * Export validation results as Excel with complete database content from Redis cache
   * @param workspaceId Workspace ID
   * @param cacheKey Cache key to retrieve complete validation results
   * @returns Excel buffer with complete data
   */
  async exportValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting validation results as Excel for workspace ${workspaceId} using cache key ${cacheKey}`);

    // Validate input parameters
    if (!cacheKey || typeof cacheKey !== 'string') {
      const errorMessage = 'Invalid cache key provided';
      this.logger.error(`${errorMessage}: ${cacheKey}`);
      throw new Error(errorMessage);
    }

    try {
      // Retrieve complete validation results from cache
      this.logger.log(`Attempting to retrieve cached data with key: ${cacheKey}`);
      const cachedData = await this.cacheService.getCompleteValidationResults(cacheKey);

      if (!cachedData) {
        const errorMessage = 'Validation results not found in cache. Please run validation again.';
        this.logger.error(`No cached validation results found for cache key ${cacheKey}`);
        // Additional logging to help debug cache issues
        this.logger.error('Cache key format: validation:{workspaceId}:{hash}');
        this.logger.error(`Expected pattern: validation:${workspaceId}:*`);
        throw new Error(errorMessage);
      }

      const validationResults = cachedData.results;
      this.logger.log(`Successfully retrieved ${validationResults.length} validation results from cache for export`);

      if (!validationResults || validationResults.length === 0) {
        const errorMessage = 'No validation data available for export. Please run validation again.';
        this.logger.error('Cached data exists but contains no validation results');
        throw new Error(errorMessage);
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Validation Results');

      worksheet.columns = [
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Unit Key', key: 'unit_key', width: 15 },
        { header: 'Login Name', key: 'login_name', width: 15 },
        { header: 'Login Code', key: 'login_code', width: 15 },
        { header: 'Booklet ID', key: 'booklet_id', width: 15 },
        { header: 'Variable ID', key: 'variable_id', width: 15 },
        { header: 'Response Value', key: 'response_value', width: 20 },
        { header: 'Response Status', key: 'response_status', width: 15 },
        { header: 'Person ID', key: 'person_id', width: 12 },
        { header: 'Unit Name', key: 'unit_name', width: 20 },
        { header: 'Booklet Name', key: 'booklet_name', width: 20 },
        { header: 'Last Modified', key: 'last_modified', width: 20 }
      ];

      // Add header style
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      for (const result of validationResults) {
        const combination = result.combination;
        let responseData = null;
        let personData = null;
        let unitData = null;
        let bookletData = null;

        if (result.status === 'EXISTS') {
          const query = this.responseRepository
            .createQueryBuilder('response')
            .leftJoin('response.unit', 'unit')
            .leftJoin('unit.booklet', 'booklet')
            .leftJoin('booklet.person', 'person')
            .leftJoin('booklet.bookletinfo', 'bookletinfo')
            .select([
              'response.value',
              'response.status',
              'person.id',
              'person.login',
              'person.code',
              'unit.name',
              'unit.alias',
              'bookletinfo.name'
            ])
            .where('unit.alias = :unitKey', { unitKey: combination.unit_key })
            .andWhere('person.login = :loginName', { loginName: combination.login_name })
            .andWhere('person.code = :loginCode', { loginCode: combination.login_code })
            .andWhere('bookletinfo.name = :bookletId', { bookletId: combination.booklet_id })
            .andWhere('response.variableid = :variableId', { variableId: combination.variable_id })
            .andWhere('response.value IS NOT NULL')
            .andWhere('response.value != :empty', { empty: '' });

          const responseEntity = await query.getOne();
          if (responseEntity) {
            responseData = responseEntity;
            personData = responseEntity.unit?.booklet?.person;
            unitData = responseEntity.unit;
            bookletData = responseEntity.unit?.booklet?.bookletinfo;
          }
        }

        worksheet.addRow({
          status: result.status,
          unit_key: combination.unit_key,
          login_name: combination.login_name,
          login_code: combination.login_code,
          booklet_id: combination.booklet_id,
          variable_id: combination.variable_id,
          response_value: responseData?.value || '',
          response_status: responseData?.status || '',
          person_id: personData?.id || '',
          unit_name: unitData?.name || '',
          booklet_name: bookletData?.name || '',
          last_modified: '' // No timestamp field available in ResponseEntity
        });
      }

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header row
          const statusCell = row.getCell(1);
          if (statusCell.value === 'EXISTS') {
            statusCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF90EE90' } // Light green
            };
          } else if (statusCell.value === 'MISSING') {
            statusCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFA0A0' } // Light red
            };
          }
        }
      });

      // Auto-fit columns
      worksheet.columns.forEach(column => {
        if (column.header) {
          column.width = Math.max(column.width || 10, column.header.length + 2);
        }
      });

      // Generate Excel buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting validation results as Excel: ${error.message}`, error.stack);
      throw new Error('Could not export validation results as Excel. Please check the database connection or query.');
    }
  }

  /**
   * Validate completeness of coding responses with Redis caching and complete backend processing
   * @param workspaceId Workspace ID
   * @param expectedCombinations Expected combinations from Excel
   * @param page Page number (1-based)
   * @param pageSize Number of items per page
   * @returns Validation results with pagination metadata
   */
  async validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<ValidateCodingCompletenessResponseDto> {
    try {
      this.logger.log(`Validating coding completeness for workspace ${workspaceId} with ${expectedCombinations.length} expected combinations`);
      const startTime = Date.now();

      // Generate cache key based on workspace and combinations hash
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

      // No cache found - process ALL combinations and cache the complete results
      this.logger.log(`No cached results found. Processing all ${expectedCombinations.length} combinations for workspace ${workspaceId}`);

      const allResults: ValidationResultDto[] = [];
      let totalMissingCount = 0;

      // Process all combinations in batches to avoid overwhelming the database
      const batchSize = 100;
      for (let i = 0; i < expectedCombinations.length; i += batchSize) {
        const batch = expectedCombinations.slice(i, i + batchSize);
        this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(expectedCombinations.length / batchSize)}`);

        // Process each combination in the batch
        for (const expected of batch) {
          // Build a query to check if the response exists
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

          // Add the result
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

      // Cache the complete results
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

      // Now get the paginated results from the complete data
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
          cacheKey // Include cache key in response for subsequent requests
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
      this.logger.log(`Getting CODING_INCOMPLETE variables for workspace ${workspaceId}${unitName ? ` and unit ${unitName}` : ''}`);

      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('response.codedStatus = :status', { status: 'CODING_INCOMPLETE' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId });

      if (unitName) {
        queryBuilder.andWhere('unit.name = :unitName', { unitName });
      }

      const responses = await queryBuilder.getMany();

      const uniqueVariables = new Map<string, { unitName: string; variableId: string }>();

      responses.forEach(response => {
        const unit = response.unit;
        if (unit && response.variableid) {
          const key = `${unit.name}|${response.variableid}`;
          if (!uniqueVariables.has(key)) {
            uniqueVariables.set(key, {
              unitName: unit.name,
              variableId: response.variableid
            });
          }
        }
      });

      const result = Array.from(uniqueVariables.values());
      this.logger.log(`Found ${result.length} unique CODING_INCOMPLETE variables`);

      return result;
    } catch (error) {
      this.logger.error(`Error getting CODING_INCOMPLETE variables: ${error.message}`, error.stack);
      throw new Error('Could not get CODING_INCOMPLETE variables. Please check the database connection.');
    }
  }
}
