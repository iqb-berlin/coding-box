import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CacheService } from '../../../cache/cache.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { generateExpectedCombinationsHash } from '../../../utils/coding-utils';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

@Injectable()
export class CodingValidationService {
  private readonly logger = new Logger(CodingValidationService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private cacheService: CacheService,
    private workspaceFilesService: WorkspaceFilesService
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
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('COUNT(response.id)', 'responseCount')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspace_id', {
        workspace_id: workspaceId
      })
      .andWhere('person.consider = :consider', { consider: true });

    if (unitName) {
      queryBuilder.andWhere('unit.name = :unitName', { unitName });
    }

    // Exclude special/auto codes (any negative code_v2, e.g. -111 for duplicates, -98 for empty)
    queryBuilder.andWhere('(response.code_v2 IS NULL OR response.code_v2 >= 0)');

    queryBuilder.groupBy('unit.name').addGroupBy('response.variableid');

    const rawResults = await queryBuilder.getRawMany();

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
      `Found ${rawResults.length
      } CODING_INCOMPLETE variable groups, filtered to ${filteredResult.length
      } valid variables${unitName ? ` for unit ${unitName}` : ''}`
    );

    return result;
  }

  generateIncompleteVariablesCacheKey(workspaceId: number): string {
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
            AND (response.code_v2 IS NULL OR response.code_v2 >= 0)
        `;

        const result = await this.responseRepository.query(query, [
          workspaceId,
          statusStringToNumber('CODING_INCOMPLETE'), // status_v1 = CODING_INCOMPLETE
          statusStringToNumber('CODING_COMPLETE'), // status_v2 = CODING_COMPLETE
          statusStringToNumber('INVALID'), // status_v2 = INVALID
          statusStringToNumber('CODING_ERROR') // status_v2 = CODING_ERROR
        ]);

        const batchCount = parseInt(result[0]?.applied_count || '0', 10);
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
