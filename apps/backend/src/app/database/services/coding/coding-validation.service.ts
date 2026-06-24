import {
  Injectable, Logger, forwardRef, Inject
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CacheService } from '../../../cache/cache.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ValidationResultDto } from '../../../../../../../api-dto/coding/validation-result.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  ManualCodeAvailabilityValidationDto,
  ManualCodeAvailabilityWarningDto
} from '../../../../../../../api-dto/coding/manual-code-availability.dto';
import { generateExpectedCombinationsHash } from '../../../utils/coding-utils';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { VariableDetailDto } from '../../../models/unit-variable-details.dto';
import { WorkspacePlayerService } from '../workspace/workspace-player.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { CodingJobService } from './coding-job.service';
import {
  buildAggregationGroups,
  deduplicateManualCodingResponses,
  getManualCodingDeduplicationKey,
  ManualCodingDeduplicationResponse
} from './aggregation-metrics.util';
import { getCodingIncompleteVariablesCacheKey } from './coding-incomplete-variables-cache-key.util';
import {
  getCoveredSourceKeysForManualDerivedVariables,
  isCoveredSourceVariable,
  ManualCodingExcludedSourceSummary,
  summarizeCoveredSourceVariables
} from '../../utils/manual-coding-scope.util';
import {
  createManualCodingVariableReferences,
  DERIVE_ERROR_STATUS
} from '../../utils/manual-coding-candidate.util';
import { hasVisibleManualInstruction } from '../../../utils/manual-instruction.util';
import {
  applyNonCodingIssueReviewJobFilter,
  getNonCodingIssueReviewJobSqlCondition
} from './coding-job-type.util';

interface NormalizedExpectedCombination {
  unitKey: string;
  unitAlias: string;
  loginName: string;
  loginCode: string;
  personGroup: string;
  bookletId: string;
  variableId: string;
  variablePage: string;
  variableAnchor: string;
}

type ManualCodingVariableCaseCounts = {
  unitName: string;
  variableId: string;
  responseCount: number;
  deriveErrorResponseCount: number;
  isDerived: boolean;
  coderTrainingRequired: boolean;
};

type SlimCodingResponse = {
  id: number;
  unitName: string;
  variableid: string;
  value: string | null;
  statusV1?: number | null;
  personLogin?: string | null;
  personCode?: string | null;
  personGroup?: string | null;
};

type VariableCaseInfo = {
  casesInJobs: number;
  availableCases: number;
  uniqueCasesAfterAggregation: number;
  availableCasesWithDeriveError?: number;
  uniqueCasesAfterAggregationWithDeriveError?: number;
};

type ManualCodingScopeFromDb = {
  variables: ManualCodingVariableCaseCounts[];
  excludedSourceSummary: ManualCodingExcludedSourceSummary;
};

export type ManualCodingScopeSummary = ManualCodingExcludedSourceSummary & {
  manualVariableCount: number;
  manualResponseCount: number;
};

type ManualCodingVariableWithCaseInfo = {
  unitName: string;
  variableId: string;
  responseCount: number;
  deriveErrorResponseCount: number;
  casesInJobs: number;
  availableCases: number;
  uniqueCasesAfterAggregation: number;
  availableCasesWithDeriveError?: number;
  uniqueCasesAfterAggregationWithDeriveError?: number;
  isDerived: boolean;
  coderTrainingRequired: boolean;
};

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
    private codingJobService: CodingJobService,
    private workspacePlayerService: WorkspacePlayerService
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
      const replayAssetIssueCache = new Map<string, Promise<string[]>>();
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

      const batchSize = 100;
      for (let i = 0; i < expectedCombinations.length; i += batchSize) {
        const batch = expectedCombinations.slice(i, i + batchSize);
        this.logger.log(
          `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            expectedCombinations.length / batchSize
          )}`
        );

        for (const expected of batch) {
          const normalizedExpected = this.normalizeExpectedCombination(expected);
          const safeCombination = this.buildSafeExpectedCombination(
            normalizedExpected
          );
          const inputIssues = this.getExpectedCombinationInputIssues(
            normalizedExpected
          );

          if (inputIssues.length > 0) {
            totalMissingCount += 1;
            allResults.push({
              combination: safeCombination,
              status: 'MISSING',
              responseFound: false,
              issues: inputIssues
            });
            continue;
          }

          const queryBuilder = this.responseRepository
            .createQueryBuilder('response')
            .leftJoinAndSelect('response.unit', 'unit')
            .leftJoinAndSelect('unit.booklet', 'booklet')
            .leftJoinAndSelect('booklet.person', 'person')
            .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere('response.value IS NOT NULL')
            .andWhere('response.value != :empty', { empty: '' });

          this.applyExpectedCombinationFilters(queryBuilder, normalizedExpected);
          applyResolvedExclusionsToQuery(queryBuilder, exclusions);

          const response = await queryBuilder.getOne();
          const responseFound = Boolean(response);
          const issues: string[] = [];
          if (!response) {
            issues.push('Keine passende Antwort gefunden.');
          } else {
            const unitName = response.unit?.name ||
              normalizedExpected.unitKey ||
              normalizedExpected.unitAlias;
            issues.push(
              ...await this.getReplayAssetIssues(
                workspaceId,
                unitName,
                replayAssetIssueCache
              )
            );
          }

          const status = issues.length > 0 ? 'MISSING' : 'EXISTS';
          if (status === 'MISSING') {
            totalMissingCount += 1;
          }

          allResults.push({
            combination: safeCombination,
            status,
            responseFound,
            ...(issues.length > 0 ? { issues } : {})
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

  private normalizeExpectedCombination(
    expected: ExpectedCombinationDto
  ): NormalizedExpectedCombination {
    return {
      unitKey: this.cleanExpectedValue(expected.unit_key),
      unitAlias: this.cleanExpectedValue(expected.unit_alias),
      loginName: this.cleanExpectedValue(expected.login_name),
      loginCode: this.cleanExpectedValue(expected.login_code),
      personGroup: this.cleanExpectedValue(expected.person_group),
      bookletId: this.cleanExpectedValue(expected.booklet_id),
      variableId: this.cleanExpectedValue(expected.variable_id),
      variablePage: this.cleanExpectedValue(expected.variable_page),
      variableAnchor: this.cleanExpectedValue(expected.variable_anchor)
    };
  }

  private cleanExpectedValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private getExpectedCombinationInputIssues(
    expected: NormalizedExpectedCombination
  ): string[] {
    const missingFields: string[] = [];
    if (!expected.unitKey && !expected.unitAlias) missingFields.push('unit_key/unit_alias');
    if (!expected.loginName) missingFields.push('login_name/person_login');
    if (!expected.loginCode) missingFields.push('login_code/person_code');
    if (!expected.bookletId) missingFields.push('booklet_id/booklet_name');
    if (!expected.variableId) missingFields.push('variable_id');

    return missingFields.length > 0 ?
      [`Pflichtfelder fehlen: ${missingFields.join(', ')}.`] :
      [];
  }

  private buildSafeExpectedCombination(
    expected: NormalizedExpectedCombination
  ): ExpectedCombinationDto {
    return {
      unit_key: expected.unitKey || expected.unitAlias,
      ...(expected.unitAlias ? { unit_alias: expected.unitAlias } : {}),
      login_name: expected.loginName,
      login_code: expected.loginCode,
      ...(expected.personGroup ? { person_group: expected.personGroup } : {}),
      booklet_id: expected.bookletId,
      variable_id: expected.variableId,
      ...(expected.variablePage ? { variable_page: expected.variablePage } : {}),
      ...(expected.variableAnchor ? { variable_anchor: expected.variableAnchor } : {})
    };
  }

  private applyExpectedCombinationFilters(
    queryBuilder: SelectQueryBuilder<ResponseEntity>,
    expected: NormalizedExpectedCombination
  ): void {
    const unitCandidates = Array.from(
      new Set([expected.unitKey, expected.unitAlias].filter(Boolean))
    ) as string[];

    queryBuilder
      .andWhere(new Brackets(qb => {
        unitCandidates.forEach((unitCandidate, index) => {
          const parameterName = `unitCandidate${index}`;
          const condition = `(unit.name = :${parameterName} OR unit.alias = :${parameterName})`;
          if (index === 0) {
            qb.where(condition, { [parameterName]: unitCandidate });
          } else {
            qb.orWhere(condition, { [parameterName]: unitCandidate });
          }
        });
      }))
      .andWhere('person.login = :loginName', {
        loginName: expected.loginName
      })
      .andWhere('person.code = :loginCode', {
        loginCode: expected.loginCode
      })
      .andWhere('bookletinfo.name = :bookletId', {
        bookletId: expected.bookletId
      })
      .andWhere('response.variableid = :variableId', {
        variableId: expected.variableId
      });

    if (expected.personGroup) {
      queryBuilder.andWhere('person.group = :personGroup', {
        personGroup: expected.personGroup
      });
    }
  }

  private async getReplayAssetIssues(
    workspaceId: number,
    unitName: string,
    cache: Map<string, Promise<string[]>>
  ): Promise<string[]> {
    const normalizedUnitName = unitName.trim().toUpperCase();
    if (!normalizedUnitName) {
      return [];
    }

    if (!cache.has(normalizedUnitName)) {
      cache.set(
        normalizedUnitName,
        this.validateReplayAssetsForUnit(workspaceId, normalizedUnitName)
      );
    }

    return cache.get(normalizedUnitName)!;
  }

  private async validateReplayAssetsForUnit(
    workspaceId: number,
    normalizedUnitName: string
  ): Promise<string[]> {
    const issues: string[] = [];

    try {
      const [unitDef, unitFile] = await Promise.all([
        this.workspacePlayerService.findUnitDef(workspaceId, normalizedUnitName),
        this.workspacePlayerService.findUnit(workspaceId, normalizedUnitName)
      ]);

      if (!unitDef?.length) {
        issues.push(`Unit-Definition fehlt: ${normalizedUnitName}.VOUD.`);
      }

      if (!unitFile?.length) {
        issues.push(`Unit-Datei fehlt: ${normalizedUnitName}.`);
        return issues;
      }

      const playerName = await this.extractNormalizedPlayerIdFromUnitData(
        unitFile[0].data
      );
      const player = await this.workspacePlayerService.findPlayer(
        workspaceId,
        playerName
      );

      if (!player?.length) {
        issues.push(`Player fehlt: ${playerName}.`);
      }
    } catch (error) {
      issues.push(
        `Replay-Dateien konnten nicht geprüft werden: ${error.message}.`
      );
    }

    return issues;
  }

  private async extractNormalizedPlayerIdFromUnitData(
    unitData: string
  ): Promise<string> {
    const parsed = await parseStringPromise(unitData);
    const playerRef = parsed?.Unit?.DefinitionRef?.[0]?.$?.player;
    if (!playerRef || typeof playerRef !== 'string') {
      throw new Error('Player-Referenz fehlt in der Unit-Datei');
    }
    return this.normalizePlayerId(playerRef);
  }

  private normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;
    const matches = name.match(reg);
    if (!matches) {
      throw new Error(`Ungültiges Player-ID-Format: ${name}`);
    }

    const module = matches[1] || '';
    const major = parseInt(matches[3], 10) || 0;
    const minor = typeof matches[4] === 'string' ? parseInt(matches[4].substring(1), 10) : 0;
    const patch = typeof matches[5] === 'string' ? parseInt(matches[5].substring(1), 10) : 0;
    return `${module}-${major}.${minor}.${patch}`.toUpperCase();
  }

  async getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean,
    includeDeriveErrorOnly = false,
    excludeJobDefinitionId?: number
  ): Promise<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      deriveErrorResponseCount: number;
      casesInJobs: number;
      availableCases: number;
      uniqueCasesAfterAggregation: number;
      availableCasesWithDeriveError?: number;
      uniqueCasesAfterAggregationWithDeriveError?: number;
      isDerived: boolean;
      coderTrainingRequired: boolean;
    }[]
    > {
    try {
      if (
        unitName ||
        trainingRequired !== undefined ||
        includeDeriveErrorOnly ||
        excludeJobDefinitionId !== undefined
      ) {
        const queryDetails = [
          unitName ? ` and unit ${unitName}` : '',
          trainingRequired !== undefined ? ` (trainingRequired: ${trainingRequired})` : '',
          excludeJobDefinitionId !== undefined ? ` excluding job definition ${excludeJobDefinitionId}` : ''
        ].join('');
        this.logger.log(
          `Querying manual coding variables for workspace ${workspaceId}${queryDetails} (not cached)`
        );
        const variables = await this.fetchCodingIncompleteVariablesFromDb(
          workspaceId,
          unitName,
          trainingRequired,
          includeDeriveErrorOnly
        );
        return await this.enrichVariablesWithCaseInfo(
          workspaceId,
          variables,
          includeDeriveErrorOnly,
          excludeJobDefinitionId
        );
      }
      const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
      const cachedResult = await this.cacheService.get<
      {
        unitName: string;
        variableId: string;
        responseCount: number;
        deriveErrorResponseCount: number;
        casesInJobs: number;
        availableCases: number;
        uniqueCasesAfterAggregation: number;
        availableCasesWithDeriveError?: number;
        uniqueCasesAfterAggregationWithDeriveError?: number;
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
        workspaceId,
        undefined,
        undefined,
        includeDeriveErrorOnly
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

  async getManualCodingScopeSummary(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean
  ): Promise<ManualCodingScopeSummary> {
    try {
      const scope = await this.fetchManualCodingScopeFromDb(
        workspaceId,
        unitName,
        trainingRequired
      );

      return {
        manualVariableCount: scope.variables.length,
        manualResponseCount: scope.variables.reduce(
          (sum, variable) => sum + variable.responseCount,
          0
        ),
        ...scope.excludedSourceSummary
      };
    } catch (error) {
      this.logger.error(
        `Error getting manual coding scope summary: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get manual coding scope summary. Please check the database connection.'
      );
    }
  }

  async validateManualCodeAvailability(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean
  ): Promise<ManualCodeAvailabilityValidationDto> {
    try {
      const [variables, variableDetailsByKey] = await Promise.all([
        this.getCodingIncompleteVariables(
          workspaceId,
          unitName,
          trainingRequired
        ),
        this.getManualCodeAvailabilityDetailsByKey(workspaceId)
      ]);

      const warnings = variables.reduce<ManualCodeAvailabilityWarningDto[]>(
        (items, variable) => {
          const detail = variableDetailsByKey.get(
            this.getManualCodeAvailabilityKey(
              variable.unitName,
              variable.variableId
            )
          );
          const counts = this.getManualCodeAvailabilityCounts(detail);

          if (counts.selectableRegularCodeCount > 0) {
            return items;
          }

          items.push({
            unitName: variable.unitName,
            variableId: variable.variableId,
            responseCount: variable.responseCount,
            casesInJobs: variable.casesInJobs,
            availableCases: variable.availableCases,
            uniqueCasesAfterAggregation:
              variable.uniqueCasesAfterAggregation,
            regularCodeCount: counts.regularCodeCount,
            selectableRegularCodeCount: counts.selectableRegularCodeCount,
            onlySpecialOptionsAvailable: true,
            message:
              'Variable hat keine regulaeren Codes mit manueller Instruktion. In der Kodierung bleiben nur Sonderoptionen wie "Code-Vergabe unsicher" oder "Neuer Code noetig" verfuegbar.'
          });
          return items;
        },
        []
      );

      return {
        checkedVariables: variables.length,
        warningCount: warnings.length,
        warnings
      };
    } catch (error) {
      this.logger.error(
        `Error validating manual code availability: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not validate manual code availability. Please check the coding schemes.'
      );
    }
  }

  /**
     * Enrich variables with case information (cases in jobs, available cases, and unique cases after aggregation)
     */
  private async enrichVariablesWithCaseInfo(
    workspaceId: number,
    variables: ManualCodingVariableCaseCounts[],
    includeDeriveErrorInCaseInfo = false,
    excludeJobDefinitionId?: number
  ): Promise<ManualCodingVariableWithCaseInfo[]> {
    const caseInfoMap = await this.computeVariableCaseInfo(
      workspaceId,
      variables,
      includeDeriveErrorInCaseInfo,
      excludeJobDefinitionId
    );

    return variables.map(variable => {
      const key = `${variable.unitName}::${variable.variableId}`;
      const caseInfo = caseInfoMap.get(key) || {
        casesInJobs: 0,
        availableCases: variable.responseCount,
        uniqueCasesAfterAggregation: variable.responseCount
      };

      return {
        ...variable,
        ...caseInfo
      };
    });
  }

  /**
   * Compute total, assigned and available cases per variable on the same case level.
   * With duplicate aggregation active, raw response ids can outnumber effective coding
   * cases. Availability therefore has to be calculated per aggregation group.
   */
  private async computeVariableCaseInfo(
    workspaceId: number,
    variables: ManualCodingVariableCaseCounts[],
    includeDeriveErrorInCaseInfo = false,
    excludeJobDefinitionId?: number
  ): Promise<Map<string, VariableCaseInfo>> {
    const result = new Map<string, VariableCaseInfo>();

    if (variables.length === 0) {
      return result;
    }

    const aggregationThreshold = await this.codingJobService.getAggregationThreshold(workspaceId);

    const matchingFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);
    const variableReferences = variables.map(v => ({
      unitName: v.unitName,
      variableId: v.variableId,
      ...(includeDeriveErrorInCaseInfo && v.deriveErrorResponseCount > 0 ?
        { includeDeriveError: true } :
        {})
    }));
    const [slimResponses, assignedResponseIdsByVariable] = await Promise.all([
      this.codingJobService.getSlimResponsesForVariables(
        workspaceId,
        variableReferences
      ) as Promise<SlimCodingResponse[]>,
      this.getAssignedResponseIdsByVariable(
        workspaceId,
        variableReferences,
        excludeJobDefinitionId
      )
    ]);

    const derivedVariableMap = new Map<string, Set<string>>();
    variables
      .filter(variable => variable.isDerived)
      .forEach(variable => {
        const unitKey = variable.unitName.toUpperCase();
        const derivedVariables = derivedVariableMap.get(unitKey) || new Set<string>();
        derivedVariables.add(variable.variableId);
        derivedVariableMap.set(unitKey, derivedVariables);
      });

    for (const variable of variables) {
      const key = `${variable.unitName}::${variable.variableId}`;

      const varResponsesWithRequestedStatuses = slimResponses.filter(
        r => r.unitName === variable.unitName && r.variableid === variable.variableId
      );

      const countAggregatedCases = (responses: SlimCodingResponse[]) => {
        const responsesWithCaseFields: ManualCodingDeduplicationResponse[] =
          responses.map(response => ({
            ...response,
            responseId: response.id,
            variableId: response.variableid
          }));
        const assignedResponseIds = assignedResponseIdsByVariable.get(key) || new Set<number>();
        const assignedDeduplicationKeys = new Set(
          responsesWithCaseFields
            .filter(response => assignedResponseIds.has(response.responseId))
            .map(response => getManualCodingDeduplicationKey(response))
        );
        const dedupedResponses = deduplicateManualCodingResponses(responsesWithCaseFields);
        const assignedDedupedResponseIds = new Set(
          dedupedResponses
            .filter(response => (
              assignedResponseIds.has(response.responseId) ||
              assignedDeduplicationKeys.has(getManualCodingDeduplicationKey(response))
            ))
            .map(response => response.responseId)
        );
        const aggregatedGroups = buildAggregationGroups(
          dedupedResponses,
          matchingFlags,
          aggregationThreshold,
          derivedVariableMap
        );

        let uniqueCases = 0;
        let casesInJobs = 0;

        for (const group of aggregatedGroups) {
          if (aggregationThreshold !== null && group.responses.length >= aggregationThreshold) {
            uniqueCases += 1;
            if (group.responses.some(response => assignedDedupedResponseIds.has(response.responseId))) {
              casesInJobs += 1;
            }
          } else {
            uniqueCases += group.responses.length;
            casesInJobs += group.responses
              .filter(response => assignedDedupedResponseIds.has(response.responseId))
              .length;
          }
        }

        return { uniqueCases, casesInJobs };
      };

      const includeDeriveErrorForVariable = includeDeriveErrorInCaseInfo &&
        variable.deriveErrorResponseCount > 0;
      const regularVarResponses = includeDeriveErrorForVariable ?
        varResponsesWithRequestedStatuses.filter(response => response.statusV1 !== DERIVE_ERROR_STATUS) :
        varResponsesWithRequestedStatuses;
      const regularCaseInfo = countAggregatedCases(regularVarResponses);
      const deriveErrorCaseInfo = includeDeriveErrorForVariable ?
        countAggregatedCases(varResponsesWithRequestedStatuses) :
        null;

      result.set(key, {
        casesInJobs: regularCaseInfo.casesInJobs,
        availableCases: Math.max(0, regularCaseInfo.uniqueCases - regularCaseInfo.casesInJobs),
        uniqueCasesAfterAggregation: regularCaseInfo.uniqueCases,
        ...(deriveErrorCaseInfo ? {
          availableCasesWithDeriveError: Math.max(
            0,
            deriveErrorCaseInfo.uniqueCases - deriveErrorCaseInfo.casesInJobs
          ),
          uniqueCasesAfterAggregationWithDeriveError: deriveErrorCaseInfo.uniqueCases
        } : {})
      });
    }

    this.logger.log(
      `Computed case availability for ${variables.length} variables in workspace ${workspaceId}`
    );

    return result;
  }

  private async getManualCodeAvailabilityDetailsByKey(
    workspaceId: number
  ): Promise<Map<string, VariableDetailDto>> {
    const unitVariableDetails =
      await this.workspaceFilesService.getUnitVariableDetails(workspaceId);
    const variableDetailsByKey = new Map<string, VariableDetailDto>();

    unitVariableDetails.forEach(unitDetails => {
      const unitKeys = [
        unitDetails.unitName,
        unitDetails.unitId
      ].filter(Boolean);

      unitDetails.variables.forEach(variable => {
        const variableIds = [
          variable.alias || variable.id
        ].filter(Boolean);

        unitKeys.forEach(unitKey => {
          variableIds.forEach(variableId => {
            const key = this.getManualCodeAvailabilityKey(
              unitKey,
              variableId
            );
            if (!variableDetailsByKey.has(key)) {
              variableDetailsByKey.set(key, variable);
            }
          });
        });
      });
    });

    return variableDetailsByKey;
  }

  private getManualCodeAvailabilityCounts(
    variable: VariableDetailDto | undefined
  ): { regularCodeCount: number; selectableRegularCodeCount: number } {
    const regularCodes = (variable?.codes || []).filter(
      code => code.id !== undefined && code.id !== null
    );

    return {
      regularCodeCount: regularCodes.length,
      selectableRegularCodeCount: regularCodes.filter(
        code => this.hasManualInstruction(code)
      ).length
    };
  }

  private hasManualInstruction(
    code: { manualInstruction?: string | null }
  ): boolean {
    return hasVisibleManualInstruction(code);
  }

  private getManualCodeAvailabilityKey(
    unitName: string | null | undefined,
    variableId: string | null | undefined
  ): string {
    return `${String(unitName || '').trim().toUpperCase()}::${String(variableId || '').trim()}`;
  }

  private async getAssignedResponseIdsByVariable(
    workspaceId: number,
    variables: { unitName: string; variableId: string }[],
    excludeJobDefinitionId?: number
  ): Promise<Map<string, Set<number>>> {
    const result = new Map<string, Set<number>>();

    if (variables.length === 0) {
      return result;
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.response_id', 'responseId')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL');

    if (
      excludeJobDefinitionId !== undefined &&
      excludeJobDefinitionId !== null
    ) {
      query.andWhere(
        '(coding_job.job_definition_id IS NULL OR coding_job.job_definition_id != :excludeJobDefinitionId)',
        { excludeJobDefinitionId }
      );
    }

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `assignedUnitName${index}`;
      const variableParam = `assignedVariableId${index}`;
      conditions.push(`(cju.unit_name = :${unitParam} AND cju.variable_id = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    query.andWhere(`(${conditions.join(' OR ')})`, parameters);
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'codingValidationAssignedResponsesReviewJobType'
    );
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'codingValidationAssignedResponses'
    });

    const rawResults = await query.getRawMany();

    rawResults.forEach(row => {
      const responseId = Number(row.responseId);
      if (!Number.isFinite(responseId)) {
        return;
      }

      const key = `${row.unitName}::${row.variableId}`;
      const responseIds = result.get(key) || new Set<number>();
      responseIds.add(responseId);
      result.set(key, responseIds);
    });

    return result;
  }

  private async fetchCodingIncompleteVariablesFromDb(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean,
    includeDeriveErrorOnly = false
  ): Promise<
    { unitName: string; variableId: string; responseCount: number; deriveErrorResponseCount: number; isDerived: boolean; coderTrainingRequired: boolean }[]
    > {
    const scope = await this.fetchManualCodingScopeFromDb(
      workspaceId,
      unitName,
      trainingRequired,
      includeDeriveErrorOnly
    );
    return scope.variables;
  }

  private async fetchManualCodingScopeFromDb(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean,
    includeDeriveErrorOnly = false
  ): Promise<ManualCodingScopeFromDb> {
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
        // Exclude special/auto codes represented as negative code_v2 values.
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
    const [codingIncompleteRaw, intendedIncompleteRaw, deriveErrorCountsByKey] = await Promise.all([
      buildQuery(statusStringToNumber('CODING_INCOMPLETE')).getRawMany(),
      buildQuery(statusStringToNumber('INTENDED_INCOMPLETE')).getRawMany(),
      this.getDeriveErrorResponseCountsByVariable(workspaceId, unitName)
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
    const [
      unitVariableMap,
      derivedVariableMap,
      trainingRequiredMap,
      derivedVariablesBySourceMap,
      manualInstructionMap
    ] = await Promise.all([
      this.workspaceFilesService.getUnitVariableMap(workspaceId),
      this.workspaceFilesService.getDerivedVariableMap(workspaceId),
      this.workspaceFilesService.getCoderTrainingRequiredVariableMap(workspaceId),
      this.workspaceFilesService.getDerivedVariablesBySourceMap(workspaceId),
      this.workspaceFilesService.getManualInstructionVariableMap(workspaceId)
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

    const manualInstructionSets = new Map<string, Set<string>>();
    manualInstructionMap.forEach((variables: Set<string>, unitNameKey: string) => {
      manualInstructionSets.set(unitNameKey.toUpperCase(), variables);
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
    const coveredSourceKeys = getCoveredSourceKeysForManualDerivedVariables(
      filteredCodingIncomplete,
      derivedVariablesBySourceMap
    );
    const filteredIntendedIncompleteBeforeSourceExclusion =
      intendedIncompleteRaw.filter(row => {
        if (!filterFn(row)) {
          return false;
        }

        const unitKey = row.unitName?.toUpperCase();
        return manualInstructionSets.get(unitKey)?.has(row.variableId) || false;
      });
    const filteredIntendedIncomplete =
      filteredIntendedIncompleteBeforeSourceExclusion.filter(
        row => !isCoveredSourceVariable(row, coveredSourceKeys)
      );
    const excludedSourceSummary = summarizeCoveredSourceVariables(
      filteredIntendedIncompleteBeforeSourceExclusion,
      coveredSourceKeys,
      derivedVariablesBySourceMap
    );
    const deriveErrorCoveredSourceKeys = includeDeriveErrorOnly ?
      getCoveredSourceKeysForManualDerivedVariables(
        Array.from(manualInstructionSets.entries()).flatMap(([manualUnitName, variables]) => (
          Array.from(variables)
            .map(variableId => ({ unitName: manualUnitName, variableId }))
            .filter(row => filterFn({
              unitName: row.unitName,
              variableId: row.variableId,
              responseCount: '0'
            }))
        )),
        derivedVariablesBySourceMap
      ) :
      new Set<string>();
    const getScopedDeriveErrorResponseCount = (
      responseUnitName: string,
      variableId: string
    ): number => (
      includeDeriveErrorOnly &&
      isCoveredSourceVariable(
        { unitName: responseUnitName, variableId },
        deriveErrorCoveredSourceKeys
      ) ?
        0 :
        deriveErrorCountsByKey.get(`${responseUnitName}::${variableId}`) || 0
    );

    // Merge results, summing response counts for variables that appear in both
    const mergedMap = new Map<string, {
      unitName: string;
      variableId: string;
      responseCount: number;
      deriveErrorResponseCount: number;
      isDerived: boolean;
      coderTrainingRequired: boolean;
    }>();

    for (const row of [...filteredCodingIncomplete, ...filteredIntendedIncomplete]) {
      const key = `${row.unitName}::${row.variableId}`;
      const existing = mergedMap.get(key);
      const count = parseInt(row.responseCount, 10);
      const deriveErrorResponseCount =
        getScopedDeriveErrorResponseCount(row.unitName, row.variableId);
      const isDerived = derivedVariableSets.get(row.unitName?.toUpperCase())?.has(row.variableId) ?? false;
      const coderTrainingRequired = trainingRequiredSets.get(row.unitName?.toUpperCase())?.has(row.variableId) ?? false;

      if (existing) {
        existing.responseCount += count;
      } else {
        mergedMap.set(key, {
          unitName: row.unitName,
          variableId: row.variableId,
          responseCount: count,
          deriveErrorResponseCount,
          isDerived,
          coderTrainingRequired
        });
      }
    }

    if (includeDeriveErrorOnly) {
      deriveErrorCountsByKey.forEach((deriveErrorResponseCount, key) => {
        if (mergedMap.has(key)) {
          return;
        }

        const [deriveUnitName, variableId] = key.split('::');
        if (
          isCoveredSourceVariable(
            { unitName: deriveUnitName, variableId },
            deriveErrorCoveredSourceKeys
          )
        ) {
          return;
        }
        if (!filterFn({
          unitName: deriveUnitName,
          variableId,
          responseCount: String(deriveErrorResponseCount)
        })) {
          return;
        }

        mergedMap.set(key, {
          unitName: deriveUnitName,
          variableId,
          responseCount: 0,
          deriveErrorResponseCount,
          isDerived: derivedVariableSets.get(deriveUnitName?.toUpperCase())?.has(variableId) ?? false,
          coderTrainingRequired: trainingRequiredSets.get(deriveUnitName?.toUpperCase())?.has(variableId) ?? false
        });
      });
    }

    const result = Array.from(mergedMap.values());

    this.logger.log(
      `Found ${codingIncompleteRaw.length} CODING_INCOMPLETE + ${intendedIncompleteRaw.length} INTENDED_INCOMPLETE variable groups, ` +
      `filtered to ${result.length} valid variables${unitName ? ` for unit ${unitName}` : ''}`
    );

    return {
      variables: result,
      excludedSourceSummary
    };
  }

  private async getDeriveErrorResponseCountsByVariable(
    workspaceId: number,
    unitName?: string
  ): Promise<Map<string, number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.responseRepository
      .createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('COUNT(response.id)', 'responseCount')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('DERIVE_ERROR')
      })
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('(response.code_v2 IS NULL OR response.code_v2 >= 0)')
      .groupBy('unit.name')
      .addGroupBy('response.variableid');

    if (unitName) {
      query.andWhere('unit.name = :unitName', { unitName });
    }

    applyResolvedExclusionsToQuery(query, exclusions, {
      parameterPrefix: 'deriveErrorResponseCounts'
    });

    const rawResults = await query.getRawMany<{
      unitName: string;
      variableId: string;
      responseCount: string;
    }>();

    return rawResults.reduce((counts, row) => {
      if (row.unitName && row.variableId) {
        counts.set(`${row.unitName}::${row.variableId}`, parseInt(row.responseCount, 10) || 0);
      }
      return counts;
    }, new Map<string, number>());
  }

  generateIncompleteVariablesCacheKey(workspaceId: number): string {
    return getCodingIncompleteVariablesCacheKey(workspaceId);
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
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'codingValidationCasesInJobsReviewJobType'
    );
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

  private async getDeriveErrorManualJobVariables(
    workspaceId: number
  ): Promise<Array<{ unitName: string; variableId: string }>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .innerJoin('cju.coding_job', 'coding_job')
      .innerJoin('cju.response', 'response')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere('response.status_v1 = :deriveErrorStatus', {
        deriveErrorStatus: statusStringToNumber('DERIVE_ERROR')
      })
      .distinct(true);
    applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'appliedResultsDeriveErrorVariablesReviewJobType'
    );

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'appliedResultsDeriveErrorVariables'
    });

    const rawResults = await query.getRawMany<{ unitName: string; variableId: string }>();
    return rawResults.filter(row => row.unitName && row.variableId);
  }

  private async getAppliedResultsVariables(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Promise<Array<{ unitName: string; variableId: string }>> {
    const providedVariables = Array.isArray(incompleteVariables) ?
      incompleteVariables :
      [];
    const deriveErrorManualVariables = await this.getDeriveErrorManualJobVariables(workspaceId);
    return createManualCodingVariableReferences([
      ...providedVariables,
      ...deriveErrorManualVariables
    ]);
  }

  async getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Promise<number> {
    try {
      const providedVariables = Array.isArray(incompleteVariables) ?
        incompleteVariables :
        [];
      this.logger.log(
        `Getting applied results count for ${providedVariables.length} manual coding variables in workspace ${workspaceId}`
      );

      const appliedResultsVariables = await this.getAppliedResultsVariables(
        workspaceId,
        providedVariables
      );

      if (appliedResultsVariables.length === 0) {
        return 0;
      }

      let totalAppliedCount = 0;
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      const batchSize = 50;
      for (let i = 0; i < appliedResultsVariables.length; i += batchSize) {
        const batch = appliedResultsVariables.slice(i, i + batchSize);

        const query = this.responseRepository
          .createQueryBuilder('response')
          .innerJoin('response.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('booklet.person', 'person')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere(new Brackets(qb => {
            qb.where('response.status_v1 IN (:...sourceStatuses)', {
              sourceStatuses: [
                statusStringToNumber('CODING_INCOMPLETE'),
                statusStringToNumber('INTENDED_INCOMPLETE')
              ]
            }).orWhere(
              `response.status_v1 = :deriveErrorStatus
                AND EXISTS (
                  SELECT 1
                  FROM coding_job_unit manual_derive_cju
                  INNER JOIN coding_job manual_derive_cj
                    ON manual_derive_cj.id = manual_derive_cju.coding_job_id
                  WHERE manual_derive_cju.response_id = response.id
                    AND manual_derive_cj.training_id IS NULL
                    AND ${getNonCodingIssueReviewJobSqlCondition('manual_derive_cj')}
                )`,
              { deriveErrorStatus: statusStringToNumber('DERIVE_ERROR') }
            );
          }))
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
