import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, IsNull, In, Not
} from 'typeorm';
import * as crypto from 'crypto';
import { statusStringToNumber } from '../../workspaces/utils/response-status-converter';
import { CacheService } from '../../cache/cache.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { WorkspaceFilesService } from '../../workspaces/services/workspace-files.service';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ResponseAnalysisDto, DuplicateValueGroupDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { ResponseEntity, Unit } from '../../common';
import { CodingJobService } from './coding-job.service';

// Re-importing Not from typeorm for completion

/**
 * CodingValidationService
 *
 * Handles validation of coding completeness, coverage analysis, and response consistency.
 * This service is responsible for:
 * - Validating expected coding combinations
 * - Identifying incomplete variables requiring coding
 * - Calculating coding progress and coverage metrics
 * - Analyzing responses for empty or duplicate values
 *
 * Extracted from WorkspaceCodingService to improve maintainability.
 */
@Injectable()
export class CodingValidationService {
  private readonly logger = new Logger(CodingValidationService.name);

  constructor(
    private readonly workspacesFacadeService: WorkspacesFacadeService,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly cacheService: CacheService,
    private readonly codingJobService: CodingJobService,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private readonly jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private readonly variableBundleRepository: Repository<VariableBundle>
  ) {}

  /**
   * Validate coding completeness against a list of expected combinations
   */
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

      const combinationsHash = this.generateExpectedCombinationsHash(expectedCombinations);
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

      await this.cacheService.storeValidationResults(
        cacheKey,
        allResults,
        metadata
      );

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
      this.logger.error(
        `Error validating coding completeness: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not validate coding completeness. Please check the database connection or query.'
      );
    }
  }

  /**
   * Get variables that are not yet fully coded
   */
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
        const variables = await this.fetchCodingIncompleteVariablesFromDb(workspaceId, unitName);
        return await this.enrichVariablesWithCaseInfo(workspaceId, variables);
      }

      const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
      const cachedResult = await this.cacheService.get<Array<{
        unitName: string;
        variableId: string;
        responseCount: number;
        casesInJobs: number;
        availableCases: number;
      }>>(cacheKey);

      if (cachedResult) {
        return cachedResult;
      }

      const variables = await this.fetchCodingIncompleteVariablesFromDb(workspaceId);
      const result = await this.enrichVariablesWithCaseInfo(workspaceId, variables);

      await this.cacheService.set(cacheKey, result, 300); // 5 minutes
      return result;
    } catch (error) {
      this.logger.error(
        `Error getting CODING_INCOMPLETE variables: ${error.message}`,
        error.stack
      );
      throw new Error('Could not get CODING_INCOMPLETE variables.');
    }
  }

  /**
   * Get coding progress overview for a workspace
   */
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

    const completionPercentage = totalCasesToCode > 0 ? (completedCases / totalCasesToCode) * 100 : 0;

    return {
      totalCasesToCode,
      completedCases,
      completionPercentage
    };
  }

  /**
   * Get case coverage overview (assigned vs unassigned)
   */
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

    const uniqueCasesInJobs = parseInt(uniqueCasesInJobsResult?.count || '0', 10);
    const doubleCodedCases = casesInJobs - uniqueCasesInJobs;
    const singleCodedCases = uniqueCasesInJobs;
    const unassignedCases = totalCasesToCode - uniqueCasesInJobs;
    const coveragePercentage = totalCasesToCode > 0 ? (uniqueCasesInJobs / totalCasesToCode) * 100 : 0;

    return {
      totalCasesToCode,
      casesInJobs,
      doubleCodedCases,
      singleCodedCases,
      unassignedCases,
      coveragePercentage
    };
  }

  /**
   * Analyze responses for empty or duplicate values
   */
  async getResponseAnalysis(workspaceId: number): Promise<ResponseAnalysisDto> {
    try {
      this.logger.log(`Starting response analysis for workspace ${workspaceId}`);

      const matchingFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);
      const persons = await this.workspacesFacadeService.findConsideringPersons(workspaceId);

      if (persons.length === 0) {
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const personIds = persons.map(person => person.id);
      const personMap = new Map(persons.map(person => [person.id, person]));

      const booklets = await this.workspacesFacadeService.findBookletsWithInfoByPersonIds(personIds);
      if (booklets.length === 0) {
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const bookletMap = new Map(booklets.map(booklet => [booklet.id, booklet]));
      const bookletIds = booklets.map(booklet => booklet.id);

      let allUnits: Unit[] = [];
      const batchSize = 1000;
      for (let i = 0; i < bookletIds.length; i += batchSize) {
        const unitsBatch = await this.workspacesFacadeService.findUnitsByBookletIds(bookletIds.slice(i, i + batchSize));
        allUnits = [...allUnits, ...unitsBatch];
      }

      if (allUnits.length === 0) {
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const unitIds = allUnits.map(unit => unit.id);
      const unitMap = new Map(allUnits.map(unit => [unit.id, unit]));

      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      let allResponses: ResponseEntity[] = [];
      for (let i = 0; i < unitIds.length; i += batchSize) {
        const responsesBatch = await this.workspacesFacadeService.findResponsesByUnitIdsAndStatus(
          unitIds.slice(i, i + batchSize),
          codingIncompleteStatus
        );
        allResponses = [...allResponses, ...responsesBatch];
      }

      if (allResponses.length === 0) {
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      // 1. Analyze Empty Responses
      const emptyResponses = allResponses
        .filter(r => !r.value || r.value.trim() === '')
        .map(r => {
          const unit = unitMap.get(r.unitid);
          const booklet = bookletMap.get(unit?.bookletid);
          const person = personMap.get(booklet?.personid);
          return {
            unitName: unit?.name || '',
            unitAlias: unit?.alias || null,
            variableId: r.variableid,
            personLogin: person?.login || '',
            personCode: person?.code || '',
            bookletName: booklet?.bookletinfo?.name || 'Unknown',
            responseId: r.id
          };
        })
        .sort((a, b) => a.unitName.localeCompare(b.unitName) || a.variableId.localeCompare(b.variableId));

      // 2. Analyze Duplicate Values
      const responsesByUnitVariable = new Map<string, ResponseEntity[]>();
      allResponses.forEach(r => {
        if (!r.value || r.value.trim() === '') return;
        const key = `${r.unitid}_${r.variableid}`;
        if (!responsesByUnitVariable.has(key)) responsesByUnitVariable.set(key, []);
        responsesByUnitVariable.get(key).push(r);
      });

      const duplicateValueGroups: DuplicateValueGroupDto[] = [];
      for (const responses of responsesByUnitVariable.values()) {
        if (responses.length < 2) continue;

        const valueGroups = new Map<string, ResponseEntity[]>();
        responses.forEach(r => {
          const norm = this.codingJobService.normalizeValue(r.value, matchingFlags);
          if (!valueGroups.has(norm)) valueGroups.set(norm, []);
          valueGroups.get(norm).push(r);
        });

        for (const [norm, group] of valueGroups.entries()) {
          if (group.length < 2) continue;
          const first = group[0];
          const unit = unitMap.get(first.unitid);

          duplicateValueGroups.push({
            unitName: unit?.name || '',
            unitAlias: unit?.alias || null,
            variableId: first.variableid,
            normalizedValue: norm,
            originalValue: first.value || '',
            occurrences: group.map(r => {
              const u = unitMap.get(r.unitid);
              const b = bookletMap.get(u?.bookletid);
              const p = personMap.get(b?.personid);
              return {
                personLogin: p?.login || 'Unknown',
                personCode: p?.code || '',
                bookletName: b?.bookletinfo?.name || 'Unknown',
                responseId: r.id,
                value: r.value || ''
              };
            })
          });
        }
      }

      duplicateValueGroups.sort((a, b) => a.unitName.localeCompare(b.unitName) || a.variableId.localeCompare(b.variableId));

      return {
        emptyResponses: { total: emptyResponses.length, items: emptyResponses },
        duplicateValues: {
          total: duplicateValueGroups.length,
          totalResponses: duplicateValueGroups.reduce((s, g) => s + g.occurrences.length, 0),
          groups: duplicateValueGroups
        },
        matchingFlags,
        analysisTimestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Error analyzing responses: ${error.message}`, error.stack);
      throw new Error(`Failed to analyze responses: ${error.message}`);
    }
  }

  /**
   * Get the number of unique cases already assigned to jobs for each variable
   */
  async getVariableCasesInJobs(workspaceId: number): Promise<Map<string, number>> {
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
      casesInJobsMap.set(`${row.unitName}::${row.variableId}`, parseInt(row.casesInJobs, 10));
    });
    return casesInJobsMap;
  }

  /**
   * Invalidate incomplete variables cache
   */
  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
    await this.cacheService.delete(cacheKey);
  }

  // Private helper methods

  private generateExpectedCombinationsHash(expectedCombinations: ExpectedCombinationDto[]): string {
    const sortedData = expectedCombinations
      .map(c => `${c.unit_key}|${c.login_name}|${c.login_code}|${c.booklet_id}|${c.variable_id}`)
      .sort()
      .join('||');

    return crypto.createHash('sha256').update(sortedData).digest('hex').substring(0, 16);
  }

  private async fetchCodingIncompleteVariablesFromDb(
    workspaceId: number,
    unitName?: string
  ): Promise<{ unitName: string; variableId: string; responseCount: number }[]> {
    const rawResults = await this.workspacesFacadeService.findCodingIncompleteVariablesWithCounts(workspaceId, unitName);
    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables, name) => {
      validVariableSets.set(name.toUpperCase(), variables);
    });

    return rawResults
      .filter(row => validVariableSets.get(row.unitName?.toUpperCase())?.has(row.variableId))
      .map(row => ({
        unitName: row.unitName,
        variableId: row.variableId,
        responseCount: parseInt(row.responseCount, 10)
      }));
  }

  private async enrichVariablesWithCaseInfo(
    workspaceId: number,
    variables: { unitName: string; variableId: string; responseCount: number }[]
  ) {
    const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);
    return variables.map(v => {
      const key = `${v.unitName}::${v.variableId}`;
      const casesInJobs = casesInJobsMap.get(key) || 0;
      return {
        ...v,
        casesInJobs,
        availableCases: Math.max(0, v.responseCount - casesInJobs)
      };
    });
  }

  private generateIncompleteVariablesCacheKey(workspaceId: number): string {
    return `coding_incomplete_variables:${workspaceId}`;
  }

  private createEmptyAnalysisResult(matchingFlags: string[]): ResponseAnalysisDto {
    return {
      emptyResponses: { total: 0, items: [] },
      duplicateValues: { total: 0, totalResponses: 0, groups: [] },
      matchingFlags,
      analysisTimestamp: new Date().toISOString()
    };
  }

  /**
   * Get an overview of variable coverage in coding jobs
   */
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
    variableCaseCounts: { unitName: string; variableId: string; caseCount: number }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{ variableKey: string; conflictingDefinitions: Array<{ id: number; status: string }> }>;
    };
  }> {
    try {
      this.logger.log(`Getting variable coverage overview for workspace ${workspaceId} (CODING_INCOMPLETE only)`);
      const rawResult = await this.workspacesFacadeService.findCodingIncompleteVariablesWithCounts(workspaceId);
      const variablesNeedingCoding = new Set<string>();
      const variableCaseCounts: { unitName: string; variableId: string; caseCount: number }[] = [];

      rawResult.forEach(row => {
        const key = `${row.unitName}:${row.variableId}`;
        variablesNeedingCoding.add(key);
        variableCaseCounts.push({ unitName: row.unitName, variableId: row.variableId, caseCount: parseInt(row.responseCount, 10) });
      });

      const jobDefinitions = await this.jobDefinitionRepository.find({ where: { workspace_id: workspaceId } });
      const coveredVariables = new Set<string>();
      const coverageByStatus = { draft: new Set<string>(), pending_review: new Set<string>(), approved: new Set<string>() };
      const variableToDefinitions = new Map<string, Array<{ id: number; status: string }>>();

      for (const definition of jobDefinitions) {
        const defVars = new Set<string>();
        if (definition.assigned_variables) {
          (definition.assigned_variables as Array<{ unitName: string; variableId: string }>).forEach(v => {
            const key = `${v.unitName}:${v.variableId}`;
            if (variablesNeedingCoding.has(key)) defVars.add(key);
          });
        }

        if (definition.assigned_variable_bundles) {
          const bundleIds = definition.assigned_variable_bundles.map(b => b.id);
          const bundles = await this.variableBundleRepository.find({ where: { id: In(bundleIds) } });
          bundles.forEach(b => {
            if (b.variables) {
              b.variables.forEach(v => {
                const key = `${v.unitName}:${v.variableId}`;
                if (variablesNeedingCoding.has(key)) defVars.add(key);
              });
            }
          });
        }

        defVars.forEach(key => {
          coveredVariables.add(key);
          coverageByStatus[definition.status].add(key);
          if (!variableToDefinitions.has(key)) variableToDefinitions.set(key, []);
          variableToDefinitions.get(key).push({ id: definition.id, status: definition.status });
        });
      }

      const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);
      const conflictedVariables = new Map<string, Array<{ id: number; status: string }>>();
      variableToDefinitions.forEach((defs, key) => {
        if (defs.length > 1) {
          const [u, v] = key.split(':');
          const info = variableCaseCounts.find(vi => vi.unitName === u && vi.variableId === v);
          if (info) {
            const casesInJobs = casesInJobsMap.get(`${info.unitName}::${info.variableId}`) || 0;
            if (info.caseCount - casesInJobs <= 0) conflictedVariables.set(key, defs);
          }
        }
      });

      const missingVariables = new Set<string>();
      const partiallyAbgedeckteVariablen = new Set<string>();
      const fullyAbgedeckteVariablen = new Set<string>();

      variablesNeedingCoding.forEach(key => {
        if (!coveredVariables.has(key)) {
          missingVariables.add(key);
          return;
        }
        const info = variableCaseCounts.find(vi => `${vi.unitName}:${vi.variableId}` === key);
        if (info) {
          const casesInJobs = casesInJobsMap.get(`${info.unitName}::${info.variableId}`) || 0;
          if (casesInJobs >= info.caseCount) fullyAbgedeckteVariablen.add(key);
          else if (casesInJobs > 0) partiallyAbgedeckteVariablen.add(key);
        }
      });

      return {
        totalVariables: variablesNeedingCoding.size,
        coveredVariables: coveredVariables.size,
        coveredByDraft: coverageByStatus.draft.size,
        coveredByPendingReview: coverageByStatus.pending_review.size,
        coveredByApproved: coverageByStatus.approved.size,
        conflictedVariables: conflictedVariables.size,
        missingVariables: missingVariables.size,
        partiallyAbgedeckteVariablen: partiallyAbgedeckteVariablen.size,
        fullyAbgedeckteVariablen: fullyAbgedeckteVariablen.size,
        coveragePercentage: variablesNeedingCoding.size > 0 ? (coveredVariables.size / variablesNeedingCoding.size) * 100 : 0,
        variableCaseCounts,
        coverageByStatus: {
          draft: Array.from(coverageByStatus.draft),
          pending_review: Array.from(coverageByStatus.pending_review),
          approved: Array.from(coverageByStatus.approved),
          conflicted: Array.from(conflictedVariables.entries()).map(([k, d]) => ({ variableKey: k, conflictingDefinitions: d }))
        }
      };
    } catch (e) {
      this.logger.error(`Error calculating variable coverage: ${e.message}`, e.stack);
      throw new Error('Failed to calculate variable coverage overview.');
    }
  }

  /**
   * Reset coding version values for filtered responses
   */
  async resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<{ affectedResponseCount: number; cascadeResetVersions: ('v2' | 'v3')[]; message: string }> {
    try {
      const versionsToReset: ('v1' | 'v2' | 'v3')[] = [version];
      if (version === 'v2') versionsToReset.push('v3');

      const responseIds = await this.workspacesFacadeService.findResponseIdsForReset(workspaceId, unitFilters, variableFilters);
      if (responseIds.length === 0) {
        return { affectedResponseCount: 0, cascadeResetVersions: version === 'v2' ? ['v3'] : [], message: 'No responses found' };
      }

      const updateObj: Record<string, null> = {};
      versionsToReset.forEach(v => {
        updateObj[`status_${v}`] = null;
        updateObj[`code_${v}`] = null;
        updateObj[`score_${v}`] = null;
      });

      const batchSize = 5000;
      for (let i = 0; i < responseIds.length; i += batchSize) {
        await this.workspacesFacadeService.resetResponseValues(responseIds.slice(i, i + batchSize), updateObj);
      }

      return {
        affectedResponseCount: responseIds.length,
        cascadeResetVersions: version === 'v2' ? ['v3'] : [],
        message: `Successfully reset ${responseIds.length} responses for version ${version}${version === 'v2' ? ' and v3' : ''}`
      };
    } catch (e) {
      this.logger.error(`Error resetting coding version: ${e.message}`, e.stack);
      throw e;
    }
  }

  /**
   * Get responses filtered by status
   */
  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    version: 'v1' | 'v2' | 'v3' = 'v1',
    page: number = 1,
    limit: number = 100
  ): Promise<{ data: ResponseEntity[]; total: number; page: number; limit: number }> {
    try {
      const statusNumber = statusStringToNumber(status);
      if (statusNumber === null) {
        return {
          data: [], total: 0, page, limit
        };
      }

      const result = await this.workspacesFacadeService.findResponsesByStatus(workspaceId, statusNumber, version, (page - 1) * limit, limit);
      return {
        data: result.data, total: result.total, page, limit
      };
    } catch (e) {
      this.logger.error(`Error getting responses by status: ${e.message}`, e.stack);
      throw e;
    }
  }
}
