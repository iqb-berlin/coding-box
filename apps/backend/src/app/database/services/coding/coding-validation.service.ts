import {
  Injectable, Logger, forwardRef, Inject
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CacheService } from '../../../cache/cache.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { generateExpectedCombinationsHash } from '../../../utils/coding-utils';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { CodingJobService } from './coding-job.service';

@Injectable()
export class CodingValidationService {
  private readonly logger = new Logger(CodingValidationService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private cacheService: CacheService,
    private workspaceFilesService: WorkspaceFilesService,
    private workspaceExclusionService: WorkspaceExclusionService,
    @Inject(forwardRef(() => CodingJobService))
    private codingJobService: CodingJobService
  ) { }

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

      const combinationsHash = generateExpectedCombinationsHash(expectedCombinations);
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
          const responseExists = await this.responseRepository
            .createQueryBuilder('response')
            .innerJoin('response.unit', 'unit')
            .innerJoin('unit.booklet', 'booklet')
            .innerJoin('booklet.person', 'person')
            .innerJoin('booklet.bookletinfo', 'bookletinfo')
            .where('unit.alias = :unitKey', { unitKey: expected.unit_key })
            .andWhere('person.login = :loginName', {
              loginName: expected.login_name
            })
            .andWhere('person.code = :loginCode', {
              loginCode: expected.login_code
            })
            .andWhere('bookletinfo.name = :bookletId', {
              bookletId: expected.booklet_id
            })
            .andWhere('response.variableid = :variableId', {
              variableId: expected.variable_id
            })
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
        `Validation completed in ${endTime - startTime}ms. Processed all ${expectedCombinations.length
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
    unitName?: string,
    trainingRequired?: boolean
  ): Promise<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
      uniqueCasesAfterAggregation: number;
      isDerived: boolean;
      coderTrainingRequired: boolean;
    }[]
    > {
    try {
      if (unitName || trainingRequired !== undefined) {
        this.logger.log(
          `Querying manual coding variables for workspace ${workspaceId}${unitName ? ` and unit ${unitName}` : ''}${trainingRequired !== undefined ? ` (trainingRequired: ${trainingRequired})` : ''} (not cached)`
        );
        const variables = await this.fetchCodingIncompleteVariablesFromDb(
          workspaceId,
          unitName,
          trainingRequired
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
        uniqueCasesAfterAggregation: number;
        isDerived: boolean;
        coderTrainingRequired: boolean;
      }[]
      >(cacheKey);
      if (cachedResult) {
        this.logger.log(
          `Retrieved ${cachedResult.length} manual coding variables from cache for workspace ${workspaceId}`
        );
        return cachedResult;
      }
      this.logger.log(
        `Cache miss: Querying manual coding variables for workspace ${workspaceId}`
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
          `Cached ${result.length} manual coding variables for workspace ${workspaceId}`
        );
      } else {
        this.logger.warn(
          `Failed to cache manual coding variables for workspace ${workspaceId}`
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Error getting manual coding variables: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get manual coding variables. Please check the database connection.'
      );
    }
  }

  /**
     * Enrich variables with case information (cases in jobs, available cases, and unique cases after aggregation)
     */
  private async enrichVariablesWithCaseInfo(
    workspaceId: number,
    variables: { unitName: string; variableId: string; responseCount: number; isDerived: boolean; coderTrainingRequired: boolean }[]
  ): Promise<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
      uniqueCasesAfterAggregation: number;
      isDerived: boolean;
      coderTrainingRequired: boolean;
    }[]
    > {
    const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);

    // Compute aggregation-reduced counts for all variables at once
    const aggregationMap = await this.computeUniqueCasesAfterAggregation(workspaceId, variables);

    return variables.map(variable => {
      const key = `${variable.unitName}::${variable.variableId}`;
      const casesInJobs = casesInJobsMap.get(key) || 0;
      const availableCases = Math.max(0, variable.responseCount - casesInJobs);
      const uniqueCasesAfterAggregation = aggregationMap.get(key) ?? variable.responseCount;

      return {
        ...variable,
        casesInJobs,
        availableCases,
        uniqueCasesAfterAggregation
      };
    });
  }

  /**
   * Compute the number of unique coding cases per variable after applying aggregation grouping.
   * When aggregation is disabled (threshold = null), returns responseCount for each variable.
   * Derived variables are never aggregated because they share empty/null underlying string values.
   */
  private async computeUniqueCasesAfterAggregation(
    workspaceId: number,
    variables: { unitName: string; variableId: string; responseCount: number; isDerived?: boolean }[]
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (variables.length === 0) {
      return result;
    }

    const aggregationThreshold = await this.codingJobService.getAggregationThreshold(workspaceId);

    if (aggregationThreshold === null) {
      // Aggregation disabled — unique cases = raw response count
      variables.forEach(v => {
        result.set(`${v.unitName}::${v.variableId}`, v.responseCount);
      });
      return result;
    }

    const matchingFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);

    // Fetch slim responses for all base variables in one call (skip derived vars)
    const baseVariables = variables.filter(v => !v.isDerived);
    const slimResponses = await this.codingJobService.getSlimResponsesForVariables(
      workspaceId,
      baseVariables.map(v => ({ unitName: v.unitName, variableId: v.variableId }))
    );

    // Group by variable key and apply aggregation
    for (const variable of variables) {
      const key = `${variable.unitName}::${variable.variableId}`;

      // Derived variables don't have user string responses, so aggregation would falsely
      // group all of their empty/null values into 1 case. We always use raw responseCount.
      if (variable.isDerived) {
        result.set(key, variable.responseCount);
        continue;
      }

      const varResponses = slimResponses.filter(
        r => r.unitName === variable.unitName && r.variableid === variable.variableId
      );

      const aggregatedGroups = this.codingJobService.aggregateResponsesByValue(varResponses, matchingFlags);

      let uniqueCases = 0;
      for (const group of aggregatedGroups) {
        if (group.responses.length >= aggregationThreshold) {
          uniqueCases += 1;
        } else {
          uniqueCases += group.responses.length;
        }
      }

      result.set(key, uniqueCases);
    }

    this.logger.log(
      `Computed unique cases after aggregation for ${variables.length} variables in workspace ${workspaceId}`
    );

    return result;
  }

  private async fetchCodingIncompleteVariablesFromDb(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean
  ): Promise<
    { unitName: string; variableId: string; responseCount: number; isDerived: boolean; coderTrainingRequired: boolean }[]
    > {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    // Helper to build the base query for a given status
    const buildQuery = (status: number) => {
      const qb = this.responseRepository
        .createQueryBuilder('response')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(response.id)', 'responseCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.person', 'person')
        .where('response.status_v1 = :status', { status })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        // Exclude special/auto codes (any negative code_v2, e.g. -111 for duplicates, -98 for empty)
        .andWhere('(response.code_v2 IS NULL OR response.code_v2 >= 0)')
        .groupBy('unit.name')
        .addGroupBy('response.variableid');

      if (unitName) {
        qb.andWhere('unit.name = :unitName', { unitName });
      }
      applyResolvedExclusionsToQuery(qb, exclusions);
      return qb;
    };

    // Run both queries in parallel
    const [codingIncompleteRaw, intendedIncompleteRaw] = await Promise.all([
      buildQuery(statusStringToNumber('CODING_INCOMPLETE')).getRawMany(),
      buildQuery(statusStringToNumber('INTENDED_INCOMPLETE')).getRawMany()
    ]);

    this.logger.debug(
      `[DEBUG] CODING_INCOMPLETE raw results (${codingIncompleteRaw.length}): ${
        codingIncompleteRaw.map((r: { unitName: string; variableId: string; responseCount: string }) => `${r.unitName}::${r.variableId}(${r.responseCount})`).join(', ')}`
    );
    this.logger.debug(
      `[DEBUG] INTENDED_INCOMPLETE raw results (${intendedIncompleteRaw.length}): ${
        intendedIncompleteRaw.map((r: { unitName: string; variableId: string; responseCount: string }) => `${r.unitName}::${r.variableId}(${r.responseCount})`).join(', ')}`
    );

    // Load both lookup maps from the file service
    const [unitVariableMap, derivedVariableMap, trainingRequiredMap] = await Promise.all([
      this.workspaceFilesService.getUnitVariableMap(workspaceId),
      this.workspaceFilesService.getDerivedVariableMap(workspaceId),
      this.workspaceFilesService.getCoderTrainingRequiredVariableMap(workspaceId)
    ]);

    // Build case-insensitive lookup structures
    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitNameKey: string) => {
      validVariableSets.set(unitNameKey.toUpperCase(), variables);
    });

    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((variables: Set<string>, unitNameKey: string) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), variables);
    });

    const trainingRequiredSets = new Map<string, Set<string>>();
    trainingRequiredMap.forEach((variables: Set<string>, unitNameKey: string) => {
      trainingRequiredSets.set(unitNameKey.toUpperCase(), variables);
    });

    this.logger.debug(
      `[DEBUG] unitVariableMap units: [${Array.from(validVariableSets.keys()).join(', ')}]`
    );
    // Filter results, applying trainingRequired filter if provided
    const filterFn = (row: { unitName: string; variableId: string; responseCount: string }) => {
      const unitKey = row.unitName?.toUpperCase();
      const variableId = row.variableId;

      // Basic validation
      const validVars = validVariableSets.get(unitKey);
      if (!validVars?.has(variableId)) return false;

      // Filter by trainingRequired
      const isRequired = trainingRequiredSets.get(unitKey)?.has(variableId) || false;
      if (trainingRequired !== undefined) {
        if (isRequired !== trainingRequired) {
          return false;
        }
      }
      return true;
    };

    const filteredCodingIncomplete = codingIncompleteRaw.filter(filterFn);
    const filteredIntendedIncomplete = intendedIncompleteRaw.filter(filterFn);

    // Merge results, summing response counts for variables that appear in both
    const mergedMap = new Map<string, {
      unitName: string;
      variableId: string;
      responseCount: number;
      isDerived: boolean;
      coderTrainingRequired: boolean;
    }>();

    for (const row of [...filteredCodingIncomplete, ...filteredIntendedIncomplete]) {
      const key = `${row.unitName}::${row.variableId}`;
      const existing = mergedMap.get(key);
      const count = parseInt(row.responseCount, 10);
      const isDerived = derivedVariableSets.get(row.unitName?.toUpperCase())?.has(row.variableId) ?? false;
      const coderTrainingRequired = trainingRequiredSets.get(row.unitName?.toUpperCase())?.has(row.variableId) ?? false;

      if (existing) {
        existing.responseCount += count;
      } else {
        mergedMap.set(key, {
          unitName: row.unitName,
          variableId: row.variableId,
          responseCount: count,
          isDerived,
          coderTrainingRequired
        });
      }
    }

    const result = Array.from(mergedMap.values());

    this.logger.log(
      `Found ${codingIncompleteRaw.length} CODING_INCOMPLETE + ${intendedIncompleteRaw.length} INTENDED_INCOMPLETE variable groups, ` +
      `filtered to ${result.length} valid variables${unitName ? ` for unit ${unitName}` : ''}`
    );

    return result;
  }

  generateIncompleteVariablesCacheKey(workspaceId: number): string {
    return `coding_incomplete_variables_v3:${workspaceId}`;
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
    await this.cacheService.delete(cacheKey);
    this.logger.log(
      `Invalidated manual coding variables cache for workspace ${workspaceId}`
    );
  }

  /**
     * Get the number of unique cases (response_ids) already assigned to coding jobs for each variable
     * This counts distinct response_ids to properly handle double-coding scenarios
     */
  async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id');
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'codingValidationCasesInJobs'
    });
    const rawResults = await query.getRawMany();

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

  async getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Promise<number> {
    try {
      this.logger.log(
        `Getting applied results count for ${incompleteVariables.length} manual coding variables in workspace ${workspaceId}`
      );

      if (incompleteVariables.length === 0) {
        return 0;
      }

      let totalAppliedCount = 0;
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      const batchSize = 50;
      for (let i = 0; i < incompleteVariables.length; i += batchSize) {
        const batch = incompleteVariables.slice(i, i + batchSize);

        const query = this.responseRepository
          .createQueryBuilder('response')
          .innerJoin('response.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('booklet.person', 'person')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere('response.status_v1 IN (:...sourceStatuses)', {
            sourceStatuses: [
              statusStringToNumber('CODING_INCOMPLETE'),
              statusStringToNumber('INTENDED_INCOMPLETE')
            ]
          })
          .andWhere('response.status_v2 IN (:...targetStatuses)', {
            targetStatuses: [
              statusStringToNumber('CODING_COMPLETE'),
              statusStringToNumber('INVALID'),
              statusStringToNumber('CODING_ERROR')
            ]
          })
          .andWhere('(response.code_v2 IS NULL OR response.code_v2 >= 0)')
          .andWhere(new Brackets(qb => {
            batch.forEach((variable, index) => {
              const parameters = {
                [`appliedUnitName${index}`]: variable.unitName,
                [`appliedVariableId${index}`]: variable.variableId
              };
              const condition = `(unit.name = :appliedUnitName${index} AND response.variableid = :appliedVariableId${index})`;
              if (index === 0) {
                qb.where(condition, parameters);
              } else {
                qb.orWhere(condition, parameters);
              }
            });
          }));

        applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: `appliedResults${i}` });

        const batchCount = await query.getCount();
        totalAppliedCount += batchCount;

        this.logger.debug(
          `Batch ${Math.floor(i / batchSize) + 1
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
}
