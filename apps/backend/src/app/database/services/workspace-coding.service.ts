import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import * as fastCsv from 'fast-csv';
import { ResponseStatusType } from '@iqb/responses';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { TestPersonCodingJob } from '../entities/test-person-coding-job.entity';
import { CodingStatistics, CodingStatisticsWithJob } from './shared-types';
import { extractVariableLocation } from '../../utils/voud/extractVariableLocation';

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
    @InjectRepository(TestPersonCodingJob)
    private jobRepository: Repository<TestPersonCodingJob>
  ) {}

  // Cache for coding schemes with TTL
  private codingSchemeCache: Map<string, { scheme: Autocoder.CodingScheme; timestamp: number }> = new Map();
  private readonly SCHEME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL

  // Cache for test files with TTL
  private testFileCache: Map<number, { files: Map<string, FileUpload>; timestamp: number }> = new Map();
  private readonly TEST_FILE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache TTL

  /**
   * Get test files from cache or fetch them from the database
   * @param workspace_id Workspace ID
   * @param unitAliasesArray Array of unit aliases to fetch
   * @returns Map of file ID to file
   */
  private async getTestFilesWithCache(workspace_id: number, unitAliasesArray: string[]): Promise<Map<string, FileUpload>> {
    // Check if we have a valid cache entry
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

  /**
   * Get coding schemes from cache or fetch them from the database
   * @param codingSchemeRefs Array of coding scheme references to fetch
   * @returns Map of scheme ID to parsed coding scheme
   */
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

  /**
   * Clean up expired items from caches
   */
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

  // Job status tracking
  private jobStatus: Map<string, { status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused'; progress: number; result?: CodingStatistics; error?: string; workspaceId?: number; createdAt?: Date }> = new Map();

  async getAllJobs(workspaceId?: number): Promise<{
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

    // First get jobs from the in-memory map for backward compatibility
    this.jobStatus.forEach((status, jobId) => {
      // If workspaceId is provided, filter jobs by workspace
      if (workspaceId !== undefined && status.workspaceId !== workspaceId) {
        return;
      }

      jobs.push({
        jobId,
        ...status
      });
    });

    try {
      const whereClause = workspaceId !== undefined ? { workspace_id: workspaceId } : {};
      const dbJobs = await this.jobRepository.find({
        where: whereClause,
        order: { created_at: 'DESC' }
      });

      for (const job of dbJobs) {
        let result: CodingStatistics | undefined;
        if (job.result) {
          try {
            result = JSON.parse(job.result) as CodingStatistics;
          } catch (error) {
            this.logger.error(`Error parsing job result: ${error.message}`, error.stack);
          }
        }

        // Check if this is a TestPersonCodingJob to get additional fields
        const isTestPersonCodingJob = job.type === 'test-person-coding';

        jobs.push({
          jobId: job.id.toString(),
          status: job.status as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused',
          progress: job.progress || 0,
          result,
          error: job.error,
          workspaceId: job.workspace_id,
          createdAt: job.created_at,
          groupNames: isTestPersonCodingJob ? (job as TestPersonCodingJob).group_names : undefined,
          durationMs: isTestPersonCodingJob ? (job as TestPersonCodingJob).duration_ms : undefined,
          completedAt: job.status === 'completed' ? job.updated_at : undefined
        });
      }
    } catch (error) {
      this.logger.error(`Error getting jobs from database: ${error.message}`, error.stack);
    }

    // Sort jobs by creation date (newest first)
    return jobs.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  private async processTestPersonsInBackground(jobId: number, workspace_id: number, personIds: string[]): Promise<void> {
    try {
      // Get the job from the database
      const job = await this.jobRepository.findOne({ where: { id: jobId } });
      if (!job) {
        this.logger.error(`Job with ID ${jobId} not found`);
        return;
      }

      // Update job status to processing
      job.status = 'processing';
      job.progress = 0;
      await this.jobRepository.save(job);

      // Clone the implementation of codeTestPersons but with progress tracking
      const result = await this.processTestPersonsBatch(workspace_id, personIds, async progress => {
        // Update job progress
        try {
          // Get the latest job status
          const currentJob = await this.jobRepository.findOne({ where: { id: jobId } });
          if (!currentJob) {
            this.logger.error(`Job with ID ${jobId} not found when updating progress`);
            return;
          }

          // Don't update if job has been cancelled or paused
          if (currentJob.status === 'cancelled' || currentJob.status === 'paused') {
            return;
          }

          // Update progress
          currentJob.progress = progress;
          await this.jobRepository.save(currentJob);
        } catch (error) {
          this.logger.error(`Error updating job progress: ${error.message}`, error.stack);
        }
      }, jobId.toString());

      // Check if job was cancelled during processing
      const currentJob = await this.jobRepository.findOne({ where: { id: jobId } });
      if (!currentJob) {
        this.logger.error(`Job with ID ${jobId} not found when checking cancellation`);
        return;
      }

      if (currentJob.status === 'cancelled' || currentJob.status === 'paused') {
        this.logger.log(`Background job ${jobId} was ${currentJob.status}`);
        return;
      }

      // Update job status to completed with result
      currentJob.status = 'completed';
      currentJob.progress = 100;
      currentJob.result = JSON.stringify(result);

      // Calculate and store job duration if it's a TestPersonCodingJob
      if (currentJob.type === 'test-person-coding' && currentJob.created_at) {
        const durationMs = Date.now() - currentJob.created_at.getTime();
        (currentJob as TestPersonCodingJob).duration_ms = durationMs;
        this.logger.log(`Job ${jobId} completed in ${durationMs}ms`);
      }

      await this.jobRepository.save(currentJob);
      this.statisticsCache.delete(workspace_id);
      this.logger.log(`Invalidated coding statistics cache for workspace ${workspace_id}`);

      this.logger.log(`Background job ${jobId} completed successfully`);
    } catch (error) {
      try {
        // Get the job from the database
        const job = await this.jobRepository.findOne({ where: { id: jobId } });
        if (!job) {
          this.logger.error(`Job with ID ${jobId} not found when handling error`);
          return;
        }

        // Don't update if job has been cancelled or paused
        if (job.status === 'cancelled' || job.status === 'paused') {
          this.logger.log(`Background job ${jobId} was ${job.status}`);
          return;
        }

        // Update job status to failed with error
        job.status = 'failed';
        job.progress = 0;
        job.error = error.message;
        await this.jobRepository.save(job);
      } catch (innerError) {
        this.logger.error(`Error updating job status: ${innerError.message}`, innerError.stack);
      }

      this.logger.error(`Background job ${jobId} failed: ${error.message}`, error.stack);
    }
  }

  async getJobStatus(jobId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused'; progress: number; result?: CodingStatistics; error?: string } | null> {
    try {
      // First check the in-memory job status map for backward compatibility
      const inMemoryStatus = this.jobStatus.get(jobId);
      if (inMemoryStatus) {
        return inMemoryStatus;
      }

      // If not found in memory, check the database
      const job = await this.jobRepository.findOne({ where: { id: parseInt(jobId, 10) } });
      if (!job) {
        return null;
      }

      // Parse the result if it exists
      let result: CodingStatistics | undefined;
      if (job.result) {
        try {
          result = JSON.parse(job.result) as CodingStatistics;
        } catch (error) {
          this.logger.error(`Error parsing job result: ${error.message}`, error.stack);
        }
      }

      return {
        status: job.status as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused',
        progress: job.progress || 0,
        result,
        error: job.error
      };
    } catch (error) {
      this.logger.error(`Error getting job status: ${error.message}`, error.stack);
      return null;
    }
  }

  async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      // First check the in-memory job status map for backward compatibility
      const inMemoryJob = this.jobStatus.get(jobId);
      if (inMemoryJob) {
        // Only pending or processing jobs can be cancelled
        if (inMemoryJob.status !== 'pending' && inMemoryJob.status !== 'processing') {
          return {
            success: false,
            message: `Job with ID ${jobId} cannot be cancelled because it is already ${inMemoryJob.status}`
          };
        }

        // Update job status to cancelled
        this.jobStatus.set(jobId, { ...inMemoryJob, status: 'cancelled' });
        this.logger.log(`In-memory job ${jobId} has been cancelled`);

        return { success: true, message: `Job ${jobId} has been cancelled successfully` };
      }

      // If not found in memory, check the database
      const job = await this.jobRepository.findOne({ where: { id: parseInt(jobId, 10) } });
      if (!job) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      // Only pending or processing jobs can be cancelled
      if (job.status !== 'pending' && job.status !== 'processing') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${job.status}`
        };
      }

      // Update job status to cancelled
      job.status = 'cancelled';
      await this.jobRepository.save(job);
      this.logger.log(`Job ${jobId} has been cancelled`);

      return { success: true, message: `Job ${jobId} has been cancelled successfully` };
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return { success: false, message: `Error cancelling job: ${error.message}` };
    }
  }

  private async isJobCancelled(jobId: string | number): Promise<boolean> {
    try {
      const inMemoryStatus = this.jobStatus.get(jobId.toString());
      if (inMemoryStatus && (inMemoryStatus.status === 'cancelled' || inMemoryStatus.status === 'paused')) {
        return true;
      }

      const job = await this.jobRepository.findOne({ where: { id: Number(jobId) } });
      return job && (job.status === 'cancelled' || job.status === 'paused');
    } catch (error) {
      this.logger.error(`Error checking job cancellation or pause: ${error.message}`, error.stack);
      return false; // Assume not cancelled or paused on error
    }
  }

  private async processTestPersonsBatch(
    workspace_id: number,
    personIds: string[],
    progressCallback?: (progress: number) => void,
    jobId?: string
  ): Promise<CodingStatistics> {
    // Clean up expired cache entries
    this.cleanupCaches();

    const startTime = Date.now();
    const metrics: { [key: string]: number } = {};

    // Initialize statistics
    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    // Report initial progress
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
      const codingSchemeRefs = new Set<string>();
      const unitToCodingSchemeRefMap = new Map();
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
          await queryRunner.release();
          return statistics;
        }
      }
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
      // Use cache for coding schemes
      const fileIdToCodingSchemeMap = await this.getCodingSchemesWithCache([...codingSchemeRefs]);
      metrics.schemeQuery = Date.now() - schemeQueryStart;
      // No separate parsing step needed as it's handled by the cache helper
      metrics.schemeParsing = 0;

      // Report progress after step 9
      if (progressCallback) {
        progressCallback(85);
      }

      // Check for cancellation or pause after step 9
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after getting coding scheme files`);
        await queryRunner.release();
        return statistics;
      }

      // Skip to step 11 (step 10 is now part of getCodingSchemesWithCache)
      const emptyScheme = new Autocoder.CodingScheme({});

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

      const allCodedResponses = [];
      const estimatedResponseCount = allResponses.length;
      allCodedResponses.length = estimatedResponseCount;
      let responseIndex = 0;

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
          await queryRunner.release();
          return statistics;
        }
      }

      allCodedResponses.length = responseIndex;
      metrics.processing = Date.now() - processingStart;

      // Report progress after step 11
      if (progressCallback) {
        progressCallback(95);
      }

      // Check for cancellation or pause after step 11
      if (jobId && await this.isJobCancelled(jobId)) {
        this.logger.log(`Job ${jobId} was cancelled or paused after processing responses`);
        await queryRunner.release();
        return statistics;
      }

      // Step 12: Update responses in database - 100% progress
      if (allCodedResponses.length > 0) {
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
              return statistics;
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
              throw error;
            }
          }

          // Commit transaction if all updates were successful
          await queryRunner.commitTransaction();
          this.logger.log(`${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`);
        } catch (error) {
          this.logger.error('Fehler beim Aktualisieren der Responses:', error.message);
          // Ensure transaction is rolled back on error
          try {
            await queryRunner.rollbackTransaction();
          } catch (rollbackError) {
            this.logger.error('Fehler beim Rollback der Transaktion:', rollbackError.message);
          }
        } finally {
          // Always release the query runner
          await queryRunner.release();
        }
        metrics.update = Date.now() - updateStart;
      } else {
        // Release query runner if no updates were performed
        await queryRunner.release();
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
            group: In(groupsOrIds)
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

    const job = this.jobRepository.create({
      workspace_id,
      person_ids: personIds.join(','),
      status: 'pending',
      progress: 0,
      // Store group names if groups were provided (not person IDs)
      group_names: !areAllNumbers ? groupsOrIds.join(',') : undefined
    });

    const savedJob = await this.jobRepository.save(job);
    this.logger.log(`Created test person coding job with ID ${savedJob.id}`);

    this.processTestPersonsInBackground(savedJob.id, workspace_id, personIds);

    return {
      totalResponses: 0,
      statusCounts: {},
      jobId: savedJob.id.toString(),
      message: `Processing ${personIds.length} test persons in the background. Check job status with jobId: ${savedJob.id}`
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
        where: { workspace_id: workspace_id }
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

  // Cache for statistics with TTL
  private statisticsCache: Map<number, { data: CodingStatistics; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 1 * 60 * 1000; // 1 minute cache TTL

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}`);

    // Check if we have a valid cached result
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
      // Optimized query: get total count and status counts in a single query
      const statusCountResults = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('response.status = :status', { status: 'VALUE_CHANGED' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id })
        .select('COALESCE(response.codedstatus, null)', 'statusValue')
        .addSelect('COUNT(response.id)', 'count')
        .groupBy('COALESCE(response.codedstatus, null)')
        .getRawMany();

      // Calculate total from the sum of all status counts
      let totalResponses = 0;

      statusCountResults.forEach(result => {
        const count = parseInt(result.count, 10);
        // Ensure count is a valid number
        const validCount = Number.isNaN(count) ? 0 : count;
        statistics.statusCounts[result.statusValue] = validCount;
        totalResponses += validCount;
      });

      statistics.totalResponses = totalResponses;

      // Cache the result
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
   * Pause a running job
   * @param jobId Job ID to pause
   * @returns Object with success flag and message
   */
  async pauseJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      // First check the in-memory job status map for backward compatibility
      const inMemoryJob = this.jobStatus.get(jobId);
      if (inMemoryJob) {
        // Only processing jobs can be paused
        if (inMemoryJob.status !== 'processing') {
          return {
            success: false,
            message: `Job with ID ${jobId} cannot be paused because it is ${inMemoryJob.status}`
          };
        }

        // Update job status to paused
        this.jobStatus.set(jobId, { ...inMemoryJob, status: 'paused' });
        this.logger.log(`In-memory job ${jobId} has been paused`);

        return { success: true, message: `Job ${jobId} has been paused successfully` };
      }

      // If not found in memory, check the database
      const job = await this.jobRepository.findOne({ where: { id: parseInt(jobId, 10) } });
      if (!job) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      // Only processing jobs can be paused
      if (job.status !== 'processing') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be paused because it is ${job.status}`
        };
      }

      // Update job status to paused
      job.status = 'paused';
      await this.jobRepository.save(job);
      this.logger.log(`Job ${jobId} has been paused`);

      return { success: true, message: `Job ${jobId} has been paused successfully` };
    } catch (error) {
      this.logger.error(`Error pausing job: ${error.message}`, error.stack);
      return { success: false, message: `Error pausing job: ${error.message}` };
    }
  }

  async resumeJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      const inMemoryJob = this.jobStatus.get(jobId);
      if (inMemoryJob) {
        if (inMemoryJob.status !== 'paused') {
          return {
            success: false,
            message: `Job with ID ${jobId} cannot be resumed because it is ${inMemoryJob.status}`
          };
        }

        this.jobStatus.set(jobId, { ...inMemoryJob, status: 'processing' });
        this.logger.log(`In-memory job ${jobId} has been resumed`);

        return { success: true, message: `Job ${jobId} has been resumed successfully` };
      }

      const job = await this.jobRepository.findOne({ where: { id: parseInt(jobId, 10) } });
      if (!job) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      if (job.status !== 'paused') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be resumed because it is ${job.status}`
        };
      }

      job.status = 'processing';
      await this.jobRepository.save(job);
      this.logger.log(`Job ${jobId} has been resumed`);

      return { success: true, message: `Job ${jobId} has been resumed successfully` };
    } catch (error) {
      this.logger.error(`Error resuming job: ${error.message}`, error.stack);
      return { success: false, message: `Error resuming job: ${error.message}` };
    }
  }
}
