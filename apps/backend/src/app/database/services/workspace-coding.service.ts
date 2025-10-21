import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { CodingScheme } from '@iqbspecs/coding-scheme/coding-scheme.interface';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
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
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CodingStatisticsService } from './coding-statistics.service';

interface ExternalCodingRow {
  unit_key?: string;
  unit_alias?: string;
  variable_id?: string;
  status?: string;
  score?: string | number;
  code?: string | number;
  person_code?: string;
  person_login?: string;
  person_group?: string;
  booklet_name?: string;
  [key: string]: string | number | undefined;
}

interface ExternalCodingImportBody {
  file: string; // base64 encoded file data
  fileName?: string;
}

interface QueryParameters {
  unitAlias?: string;
  unitName?: string;
  variableId: string;
  workspaceId: number;
  personCode?: string;
  personLogin?: string;
  personGroup?: string;
  bookletName?: string;
}

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
    private codingStatisticsService: CodingStatisticsService
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

      // Invalidate cache since coding statuses have been updated
      await this.invalidateIncompleteVariablesCache(workspace_id);

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

  async getMissingsProfiles(workspaceId: number): Promise<{ label: string }[]> {
    try {
      this.logger.log(`Getting missings profiles for workspace ${workspaceId}`);

      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        const defaultProfiles = this.createDefaultMissingsProfiles();
        await this.saveMissingsProfiles(defaultProfiles);

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
      const setting = await this.settingRepository.findOne({
        where: { key: 'missings-profile-iqb-standard' }
      });

      if (!setting) {
        return null;
      }

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

      const existingProfile = profiles.find(p => p.label === profile.label);
      if (existingProfile) {
        this.logger.error(`A missings profile with label '${profile.label}' already exists`);
        return null;
      }

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
        const profile = await this.missingsProfilesService.getMissingsProfileDetails(workspaceId, missingsProfile);
        if (profile && profile.missings) {
          try {
            // Parse the missings configuration
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
        .select('COUNT(DISTINCT CONCAT(unit.name, response.variableid, response.code_v1))', 'count')
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
        .addSelect('response.code_v1', 'code_v1')
        .addSelect('COUNT(response.id)', 'occurrenceCount')
        .addSelect('MAX(response.score_v1)', 'score_V1') // Use MAX as a sample score
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
        .addGroupBy('response.code_v1')
        .orderBy('unit.name', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('response.code_v1', 'ASC')
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

        const variableTotalCount = unitVariableCounts.get(unitId)?.get(variableId) || 0;

        const relativeOccurrence = variableTotalCount > 0 ? occurrenceCount / variableTotalCount : 0;

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

        if (derivation === 'BASE_NO_VALUE' || derivation === '') {
          continue;
        }

        const sampleInfo = sampleInfoMap.get(`${unitId}|${variableId}`);
        const loginName = sampleInfo?.loginName || '';
        const loginCode = sampleInfo?.loginCode || '';
        const bookletId = sampleInfo?.bookletId || '';

        const variablePage = '0';
        const replayUrl = `${serverUrl}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitId}/${variablePage}/${variableId}?auth=${authToken}`;

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

      if (derivationFilter && derivationFilter.trim() !== '') {
        const filteredResult = result.filter(item => item.derivation.toLowerCase().includes(derivationFilter.toLowerCase()));

        const filteredCount = filteredResult.length;
        this.logger.log(`Applied derivation filter: ${derivationFilter}, filtered from ${result.length} to ${filteredCount} items`);

        const endTime = Date.now();
        this.logger.log(`Variable analysis completed in ${endTime - startTime}ms`);

        return {
          data: filteredResult,
          total: filteredCount,
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

  async exportValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting validation results as Excel for workspace ${workspaceId} using cache key ${cacheKey}`);

    if (!cacheKey || typeof cacheKey !== 'string') {
      const errorMessage = 'Invalid cache key provided';
      this.logger.error(`${errorMessage}: ${cacheKey}`);
      throw new Error(errorMessage);
    }

    try {
      this.logger.log(`Attempting to retrieve cached data with key: ${cacheKey}`);
      const cachedData = await this.cacheService.getCompleteValidationResults(cacheKey);

      if (!cachedData) {
        this.logger.error(`No cached validation results found for cache key ${cacheKey}`);
        this.logger.error('Cache key format: validation:{workspaceId}:{hash}');
        this.logger.error(`Expected pattern: validation:${workspaceId}:*`);
      }

      const validationResults = cachedData.results;
      this.logger.log(`Successfully retrieved ${validationResults.length} validation results from cache for export`);

      if (!validationResults || validationResults.length === 0) {
        this.logger.error('Cached data exists but contains no validation results');
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

  /**
   * Clear the CODING_INCOMPLETE variables cache for a specific workspace
   * Should be called whenever coding status changes for the workspace
   * @param workspaceId The workspace ID to clear cache for
   */
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
    return this.importExternalCoding(workspaceId, body, progressCallback);
  }

  async importExternalCoding(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback?: (progress: number, message: string) => void
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
    try {
      this.logger.log(`Starting external coding import for workspace ${workspaceId}`);
      progressCallback?.(5, 'Starting external coding import...');

      const fileData = body.file; // Assuming base64 encoded file data
      const fileName = body.fileName || 'external-coding.csv';

      let parsedData: ExternalCodingRow[] = [];
      const errors: string[] = [];

      progressCallback?.(10, 'Parsing file...');

      if (fileName.endsWith('.csv')) {
        parsedData = await this.parseCSVFile(fileData);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        parsedData = await this.parseExcelFile(fileData);
      } else {
        this.logger.error(`Unsupported file format: ${fileName}. Please use CSV or Excel files.`);
        return {
          message: 'Unsupported file format. Please use CSV or Excel files.',
          processedRows: 0,
          updatedRows: 0,
          errors: ['Unsupported file format. Please use CSV or Excel files.'],
          affectedRows: []
        };
      }

      this.logger.log(`Parsed ${parsedData.length} rows from external coding file`);
      progressCallback?.(20, `Parsed ${parsedData.length} rows from file`);

      let updatedRows = 0;
      const processedRows = parsedData.length;
      const affectedRows: Array<{
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
      }> = [];

      // Process data in batches for better performance
      const batchSize = 1000;
      const totalBatches = Math.ceil(parsedData.length / batchSize);

      this.logger.log(`Processing ${parsedData.length} rows in ${totalBatches} batches of ${batchSize}`);
      progressCallback?.(25, `Starting to process ${parsedData.length} rows in ${totalBatches} batches`);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, parsedData.length);
        const batch = parsedData.slice(batchStart, batchEnd);

        this.logger.log(`Processing batch ${batchIndex + 1}/${totalBatches} (rows ${batchStart + 1}-${batchEnd})`);

        // Calculate progress: 25% start + 70% for batch processing
        const batchProgress = 25 + Math.floor(((batchIndex) / totalBatches) * 70);
        progressCallback?.(batchProgress, `Processing batch ${batchIndex + 1}/${totalBatches} (rows ${batchStart + 1}-${batchEnd})`);

        for (const row of batch) {
          try {
            const {
              unit_key: unitKey,
              unit_alias: unitAlias, variable_id: variableId, status, score, code,
              person_code: personCode, person_login: personLogin, person_group: personGroup, booklet_name: bookletName
            } = row;

            // Use unit_key if provided, otherwise fall back to unit_alias for backward compatibility
            const unitIdentifier = unitKey || unitAlias;

            if (!unitIdentifier || !variableId) {
              errors.push(`Row missing required fields: unit_key=${unitKey}, unit_alias=${unitAlias}, variable_id=${variableId}`);
              continue;
            }

            const queryBuilder = this.responseRepository
              .createQueryBuilder('response')
              .select(['response.id', 'response.status_v1', 'response.code_v1', 'response.score_v1',
                'response.status_v2', 'response.code_v2', 'response.score_v2',
                'unit.alias', 'unit.name', 'person.code', 'person.login', 'person.group', 'bookletinfo.name'])
              .innerJoin('response.unit', 'unit')
              .innerJoin('unit.booklet', 'booklet')
              .innerJoin('booklet.person', 'person')
              .innerJoin('booklet.bookletinfo', 'bookletinfo');

            // Use unit.name if unit_key was provided, otherwise unit.alias for unit_alias
            if (unitKey) {
              queryBuilder.andWhere('unit.name = :unitIdentifier', { unitIdentifier });
            } else {
              queryBuilder.andWhere('unit.alias = :unitIdentifier', { unitIdentifier });
            }

            queryBuilder
              .andWhere('response.variableid = :variableId', { variableId })
              .andWhere('person.workspace_id = :workspaceId', { workspaceId });

            if (personCode) {
              queryBuilder.andWhere('person.code = :personCode', { personCode });
            }
            if (personLogin) {
              queryBuilder.andWhere('person.login = :personLogin', { personLogin });
            }
            if (personGroup) {
              queryBuilder.andWhere('person.group = :personGroup', { personGroup });
            }
            if (bookletName) {
              queryBuilder.andWhere('bookletinfo.name = :bookletName', { bookletName });
            }

            const queryParameters: QueryParameters = {
              unitAlias: unitAlias || unitKey,
              unitName: unitKey || unitAlias,
              variableId,
              workspaceId
            };

            if (personCode) {
              queryParameters.personCode = personCode;
            }
            if (personLogin) {
              queryParameters.personLogin = personLogin;
            }
            if (personGroup) {
              queryParameters.personGroup = personGroup;
            }
            if (bookletName) {
              queryParameters.bookletName = bookletName;
            }

            const responsesToUpdate = await queryBuilder.setParameters(queryParameters).getMany();

            if (responsesToUpdate.length > 0) {
              const responseIds = responsesToUpdate.map(r => r.id);
              const updateResult = await this.responseRepository
                .createQueryBuilder()
                .update(ResponseEntity)
                .set({
                  status_v2: statusStringToNumber(status) || null,
                  code_v2: code ? parseInt(code.toString(), 10) : null,
                  score_v2: score ? parseInt(score.toString(), 10) : null
                })
                .where('id IN (:...ids)', { ids: responseIds })
                .execute();

              if (updateResult.affected && updateResult.affected > 0) {
                updatedRows += updateResult.affected;

                // Add comparison data for each affected response
                responsesToUpdate.forEach(response => {
                  affectedRows.push({
                    unitAlias: response.unit?.alias || unitAlias,
                    variableId,
                    personCode: response.unit?.booklet?.person?.code || undefined,
                    personLogin: response.unit?.booklet?.person?.login || undefined,
                    personGroup: response.unit?.booklet?.person?.group || undefined,
                    bookletName: response.unit?.booklet?.bookletinfo?.name || undefined,
                    originalCodedStatus: statusNumberToString(response.status_v1) || '',
                    originalCode: response.code_v1,
                    originalScore: response.score_v1,
                    updatedCodedStatus: status || null,
                    updatedCode: code ? parseInt(code.toString(), 10) : null,
                    updatedScore: score ? parseInt(score.toString(), 10) : null
                  });
                });
              }
            } else {
              const matchingCriteria = [`unit_alias=${unitAlias}`, `variable_id=${variableId}`];
              if (personCode) matchingCriteria.push(`person_code=${personCode}`);
              if (personLogin) matchingCriteria.push(`person_login=${personLogin}`);
              if (personGroup) matchingCriteria.push(`person_group=${personGroup}`);
              if (bookletName) matchingCriteria.push(`booklet_name=${bookletName}`);
              errors.push(`No response found for ${matchingCriteria.join(', ')}`);
            }
          } catch (rowError) {
            errors.push(`Error processing row: ${rowError.message}`);
            this.logger.error(`Error processing row: ${rowError.message}`, rowError.stack);
          }
        }

        // Small delay between batches to prevent overwhelming the database
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => {
            setTimeout(resolve, 10);
          });
        }
      }

      const message = `External coding import completed. Processed ${processedRows} rows, updated ${updatedRows} response records.`;
      this.logger.log(message);
      progressCallback?.(100, `Import completed: ${updatedRows} of ${processedRows} rows updated`);

      // Invalidate cache if rows were updated since coding statuses may have changed
      if (updatedRows > 0) {
        await this.invalidateIncompleteVariablesCache(workspaceId);
      }

      return {
        message,
        processedRows,
        updatedRows,
        errors,
        affectedRows
      };
    } catch (error) {
      this.logger.error(`Error importing external coding: ${error.message}`, error.stack);
      progressCallback?.(0, `Import failed: ${error.message}`);
      throw new Error(`Could not import external coding data: ${error.message}`);
    }
  }

  private async parseCSVFile(fileData: string): Promise<ExternalCodingRow[]> {
    return new Promise((resolve, reject) => {
      const results: ExternalCodingRow[] = [];
      const buffer = Buffer.from(fileData, 'base64');
      let rowCount = 0;

      fastCsv.parseString(buffer.toString(), { headers: true })
        .on('error', error => reject(error))
        .on('data', row => {
          if (Object.values(row).some(value => value && value.toString().trim() !== '')) {
            results.push(row);
            rowCount += 1;

            // Log progress for large files
            if (rowCount % 10000 === 0) {
              this.logger.log(`Parsed ${rowCount} rows...`);
            }

            // Memory protection: limit to 200k rows to prevent memory overflow
            if (rowCount > 200000) {
              reject(new Error('File too large. Maximum 200,000 rows supported.'));
            }
          }
        })
        .on('end', () => {
          this.logger.log(`CSV parsing completed. Total rows: ${results.length}`);
          resolve(results);
        });
    });
  }

  private async parseExcelFile(fileData: string): Promise<ExternalCodingRow[]> {
    const buffer = Buffer.from(fileData, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }

    const results: ExternalCodingRow[] = [];
    const headers: string[] = [];

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = cell.text || cell.value?.toString() || '';
    });
    this.logger.log(`Starting Excel parsing. Total rows: ${worksheet.rowCount - 1}`);

    // Memory protection: limit to 200k rows
    const maxRows = Math.min(worksheet.rowCount, 200001); // +1 for header row
    if (worksheet.rowCount > 200001) {
      throw new Error('File too large. Maximum 200,000 rows supported.');
    }

    // Parse data rows
    for (let rowNumber = 2; rowNumber <= maxRows; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const rowData: ExternalCodingRow = {};

      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rowData[header] = cell.text || cell.value?.toString() || '';
        }
      });

      // Only add non-empty rows
      if (Object.values(rowData).some(value => value && value.toString().trim() !== '')) {
        results.push(rowData);
      }

      // Log progress for large files
      if ((rowNumber - 1) % 10000 === 0) {
        this.logger.log(`Parsed ${rowNumber - 1} rows...`);
      }
    }

    this.logger.log(`Excel parsing completed. Total rows: ${results.length}`);
    return results;
  }
}
