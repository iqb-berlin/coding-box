import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, IsNull, Not, Repository
} from 'typeorm';
import * as crypto from 'crypto';
import {
  statusStringToNumber
} from '../../workspaces/utils/response-status-converter';
import { CacheService } from '../../cache/cache.service';
import { MissingsProfilesService } from './missings-profiles.service';
import {
  Unit, ResponseEntity, CodingStatistics, CodingStatisticsWithJob
} from '../../common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { CodebookGenerator } from '../../admin/code-book/codebook-generator.class';
import {
  CodeBookContentSetting,
  UnitPropertiesForCodebook,
  Missing
} from '../../admin/code-book/codebook.interfaces';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  ResponseAnalysisDto,
  EmptyResponseDto,
  DuplicateValueGroupDto
} from '../../../../../../api-dto/coding/response-analysis.dto';
import { CodingStatisticsService } from './coding-statistics.service';
import { VariableAnalysisReplayService } from './variable-analysis-replay.service';
import { ExportValidationResultsService } from '../../workspaces/services/export-validation-results.service';
import {
  ExternalCodingImportService,
  ExternalCodingImportBody
} from './external-coding-import.service';

import { WorkspaceFilesService } from '../../workspaces/services/workspace-files.service';
import { CodingResultsService } from './coding-results.service';
import { CodingJobService } from './coding-job.service';
import { CodingExportService } from './coding-export.service';
import { CodingListService } from './coding-list.service';
import { generateReplayUrl } from '../../utils/replay-url.util';
import { CodingFileCache } from './coding-file-cache.service';
import { CodingJobManager } from './coding-job-manager.service';
import { WorkspaceCodingFacade } from './workspace-coding-facade.service';

@Injectable()
export class WorkspaceCodingService {
  private readonly logger = new Logger(WorkspaceCodingService.name);

  constructor(
    private workspacesFacadeService: WorkspacesFacadeService,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private cacheService: CacheService,
    private missingsProfilesService: MissingsProfilesService,
    private codingStatisticsService: CodingStatisticsService,
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private externalCodingImportService: ExternalCodingImportService,
    private workspaceFilesService: WorkspaceFilesService,
    private codingResultsService: CodingResultsService,
    private codingJobService: CodingJobService,
    private codingExportService: CodingExportService,
    private codingListService: CodingListService,
    private codingFileCache: CodingFileCache,
    private codingJobManager: CodingJobManager,
    private facade: WorkspaceCodingFacade
  ) {}

  private generateExpectedCombinationsHash(
    expectedCombinations: ExpectedCombinationDto[]
  ): string {
    const sortedData = expectedCombinations
      .map(
        combo => `${combo.unit_key}|${combo.login_name}|${combo.login_code}|${combo.booklet_id}|${combo.variable_id}`
      )
      .sort()
      .join('||');

    return crypto
      .createHash('sha256')
      .update(sortedData)
      .digest('hex')
      .substring(0, 16);
  }

  private cleanupCaches(): void {
    this.codingFileCache.cleanupCaches();
  }

  async getJobStatus(
    jobId: string
  ): Promise<{
      status:
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'paused';
      progress: number;
      result?: CodingStatistics;
      error?: string;
    } | null> {
    return this.codingJobManager.getJobStatus(jobId);
  }

  async createCodingStatisticsJob(
    workspaceId: number
  ): Promise<{ jobId: string; message: string }> {
    return this.codingJobManager.createCodingStatisticsJob(workspaceId);
  }

  async cancelJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.codingJobManager.cancelJob(jobId);
  }

  async deleteJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.codingJobManager.deleteJob(jobId);
  }

  async codeTestPersons(
    workspaceId: number,
    testPersonIdsOrGroups: string,
    autoCoderRun: number = 1
  ): Promise<CodingStatisticsWithJob> {
    return this.facade.codeTestPersons(workspaceId, testPersonIdsOrGroups, autoCoderRun);
  }

  async processTestPersonsBatch(
    workspaceId: number,
    options: { personIds: number[]; autoCoderRun?: number; jobId?: string },
    progressCallback?: (progress: number) => void
  ): Promise<CodingStatistics> {
    return this.facade.processTestPersonsBatch(workspaceId, options, progressCallback);
  }

  async getManualTestPersons(
    workspaceId: number,
    personIds?: string
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.facade.getManualTestPersons(workspaceId, personIds);
  }

  async getCodingStatistics(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(
      workspace_id,
      version
    );
  }

  async generateCodebook(
    workspaceId: number,
    missingsProfile: number,
    contentOptions: CodeBookContentSetting,
    unitIds: number[]
  ): Promise<Buffer | null> {
    try {
      this.logger.log(
        `Generating codebook for workspace ${workspaceId} with ${unitIds.length} units`
      );
      const units = await this.workspacesFacadeService.findFilesByIds(unitIds);

      if (!units || units.length === 0) {
        this.logger.warn(
          `No units found for workspace ${workspaceId} with IDs ${unitIds}`
        );
        return null;
      }

      const unitProperties: UnitPropertiesForCodebook[] = units.map(unit => ({
        id: unit.id,
        key: unit.file_id,
        name: unit.filename.toLowerCase().endsWith('.vocs') ?
          unit.filename.substring(0, unit.filename.length - 5) :
          unit.filename,
        scheme: unit.data || ''
      }));

      let missings: Missing[] = [];

      if (missingsProfile) {
        const profile =
          await this.missingsProfilesService.getMissingsProfileDetails(
            workspaceId,
            missingsProfile
          );
        if (profile && profile.missings) {
          try {
            const profileMissings =
              typeof profile.missings === 'string' ?
                JSON.parse(profile.missings) :
                profile.missings;
            if (Array.isArray(profileMissings) && profileMissings.length > 0) {
              missings = profileMissings.map(m => ({
                code: m.code.toString(),
                label: m.label,
                description: m.description
              }));
            }
          } catch (parseError) {
            this.logger.error(
              `Error parsing missings from profile: ${parseError.message}`,
              parseError.stack
            );
          }
        }
      }

      return await CodebookGenerator.generateCodebook(
        unitProperties,
        contentOptions,
        missings
      );
    } catch (error) {
      this.logger.error(
        `Error generating codebook for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  async pauseJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.codingJobManager.pauseJob(jobId);
  }

  async resumeJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.codingJobManager.resumeJob(jobId);
  }

  async restartJob(
    jobId: string
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    return this.codingJobManager.restartJob(jobId);
  }

  async getBullJobs(workspaceId: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]
  > {
    return this.codingJobManager.getBullJobs(workspaceId);
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
    return this.exportValidationResultsService.exportValidationResultsAsExcel(
      workspaceId,
      cacheKey
    );
  }

  async validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<ValidateCodingCompletenessResponseDto> {
    try {
      this.logger.log(
        `Validating coding completeness for workspace ${workspaceId} with ${expectedCombinations.length} expected combinations`
      );
      const startTime = Date.now();

      const combinationsHash =
        this.generateExpectedCombinationsHash(expectedCombinations);
      const cacheKey = this.cacheService.generateValidationCacheKey(
        workspaceId,
        combinationsHash
      );

      // Try to get paginated results from cache first
      let cachedResults = await this.cacheService.getPaginatedValidationResults(
        cacheKey,
        page,
        pageSize
      );

      if (cachedResults) {
        this.logger.log(
          `Returning cached validation results for workspace ${workspaceId} (page ${page})`
        );
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
        this.logger.log(
          `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            expectedCombinations.length / batchSize
          )}`
        );

        for (const expected of batch) {
          const responseExists = await this.workspacesFacadeService.checkResponseExists(
            expected.unit_key,
            expected.login_name,
            expected.login_code,
            expected.booklet_id,
            expected.variable_id
          );
          const count = responseExists ? 1 : 0;

          const status = count > 0 ? 'EXISTS' : 'MISSING';
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

      const cacheSuccess = await this.cacheService.storeValidationResults(
        cacheKey,
        allResults,
        metadata
      );

      if (cacheSuccess) {
        this.logger.log(
          `Successfully cached validation results for workspace ${workspaceId}`
        );
      } else {
        this.logger.warn(
          `Failed to cache validation results for workspace ${workspaceId}`
        );
      }

      cachedResults = await this.cacheService.getPaginatedValidationResults(
        cacheKey,
        page,
        pageSize
      );

      const endTime = Date.now();
      this.logger.log(
        `Validation completed in ${endTime - startTime}ms. Processed all ${
          expectedCombinations.length
        } combinations with ${totalMissingCount} missing responses.`
      );

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
      const endIndex = Math.min(
        startIndex + pageSize,
        expectedCombinations.length
      );
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
      this.logger.error(
        `Error validating coding completeness: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not validate coding completeness. Please check the database connection or query.'
      );
    }
  }

  async getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string
  ): Promise<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
    }[]
    > {
    try {
      if (unitName) {
        this.logger.log(
          `Querying CODING_INCOMPLETE variables for workspace ${workspaceId} and unit ${unitName} (not cached)`
        );
        const variables = await this.fetchCodingIncompleteVariablesFromDb(
          workspaceId,
          unitName
        );
        return await this.enrichVariablesWithCaseInfo(workspaceId, variables);
      }
      const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
      const cachedResult = await this.cacheService.get<
      {
        unitName: string;
        variableId: string;
        responseCount: number;
        casesInJobs: number;
        availableCases: number;
      }[]
      >(cacheKey);
      if (cachedResult) {
        this.logger.log(
          `Retrieved ${cachedResult.length} CODING_INCOMPLETE variables from cache for workspace ${workspaceId}`
        );
        return cachedResult;
      }
      this.logger.log(
        `Cache miss: Querying CODING_INCOMPLETE variables for workspace ${workspaceId}`
      );
      const variables = await this.fetchCodingIncompleteVariablesFromDb(
        workspaceId
      );
      const result = await this.enrichVariablesWithCaseInfo(
        workspaceId,
        variables
      );

      const cacheSet = await this.cacheService.set(cacheKey, result, 300); // Cache for 5 minutes
      if (cacheSet) {
        this.logger.log(
          `Cached ${result.length} CODING_INCOMPLETE variables for workspace ${workspaceId}`
        );
      } else {
        this.logger.warn(
          `Failed to cache CODING_INCOMPLETE variables for workspace ${workspaceId}`
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Error getting CODING_INCOMPLETE variables: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get CODING_INCOMPLETE variables. Please check the database connection.'
      );
    }
  }

  /**
   * Enrich variables with case information (cases in jobs and available cases)
   */
  private async enrichVariablesWithCaseInfo(
    workspaceId: number,
    variables: { unitName: string; variableId: string; responseCount: number }[]
  ): Promise<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
    }[]
    > {
    const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);

    return variables.map(variable => {
      const key = `${variable.unitName}::${variable.variableId}`;
      const casesInJobs = casesInJobsMap.get(key) || 0;
      const availableCases = Math.max(0, variable.responseCount - casesInJobs);

      return {
        ...variable,
        casesInJobs,
        availableCases
      };
    });
  }

  private async fetchCodingIncompleteVariablesFromDb(
    workspaceId: number,
    unitName?: string
  ): Promise<
    { unitName: string; variableId: string; responseCount: number }[]
    > {
    const validRows = await this.workspacesFacadeService.findCodingIncompleteVariablesWithCounts(workspaceId, unitName);

    const rawResults = validRows; // API matches, maybe different types for count? Facade returns string count usually from raw query.

    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(
      workspaceId
    );

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitNameKey: string) => {
      validVariableSets.set(unitNameKey.toUpperCase(), variables);
    });

    const filteredResult = rawResults.filter(row => {
      const unitNamesValidVars = validVariableSets.get(
        row.unitName?.toUpperCase()
      );
      return unitNamesValidVars?.has(row.variableId);
    });

    const result = filteredResult.map(row => ({
      unitName: row.unitName,
      variableId: row.variableId,
      responseCount: parseInt(row.responseCount, 10)
    }));

    this.logger.log(
      `Found ${
        rawResults.length
      } CODING_INCOMPLETE variable groups, filtered to ${
        filteredResult.length
      } valid variables${unitName ? ` for unit ${unitName}` : ''}`
    );

    return result;
  }

  private generateIncompleteVariablesCacheKey(workspaceId: number): string {
    return `coding_incomplete_variables:${workspaceId}`;
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
    await this.cacheService.delete(cacheKey);
    this.logger.log(
      `Invalidated CODING_INCOMPLETE variables cache for workspace ${workspaceId}`
    );
  }

  /**
   * Get the number of unique cases (response_ids) already assigned to coding jobs for each variable
   * This counts distinct response_ids to properly handle double-coding scenarios
   */
  async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const rawResults = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    this.logger.log(
      `Found cases in jobs for ${casesInJobsMap.size} variables in workspace ${workspaceId}`
    );

    return casesInJobsMap;
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
    const result =
      await this.externalCodingImportService.importExternalCodingWithProgress(
        workspaceId,
        body,
        progressCallback
      );

    if (result.updatedRows > 0) {
      await this.invalidateIncompleteVariablesCache(workspaceId);
      this.logger.log(
        `Invalidated incomplete variables cache for workspace ${workspaceId} after importing ${result.updatedRows} external coding results`
      );
    }

    return result;
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
    return this.externalCodingImportService.importExternalCoding(
      workspaceId,
      body
    );
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
          data: [],
          total: 0,
          page,
          limit
        };
      }

      const offset = (page - 1) * limit;
      const result = await this.workspacesFacadeService.findResponsesByStatus(
        workspaceId,
        statusNumber,
        version,
        offset,
        limit
      );
      this.logger.log(
        `Retrieved ${result.data.length} responses with status ${status} for version ${version} in workspace ${workspaceId}`
      );

      return {
        data: result.data,
        total: result.total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Error getting responses by status: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not retrieve responses. Please check the database connection or query.'
      );
    }
  }

  async generateReplayUrlForResponse(
    workspaceId: number,
    responseId: number,
    serverUrl: string,
    authToken: string
  ): Promise<{ replayUrl: string }> {
    try {
      const response = await this.workspacesFacadeService.findResponseByIdWithRelations(responseId);

      if (!response) {
        throw new Error(`Response with id ${responseId} not found`);
      }

      const person = response.unit?.booklet?.person;
      if (!person || person.workspace_id !== workspaceId) {
        throw new Error(
          `Response ${responseId} does not belong to workspace ${workspaceId}`
        );
      }

      const unitName = response.unit?.name || '';
      const variableId = response.variableid || '';
      const loginName = person.login || '';
      const loginCode = person.code || '';
      const loginGroup = person.group || '';
      const bookletId = response.unit?.booklet?.bookletinfo?.name || '';

      // Get the variable page from VOUD data
      this.logger.log(
        `Looking up variablePage for unit '${unitName}', variable '${variableId}' in workspace ${workspaceId}`
      );
      const variablePageMap = await this.codingListService.getVariablePageMap(
        unitName,
        workspaceId
      );
      this.logger.log(
        `VOUD lookup result: variablePageMap has ${variablePageMap.size} entries for unit '${unitName}'`
      );
      const variablePage = variablePageMap.get(variableId) || '0';
      this.logger.log(
        `Variable '${variableId}' resolved to page '${variablePage}' (found in map: ${variablePageMap.has(
          variableId
        )})`
      );

      const replayUrl = generateReplayUrl({
        serverUrl,
        loginName,
        loginCode,
        loginGroup,
        bookletId,
        unitId: unitName,
        variablePage,
        variableAnchor: variableId,
        authToken
      });

      this.logger.log(
        `Generated replay URL for response ${responseId} in workspace ${workspaceId}`
      );

      return { replayUrl };
    } catch (error) {
      this.logger.error(
        `Error generating replay URL for response ${responseId}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  async generateReplayUrlsForItems(
    workspaceId: number,
    items: Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
    }>,
    serverUrl: string
  ): Promise<
    Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      replayUrl: string;
    }>
    > {
    return Promise.all(
      items.map(async item => {
        try {
          const result = await this.generateReplayUrlForResponse(
            workspaceId,
            item.responseId,
            serverUrl,
            ''
          );
          const replayUrlWithoutAuth = result.replayUrl.replace('?auth=', '');
          return {
            ...item,
            replayUrl: replayUrlWithoutAuth
          };
        } catch (error) {
          this.logger.warn(
            `Failed to generate replay URL for response ${item.responseId}: ${error.message}`
          );
          return {
            ...item,
            replayUrl: ''
          };
        }
      })
    );
  }

  async applyCodingResults(
    workspaceId: number,
    codingJobId: number
  ): Promise<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }> {
    const result = await this.codingResultsService.applyCodingResults(
      workspaceId,
      codingJobId
    );

    if (result.success && result.updatedResponsesCount > 0) {
      await this.invalidateIncompleteVariablesCache(workspaceId);
      this.logger.log(
        `Invalidated incomplete variables cache for workspace ${workspaceId} after applying ${result.updatedResponsesCount} coding results`
      );
    }

    return result;
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: {
        id: number;
        name: string;
        variables: { unitName: string; variableId: string }[];
      }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
    }
  ): Promise<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<
      string,
      {
        totalCases: number;
        doubleCodedCases: number;
        singleCodedCasesAssigned: number;
        doubleCodedCasesPerCoder: Record<string, number>;
      }
      >;
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    return this.codingJobService.createDistributedCodingJobs(
      workspaceId,
      request
    );
  }

  async exportCodingResultsAggregated(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false
  ): Promise<Buffer> {
    return this.codingExportService.exportCodingResultsAggregated(
      workspaceId,
      outputCommentsInsteadOfCodes
    );
  }

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false
  ): Promise<Buffer> {
    return this.codingExportService.exportCodingResultsByVariable(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes
    );
  }

  async bulkApplyCodingResults(workspaceId: number): Promise<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    message: string;
    results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }>;
  }> {
    this.logger.log(
      `Starting bulk apply coding results for workspace ${workspaceId}`
    );

    const codingJobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'name']
    });

    const results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }> = [];

    let totalUpdatedResponses = 0;
    let totalSkippedReview = 0;
    let jobsProcessed = 0;

    for (const job of codingJobs) {
      const hasIssues = await this.codingJobService.hasCodingIssues(job.id);

      if (hasIssues) {
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: true,
          skipped: true
        });
        continue;
      }

      try {
        const applyResult = await this.applyCodingResults(workspaceId, job.id);
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: false,
          result: {
            success: applyResult.success,
            updatedResponsesCount: applyResult.updatedResponsesCount,
            skippedReviewCount: applyResult.skippedReviewCount,
            message: applyResult.messageKey || 'Apply result'
          }
        });

        if (applyResult.success) {
          totalUpdatedResponses += applyResult.updatedResponsesCount;
          totalSkippedReview += applyResult.skippedReviewCount;
          jobsProcessed += 1;
        }
      } catch (error) {
        this.logger.error(
          `Error applying results for job ${job.id}: ${error.message}`
        );
        results.push({
          jobId: job.id,
          jobName: job.name,
          hasIssues: false,
          skipped: false,
          result: {
            success: false,
            updatedResponsesCount: 0,
            skippedReviewCount: 0,
            message: `Error: ${error.message}`
          }
        });
      }
    }

    const message = `Bulk apply completed. Processed ${jobsProcessed} jobs, updated ${totalUpdatedResponses} responses, skipped ${totalSkippedReview} for review. ${
      results.filter(r => r.hasIssues).length
    } jobs skipped due to coding issues.`;

    this.logger.log(message);

    return {
      success: true,
      jobsProcessed,
      totalUpdatedResponses,
      totalSkippedReview,
      message,
      results
    };
  }

  async getCodingProgressOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
  }> {
    const totalCasesToCode = await this.workspacesFacadeService.countCodingIncompleteResponses(workspaceId);

    const completedCases = await this.codingJobUnitRepository.count({
      where: {
        coding_job: {
          workspace_id: workspaceId,
          training_id: IsNull()
        },
        code: Not(IsNull())
      }
    });

    const completionPercentage =
      totalCasesToCode > 0 ? (completedCases / totalCasesToCode) * 100 : 0;

    return {
      totalCasesToCode,
      completedCases,
      completionPercentage
    };
  }

  async getCaseCoverageOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    casesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    coveragePercentage: number;
  }> {
    const totalCasesToCode = await this.workspacesFacadeService.countCodingIncompleteResponses(workspaceId);

    const casesInJobs = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .getCount();

    const uniqueCasesInJobsResult = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .select('COUNT(DISTINCT cju.response_id)', 'count')
      .getRawOne();

    const uniqueCasesInJobs = parseInt(
      uniqueCasesInJobsResult?.count || '0',
      10
    );

    const doubleCodedCases = casesInJobs - uniqueCasesInJobs;

    const singleCodedCases = uniqueCasesInJobs;
    const unassignedCases = totalCasesToCode - uniqueCasesInJobs;
    const coveragePercentage =
      totalCasesToCode > 0 ? (uniqueCasesInJobs / totalCasesToCode) * 100 : 0;

    return {
      totalCasesToCode,
      casesInJobs,
      doubleCodedCases,
      singleCodedCases,
      unassignedCases,
      coveragePercentage
    };
  }

  async getVariableCoverageOverview(workspaceId: number): Promise<{
    totalVariables: number;
    coveredVariables: number;
    coveredByDraft: number;
    coveredByPendingReview: number;
    coveredByApproved: number;
    conflictedVariables: number;
    missingVariables: number;
    partiallyAbgedeckteVariablen: number;
    fullyAbgedeckteVariablen: number;
    coveragePercentage: number;
    variableCaseCounts: {
      unitName: string;
      variableId: string;
      caseCount: number;
    }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{
        variableKey: string;
        conflictingDefinitions: Array<{
          id: number;
          status: string;
        }>;
      }>;
    };
  }> {
    try {
      this.logger.log(
        `Getting variable coverage overview for workspace ${workspaceId} (CODING_INCOMPLETE variables only)`
      );

      const rawResult = await this.workspacesFacadeService.findCodingIncompleteVariablesWithCounts(workspaceId);
      const incompleteVariablesResult = rawResult.map(row => ({
        unitName: row.unitName,
        variableId: row.variableId,
        caseCount: row.responseCount
      }));

      const variablesNeedingCoding = new Set<string>();
      const variableCaseCounts: {
        unitName: string;
        variableId: string;
        caseCount: number;
      }[] = [];

      incompleteVariablesResult.forEach(row => {
        const variableKey = `${row.unitName}:${row.variableId}`;
        variablesNeedingCoding.add(variableKey);
        variableCaseCounts.push({
          unitName: row.unitName,
          variableId: row.variableId,
          caseCount: parseInt(row.caseCount, 10)
        });
      });

      const jobDefinitions = await this.jobDefinitionRepository.find({
        where: { workspace_id: workspaceId }
      });

      const coveredVariables = new Set<string>();
      const coverageByStatus = {
        draft: new Set<string>(),
        pending_review: new Set<string>(),
        approved: new Set<string>()
      };

      const variableToDefinitions = new Map<
      string,
      Array<{ id: number; status: string }>
      >();

      for (const definition of jobDefinitions) {
        const definitionVariables = new Set<string>();

        if (definition.assigned_variables) {
          definition.assigned_variables.forEach(variable => {
            const variableKey = `${variable.unitName}:${variable.variableId}`;
            if (variablesNeedingCoding.has(variableKey)) {
              definitionVariables.add(variableKey);
            }
          });
        }

        if (definition.assigned_variable_bundles) {
          const bundleIds = definition.assigned_variable_bundles.map(
            bundle => bundle.id
          );
          const variableBundles = await this.variableBundleRepository.find({
            where: { id: In(bundleIds) }
          });

          variableBundles.forEach(bundle => {
            if (bundle.variables) {
              bundle.variables.forEach(variable => {
                const variableKey = `${variable.unitName}:${variable.variableId}`;
                if (variablesNeedingCoding.has(variableKey)) {
                  definitionVariables.add(variableKey);
                }
              });
            }
          });
        }

        definitionVariables.forEach(variableKey => {
          coveredVariables.add(variableKey);
          coverageByStatus[definition.status].add(variableKey);

          if (!variableToDefinitions.has(variableKey)) {
            variableToDefinitions.set(variableKey, []);
          }
          variableToDefinitions.get(variableKey)!.push({
            id: definition.id,
            status: definition.status
          });
        });
      }

      const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);

      const conflictedVariables = new Map<
      string,
      Array<{ id: number; status: string }>
      >();
      variableToDefinitions.forEach((definitions, variableKey) => {
        if (definitions.length > 1) {
          // Only report as conflict if there aren't enough available cases
          const [unitName, variableId] = variableKey.split(':');
          const variableCaseInfo = variableCaseCounts.find(
            v => v.unitName === unitName && v.variableId === variableId
          );

          if (variableCaseInfo) {
            const casesInJobs =
              casesInJobsMap.get(
                `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
              ) || 0;
            const availableCases = variableCaseInfo.caseCount - casesInJobs;

            // Only mark as conflict if there are no available cases left
            if (availableCases <= 0) {
              conflictedVariables.set(variableKey, definitions);
            }
          }
        }
      });

      const missingVariables = new Set<string>();
      const partiallyAbgedeckteVariablen = new Set<string>();
      const fullyAbgedeckteVariablen = new Set<string>();

      variablesNeedingCoding.forEach(variableKey => {
        if (!coveredVariables.has(variableKey)) {
          missingVariables.add(variableKey);
          return;
        }

        // Check if variable is fully or partially covered based on cases in jobs
        const variableCaseInfo = variableCaseCounts.find(
          v => `${v.unitName}:${v.variableId}` === variableKey
        );

        if (variableCaseInfo) {
          const casesInJobs =
            casesInJobsMap.get(
              `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
            ) || 0;

          if (casesInJobs >= variableCaseInfo.caseCount) {
            fullyAbgedeckteVariablen.add(variableKey);
          } else if (casesInJobs > 0) {
            partiallyAbgedeckteVariablen.add(variableKey);
          }
        }
      });

      const totalVariables = variablesNeedingCoding.size;
      const coveredCount = coveredVariables.size;
      const draftCount = coverageByStatus.draft.size;
      const pendingReviewCount = coverageByStatus.pending_review.size;
      const approvedCount = coverageByStatus.approved.size;
      const conflictCount = conflictedVariables.size;
      const missingCount = missingVariables.size;
      const partiallyAbgedeckteCount = partiallyAbgedeckteVariablen.size;
      const fullyAbgedeckteCount = fullyAbgedeckteVariablen.size;
      const coveragePercentage =
        totalVariables > 0 ? (coveredCount / totalVariables) * 100 : 0;

      this.logger.log(
        `Variable coverage for workspace ${workspaceId}: ${coveredCount}/${totalVariables} CODING_INCOMPLETE variables covered (${coveragePercentage.toFixed(
          1
        )}%) - Draft: ${draftCount}, Pending: ${pendingReviewCount}, Approved: ${approvedCount}, Conflicted: ${conflictCount}, Fully covered: ${fullyAbgedeckteCount}, Partially covered: ${partiallyAbgedeckteCount}`
      );

      return {
        totalVariables,
        coveredVariables: coveredCount,
        coveredByDraft: draftCount,
        coveredByPendingReview: pendingReviewCount,
        coveredByApproved: approvedCount,
        conflictedVariables: conflictCount,
        missingVariables: missingCount,
        partiallyAbgedeckteVariablen: partiallyAbgedeckteCount,
        fullyAbgedeckteVariablen: fullyAbgedeckteCount,
        coveragePercentage,
        variableCaseCounts,
        coverageByStatus: {
          draft: Array.from(coverageByStatus.draft),
          pending_review: Array.from(coverageByStatus.pending_review),
          approved: Array.from(coverageByStatus.approved),
          conflicted: Array.from(conflictedVariables.entries()).map(
            ([variableKey, definitions]) => ({
              variableKey,
              conflictingDefinitions: definitions
            })
          )
        }
      };
    } catch (error) {
      this.logger.error(
        `Error getting variable coverage overview: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get variable coverage overview. Please check the database connection.'
      );
    }
  }

  async getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50
  ): Promise<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      this.logger.log(
        `Getting double-coded variables for review in workspace ${workspaceId}`
      );
      const doubleCodedResponseIds = await this.codingJobUnitRepository
        .createQueryBuilder('cju')
        .select('cju.response_id', 'responseId')
        .addSelect('COUNT(DISTINCT cju.coding_job_id)', 'jobCount')
        .leftJoin('cju.coding_job', 'cj')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .andWhere('cju.code IS NOT NULL') // Only include coded responses
        .groupBy('cju.response_id')
        .having('COUNT(DISTINCT cju.coding_job_id) > 1') // Multiple jobs coded this response
        .getRawMany();

      const responseIds = doubleCodedResponseIds.map(row => row.responseId);

      if (responseIds.length === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }
      const total = responseIds.length;
      const startIndex = (page - 1) * limit;
      const endIndex = Math.min(startIndex + limit, responseIds.length);
      const paginatedResponseIds = responseIds.slice(startIndex, endIndex);

      const codingJobUnits = await this.codingJobUnitRepository.find({
        where: { response_id: In(paginatedResponseIds) },
        relations: [
          'coding_job',
          'coding_job.codingJobCoders',
          'coding_job.codingJobCoders.user',
          'response',
          'response.unit',
          'response.unit.booklet',
          'response.unit.booklet.person'
        ]
      });

      const responseGroups = new Map<
      number,
      {
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }
      >();

      for (const unit of codingJobUnits) {
        const responseId = unit.response_id;

        if (!responseGroups.has(responseId)) {
          responseGroups.set(responseId, {
            responseId: responseId,
            unitName: unit.response?.unit?.name || '',
            variableId: unit.variable_id,
            personLogin: unit.response?.unit?.booklet?.person?.login || '',
            personCode: unit.response?.unit?.booklet?.person?.code || '',
            bookletName: unit.response?.unit?.booklet?.bookletinfo?.name || '',
            givenAnswer: unit.response?.value || '',
            coderResults: []
          });
        }

        const group = responseGroups.get(responseId)!;

        const coder = unit.coding_job?.codingJobCoders?.[0]; // Assuming one coder per job
        if (coder) {
          group.coderResults.push({
            coderId: coder.user_id,
            coderName: coder.user?.username || `Coder ${coder.user_id}`,
            jobId: unit.coding_job_id,
            code: unit.code,
            score: unit.score,
            notes: unit.notes,
            codedAt: unit.created_at
          });
        }
      }

      const data = Array.from(responseGroups.values());

      this.logger.log(
        `Found ${total} double-coded variables for review in workspace ${workspaceId}, returning page ${page} with ${data.length} items`
      );

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Error getting double-coded variables for review: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get double-coded variables for review. Please check the database connection.'
      );
    }
  }

  async applyDoubleCodedResolutions(
    workspaceId: number,
    decisions: Array<{
      responseId: number;
      selectedJobId: number;
      resolutionComment?: string;
    }>
  ): Promise<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
    }> {
    try {
      this.logger.log(
        `Applying ${decisions.length} double-coded resolutions in workspace ${workspaceId}`
      );

      let appliedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const decision of decisions) {
        try {
          // Get the selected coder's coding_job_unit entry
          const selectedCodingJobUnit =
            await this.codingJobUnitRepository.findOne({
              where: {
                response_id: decision.responseId,
                coding_job_id: decision.selectedJobId
              },
              relations: ['response', 'coding_job']
            });

          if (!selectedCodingJobUnit) {
            this.logger.warn(
              `Could not find coding_job_unit for responseId ${decision.responseId} and jobId ${decision.selectedJobId}`
            );
            skippedCount += 1;
            continue;
          }

          if (selectedCodingJobUnit.coding_job?.workspace_id !== workspaceId) {
            this.logger.warn(
              `Workspace mismatch for responseId ${decision.responseId}`
            );
            skippedCount += 1;
            continue;
          }

          const response = selectedCodingJobUnit.response;
          if (!response) {
            this.logger.warn(
              `Could not find response for responseId ${decision.responseId}`
            );
            skippedCount += 1;
            continue;
          }

          let updatedValue = response.value || '';
          if (decision.resolutionComment && decision.resolutionComment.trim()) {
            const timestamp = new Date()
              .toISOString()
              .replace('T', ' ')
              .substring(0, 16);
            const resolutionNote = `[RESOLUTION - ${timestamp}]: ${decision.resolutionComment.trim()}\n`;
            updatedValue = resolutionNote + updatedValue;
          }

          response.status_v2 = statusStringToNumber('CODING_COMPLETE');
          response.code_v2 = selectedCodingJobUnit.code;
          response.score_v2 = selectedCodingJobUnit.score;
          response.value = updatedValue;

          await this.workspacesFacadeService.saveResponse(response);
          appliedCount += 1;

          this.logger.debug(
            `Applied resolution for responseId ${decision.responseId}: code=${selectedCodingJobUnit.code}, score=${selectedCodingJobUnit.score}`
          );
        } catch (error) {
          this.logger.error(
            `Error applying resolution for responseId ${decision.responseId}: ${error.message}`,
            error.stack
          );
          failedCount += 1;
        }
      }

      const message = `Applied ${appliedCount} resolutions successfully. ${
        failedCount > 0 ? `${failedCount} failed.` : ''
      } ${skippedCount > 0 ? `${skippedCount} skipped.` : ''}`;
      this.logger.log(message);

      return {
        success: appliedCount > 0,
        appliedCount,
        failedCount,
        skippedCount,
        message
      };
    } catch (error) {
      this.logger.error(
        `Error applying double-coded resolutions: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not apply double-coded resolutions. Please check the database connection.'
      );
    }
  }

  async getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Promise<number> {
    try {
      this.logger.log(
        `Getting applied results count for ${incompleteVariables.length} CODING_INCOMPLETE variables in workspace ${workspaceId}`
      );

      if (incompleteVariables.length === 0) {
        return 0;
      }

      let totalAppliedCount = 0;
      const batchSize = 50;
      for (let i = 0; i < incompleteVariables.length; i += batchSize) {
        const batch = incompleteVariables.slice(i, i + batchSize);

        const conditions = batch
          .map(
            variable => `(unit.name = '${variable.unitName.replace(
              /'/g,
              "''"
            )}' AND response.variableid = '${variable.variableId.replace(
              /'/g,
              "''"
            )}')`
          )
          .join(' OR ');

        const query = `
          SELECT COUNT(response.id) as applied_count
          FROM response
          INNER JOIN unit ON response.unitid = unit.id
          INNER JOIN booklet ON unit.bookletid = booklet.id
          INNER JOIN persons person ON booklet.personid = person.id
          WHERE person.workspace_id = $1
            AND person.consider = true
            AND response.status_v1 = $2
            AND (${conditions})
            AND response.status_v2 IN ($3, $4, $5)
        `;

        const result = await this.workspacesFacadeService.queryResponses(query, [
          workspaceId,
          statusStringToNumber('CODING_INCOMPLETE'), // status_v1 = CODING_INCOMPLETE
          statusStringToNumber('CODING_COMPLETE'), // status_v2 = CODING_COMPLETE
          statusStringToNumber('INVALID'), // status_v2 = INVALID
          statusStringToNumber('CODING_ERROR') // status_v2 = CODING_ERROR
        ]);

        const batchCount = parseInt(result[0]?.applied_count || '0', 10);
        totalAppliedCount += batchCount;

        this.logger.debug(
          `Batch ${
            Math.floor(i / batchSize) + 1
          }: ${batchCount} applied results`
        );
      }

      this.logger.log(
        `Total applied results count for workspace ${workspaceId}: ${totalAppliedCount}`
      );
      return totalAppliedCount;
    } catch (error) {
      this.logger.error(
        `Error getting applied results count: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get applied results count. Please check the database connection.'
      );
    }
  }

  async getWorkspaceCohensKappaSummary(workspaceId: number): Promise<{
    coderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      kappa: number | null;
      agreement: number;
      totalSharedResponses: number;
      validPairs: number;
      interpretation: string;
    }>;
    workspaceSummary: {
      totalDoubleCodedResponses: number;
      totalCoderPairs: number;
      averageKappa: number | null;
      variablesIncluded: number;
      codersIncluded: number;
    };
  }> {
    try {
      this.logger.log(
        `Calculating workspace-wide Cohen's Kappa for double-coded incomplete variables in workspace ${workspaceId}`
      );

      const doubleCodedData = await this.getDoubleCodedVariablesForReview(
        workspaceId,
        1,
        10000
      ); // Get all data

      if (doubleCodedData.total === 0) {
        return {
          coderPairs: [],
          workspaceSummary: {
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            variablesIncluded: 0,
            codersIncluded: 0
          }
        };
      }

      const coderPairData = new Map<
      string,
      {
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        codes: Array<{ code1: number | null; code2: number | null }>;
      }
      >();

      const uniqueVariables = new Set<string>();
      const uniqueCoders = new Set<number>();

      for (const item of doubleCodedData.data) {
        uniqueVariables.add(`${item.unitName}:${item.variableId}`);

        const coders = item.coderResults;
        for (let i = 0; i < coders.length; i++) {
          for (let j = i + 1; j < coders.length; j++) {
            const coder1 = coders[i];
            const coder2 = coders[j];

            uniqueCoders.add(coder1.coderId);
            uniqueCoders.add(coder2.coderId);

            const pairKey =
              coder1.coderId < coder2.coderId ?
                `${coder1.coderId}-${coder2.coderId}` :
                `${coder2.coderId}-${coder1.coderId}`;

            if (!coderPairData.has(pairKey)) {
              coderPairData.set(pairKey, {
                coder1Id:
                  coder1.coderId < coder2.coderId ?
                    coder1.coderId :
                    coder2.coderId,
                coder1Name:
                  coder1.coderId < coder2.coderId ?
                    coder1.coderName :
                    coder2.coderName,
                coder2Id:
                  coder1.coderId < coder2.coderId ?
                    coder2.coderId :
                    coder1.coderId,
                coder2Name:
                  coder1.coderId < coder2.coderId ?
                    coder2.coderName :
                    coder1.coderName,
                codes: []
              });
            }

            const pair = coderPairData.get(pairKey)!;
            if (coder1.coderId < coder2.coderId) {
              pair.codes.push({
                code1: coder1.code,
                code2: coder2.code
              });
            } else {
              pair.codes.push({
                code1: coder2.code,
                code2: coder1.code
              });
            }
          }
        }
      }

      const coderPairs = [];
      let totalKappa = 0;
      let validKappaCount = 0;

      for (const pair of coderPairData.values()) {
        const kappaResults = this.codingStatisticsService.calculateCohensKappa([
          pair
        ]);

        if (kappaResults.length > 0) {
          const result = kappaResults[0];
          coderPairs.push(result);

          if (result.kappa !== null && !Number.isNaN(result.kappa)) {
            totalKappa += result.kappa;
            validKappaCount += 1;
          }
        }
      }

      const averageKappa =
        validKappaCount > 0 ? totalKappa / validKappaCount : null;

      const workspaceSummary = {
        totalDoubleCodedResponses: doubleCodedData.total,
        totalCoderPairs: coderPairs.length,
        averageKappa: Math.round((averageKappa || 0) * 1000) / 1000,
        variablesIncluded: uniqueVariables.size,
        codersIncluded: uniqueCoders.size
      };

      this.logger.log(
        `Calculated workspace-wide Cohen's Kappa: ${coderPairs.length} coder pairs, ${uniqueVariables.size} variables, ${uniqueCoders.size} coders, average kappa: ${averageKappa}`
      );

      return {
        coderPairs,
        workspaceSummary
      };
    } catch (error) {
      this.logger.error(
        `Error calculating workspace-wide Cohen's Kappa: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not calculate workspace-wide Cohen's Kappa. Please check the database connection."
      );
    }
  }

  async resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<{
      affectedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    try {
      this.logger.log(
        `Starting reset for version ${version} in workspace ${workspaceId}, filters: units=${unitFilters?.join(
          ','
        )}, variables=${variableFilters?.join(',')}`
      );

      // Determine which versions to reset
      const versionsToReset: ('v1' | 'v2' | 'v3')[] = [version];
      if (version === 'v2') {
        versionsToReset.push('v3'); // Cascade: resetting v2 also resets v3
      }

      const responseIds = await this.workspacesFacadeService.findResponseIdsForReset(
        workspaceId,
        unitFilters,
        variableFilters
      );
      const affectedResponseCount = responseIds.length;

      if (affectedResponseCount === 0) {
        this.logger.log(`No responses found to reset for version ${version}`);
        return {
          affectedResponseCount: 0,
          cascadeResetVersions: version === 'v2' ? ['v3'] : [],
          message: `No responses found matching the filters for version ${version}`
        };
      }

      const updateObj: Record<string, null> = {};
      versionsToReset.forEach(v => {
        updateObj[`status_${v}`] = null;
        updateObj[`code_${v}`] = null;
        updateObj[`score_${v}`] = null;
      });

      const batchSize = 5000;

      for (let i = 0; i < responseIds.length; i += batchSize) {
        const batchIds = responseIds.slice(i, i + batchSize);
        await this.workspacesFacadeService.resetResponseValues(batchIds, updateObj);
      }

      this.logger.log(
        `Reset successful: ${affectedResponseCount} responses cleared for version(s) ${versionsToReset.join(
          ', '
        )}`
      );

      return {
        affectedResponseCount,
        cascadeResetVersions: version === 'v2' ? ['v3'] : [],
        message: `Successfully reset ${affectedResponseCount} responses for version ${version}${
          version === 'v2' ? ' and v3 (cascade)' : ''
        }`
      };
    } catch (error) {
      this.logger.error(
        `Error resetting coding version ${version} in workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to reset coding version: ${error.message}`);
    }
  }

  /**
   * Analyzes responses for a workspace to identify:
   * 1. Empty responses (null or empty string values)
   * 2. Duplicate values (same normalized value across different testperson/variable combinations)
   *
   * Uses the response matching settings (ignore case, ignore whitespace) for normalization.
   */
  async getResponseAnalysis(workspaceId: number): Promise<ResponseAnalysisDto> {
    try {
      this.logger.log(
        `Starting response analysis for workspace ${workspaceId}`
      );

      // Get response matching flags from settings
      const matchingFlags = await this.codingJobService.getResponseMatchingMode(
        workspaceId
      );
      this.logger.log(
        `Response matching flags: ${JSON.stringify(matchingFlags)}`
      );

      // Get all persons in the workspace that should be considered
      const persons = await this.workspacesFacadeService.findConsideringPersons(workspaceId);

      if (persons.length === 0) {
        this.logger.warn(`No persons found for workspace ${workspaceId}`);
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const personIds = persons.map(person => person.id);
      const personMap = new Map(persons.map(person => [person.id, person]));

      // Get all booklets for these persons
      const booklets = await this.workspacesFacadeService.findBookletsWithInfoByPersonIds(personIds);

      if (booklets.length === 0) {
        this.logger.warn(
          `No booklets found for persons in workspace ${workspaceId}`
        );
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const bookletMap = new Map(
        booklets.map(booklet => [booklet.id, booklet])
      );

      // Get all units for these booklets
      const batchSize = 1000;
      let allUnits: Unit[] = [];
      const bookletIds = booklets.map(booklet => booklet.id);

      for (let i = 0; i < bookletIds.length; i += batchSize) {
        const bookletIdsBatch = bookletIds.slice(i, i + batchSize);
        const unitsBatch = await this.workspacesFacadeService.findUnitsByBookletIds(bookletIdsBatch);
        allUnits = [...allUnits, ...unitsBatch];
      }

      if (allUnits.length === 0) {
        this.logger.warn(
          `No units found for booklets in workspace ${workspaceId}`
        );
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const unitIds = allUnits.map(unit => unit.id);
      const unitMap = new Map(allUnits.map(unit => [unit.id, unit]));

      // Get all responses for these units that require manual coding (CODING_INCOMPLETE status)
      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      let allResponses: ResponseEntity[] = [];
      for (let i = 0; i < unitIds.length; i += batchSize) {
        const unitIdsBatch = unitIds.slice(i, i + batchSize);
        const responsesBatch = await this.workspacesFacadeService.findResponsesByUnitIdsAndStatus(unitIdsBatch, codingIncompleteStatus);
        allResponses = [...allResponses, ...responsesBatch];
      }

      if (allResponses.length === 0) {
        this.logger.warn(
          `No manual coding responses (CODING_INCOMPLETE) found for units in workspace ${workspaceId}`
        );
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      this.logger.log(
        `Found ${allResponses.length} responses requiring manual coding in workspace ${workspaceId}`
      );

      // Analyze empty responses
      const emptyResponses: EmptyResponseDto[] = [];
      for (const response of allResponses) {
        const isEmptyValue =
          response.value === null ||
          response.value === '' ||
          response.value === undefined;
        if (isEmptyValue) {
          const unit = unitMap.get(response.unitid);
          if (!unit) continue;

          const booklet = bookletMap.get(unit.bookletid);
          if (!booklet) continue;

          const person = personMap.get(booklet.personid);
          if (!person) continue;

          emptyResponses.push({
            unitName: unit.name,
            unitAlias: unit.alias || null,
            variableId: response.variableid,
            personLogin: person.login,
            personCode: person.code || '',
            bookletName: booklet.bookletinfo?.name || 'Unknown',
            responseId: response.id
          });
        }
      }

      // Sort empty responses
      emptyResponses.sort((a, b) => {
        if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
        if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
        return a.personLogin.localeCompare(b.personLogin);
      });

      // Analyze duplicate values (group by unit+variable, then by normalized value)
      const duplicateValueGroups: DuplicateValueGroupDto[] = [];

      // Group responses by unit+variable
      const responsesByUnitVariable = new Map<string, ResponseEntity[]>();
      for (const response of allResponses) {
        // Skip empty responses for duplicate analysis
        if (
          response.value === null ||
          response.value === '' ||
          response.value === undefined
        ) {
          continue;
        }

        const unit = unitMap.get(response.unitid);
        const key = unit ?
          `${unit.name}_${response.variableid}` :
          `${response.unitid}_${response.variableid}`;
        if (!responsesByUnitVariable.has(key)) {
          responsesByUnitVariable.set(key, []);
        }
        responsesByUnitVariable.get(key)!.push(response);
      }
      // For each unit+variable group, find duplicate values
      for (const [, responses] of responsesByUnitVariable.entries()) {
        if (responses.length < 2) continue;

        // Group by normalized value
        const valueGroups = new Map<string, ResponseEntity[]>();
        for (const response of responses) {
          const normalizedValue = this.codingJobService.normalizeValue(
            response.value,
            matchingFlags
          );
          if (!valueGroups.has(normalizedValue)) {
            valueGroups.set(normalizedValue, []);
          }
          valueGroups.get(normalizedValue)!.push(response);
        }

        // Find groups with more than one response (duplicates)
        for (const [normalizedValue, groupResponses] of valueGroups.entries()) {
          if (groupResponses.length < 2) continue;

          const firstResponse = groupResponses[0];
          const unit = unitMap.get(firstResponse.unitid);
          if (!unit) continue;

          const occurrences = groupResponses.map(response => {
            const responseUnit = unitMap.get(response.unitid);
            const booklet = responseUnit ?
              bookletMap.get(responseUnit.bookletid) :
              null;
            const person = booklet ? personMap.get(booklet.personid) : null;

            return {
              personLogin: person?.login || 'Unknown',
              personCode: person?.code || '',
              bookletName: booklet?.bookletinfo?.name || 'Unknown',
              responseId: response.id,
              value: response.value || ''
            };
          });

          duplicateValueGroups.push({
            unitName: unit.name,
            unitAlias: unit.alias || null,
            variableId: firstResponse.variableid,
            normalizedValue,
            originalValue: firstResponse.value || '',
            occurrences
          });
        }
      }

      // Sort duplicate groups
      duplicateValueGroups.sort((a, b) => {
        if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
        return a.variableId.localeCompare(b.variableId);
      });

      const totalDuplicateResponses = duplicateValueGroups.reduce(
        (sum, group) => sum + group.occurrences.length,
        0
      );

      this.logger.log(
        `Response analysis complete: ${emptyResponses.length} empty responses, ${duplicateValueGroups.length} duplicate value groups (${totalDuplicateResponses} total responses)`
      );

      return {
        emptyResponses: {
          total: emptyResponses.length,
          items: emptyResponses
        },
        duplicateValues: {
          total: duplicateValueGroups.length,
          totalResponses: totalDuplicateResponses,
          groups: duplicateValueGroups
        },
        matchingFlags,
        analysisTimestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing responses for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to analyze responses: ${error.message}`);
    }
  }

  private createEmptyAnalysisResult(
    matchingFlags: string[]
  ): ResponseAnalysisDto {
    return {
      emptyResponses: {
        total: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: []
      },
      matchingFlags,
      analysisTimestamp: new Date().toISOString()
    };
  }
}
