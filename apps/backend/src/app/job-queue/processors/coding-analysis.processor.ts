import { Processor, Process } from '@nestjs/bull';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../database/entities/response.entity';
import { ResponseMatchingFlag } from '../../database/services/coding/coding-job.service';
import { CodingValidationService } from '../../database/services/coding';
import {
  ResponseAnalysisDto,
  EmptyResponseDto,
  DuplicateValueGroupDto
} from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { statusStringToNumber } from '../../database/utils/response-status-converter';
import { CodingAnalysisJobData } from '../job-queue.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../../database/services/workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../../database/services/workspace';
import {
  createAggregationSummary,
  isAggregatableValue,
  isDerivedAggregationVariable,
  normalizeAggregationValue
} from '../../database/services/coding/aggregation-metrics.util';
import { getCodingAnalysisRunMarkerKey } from '../../database/services/coding/coding-analysis-cache-key.util';
import {
  createDuplicateValueChunkCaches,
  createDuplicateValuePageCache,
  createEmptyResponseChunkCaches,
  createEmptyResponsePageCache,
  createResponseAnalysisSummaryCache,
  getResponseAnalysisDuplicateChunkCacheKey,
  getResponseAnalysisDuplicatePageCacheKey,
  getResponseAnalysisEmptyChunkCacheKey,
  getResponseAnalysisEmptyPageCacheKey,
  getResponseAnalysisSummaryCacheKey,
  RESPONSE_ANALYSIS_DUPLICATE_PAGE_LIMITS,
  RESPONSE_ANALYSIS_EMPTY_PAGE_LIMITS
} from '../../database/services/coding/response-analysis-page-cache.util';
import {
  IQB_STANDARD_MISSING_CODES,
  MissingsProfilesService
} from '../../database/services/coding/missings-profiles.service';

interface ManualAnalysisVariable {
  unitName: string;
  variableId: string;
}

interface AnalysisResponseRow {
  responseId: number | string;
  value: string | null;
  variableId: string;
  statusV2: number | string | null;
  codeV2: number | string | null;
  unitName: string | null;
  unitAlias: string | null;
  personLogin: string | null;
  personCode: string | null;
  personGroup: string | null;
  bookletName: string | null;
}

interface CodingAnalysisJobResult {
  workspaceId: number;
  cacheKey: string;
  status: 'cached' | 'stale-skip';
  sourceRevision?: number;
  completedAt: string;
}

@Processor('response-analysis')
export class CodingAnalysisProcessor {
  private readonly logger = new Logger(CodingAnalysisProcessor.name);
  private readonly slowResponseAnalysisThresholdMs = 3000;
  private readonly normalizedUnitNameExpression =
    "regexp_replace(UPPER(unit.name), '\\.XML$', '', 'i')";

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private workspaceFilesService: WorkspaceFilesService,
    private codingValidationService: CodingValidationService,
    @Optional()
    private missingsProfilesService?: MissingsProfilesService
  ) {}

  private async getDefaultMirCode(workspaceId: number): Promise<number> {
    if (!this.missingsProfilesService) {
      return IQB_STANDARD_MISSING_CODES.mir;
    }

    const missing =
      await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
        workspaceId,
        null,
        'mir'
      );
    return missing.code;
  }

  @Process()
  async handleResponseAnalysis(
    job: Job<CodingAnalysisJobData>
  ): Promise<CodingAnalysisJobResult> {
    const {
      workspaceId, matchingFlags, threshold, cacheKey
    } = job.data;
    const startedAt = Date.now();
    this.logger.log(
      `Processing response analysis for workspace ${workspaceId}...`
    );

    try {
      const analysis = await this.computeResponseAnalysis(
        workspaceId,
        matchingFlags as ResponseMatchingFlag[],
        threshold,
        job
      );
      if (job.data.runId) {
        const currentRunId = await this.cacheService.get<string>(
          getCodingAnalysisRunMarkerKey(cacheKey)
        );
        if (currentRunId !== job.data.runId) {
          this.logger.log(
            `Skipping stale response analysis cache write for workspace ${workspaceId} (job ${job.id})`
          );
          this.logResponseAnalysisTiming(
            workspaceId,
            startedAt,
            'completed-stale-skip'
          );
          return this.createJobResult(job.data, 'stale-skip');
        }
      }

      await this.writeResponseAnalysisPageCaches(cacheKey, analysis);

      this.logResponseAnalysisTiming(
        workspaceId,
        startedAt,
        'completed-and-cached'
      );
      return this.createJobResult(job.data, 'cached');
    } catch (error) {
      this.logResponseAnalysisTiming(workspaceId, startedAt, 'failed');
      this.logger.error(
        `Response analysis failed: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  private async writeResponseAnalysisPageCaches(
    cacheKey: string,
    analysis: ResponseAnalysisDto
  ): Promise<void> {
    const writes: Promise<boolean>[] = [
      this.cacheService.set(
        getResponseAnalysisSummaryCacheKey(cacheKey),
        createResponseAnalysisSummaryCache(analysis)
      )
    ];

    for (const limit of RESPONSE_ANALYSIS_EMPTY_PAGE_LIMITS) {
      writes.push(
        this.cacheService.set(
          getResponseAnalysisEmptyPageCacheKey(cacheKey, 1, limit),
          createEmptyResponsePageCache(analysis, 1, limit)
        )
      );
    }

    for (const limit of RESPONSE_ANALYSIS_DUPLICATE_PAGE_LIMITS) {
      writes.push(
        this.cacheService.set(
          getResponseAnalysisDuplicatePageCacheKey(cacheKey, 1, limit),
          createDuplicateValuePageCache(analysis, 1, limit)
        )
      );
    }

    for (const chunk of createEmptyResponseChunkCaches(analysis)) {
      writes.push(
        this.cacheService.set(
          getResponseAnalysisEmptyChunkCacheKey(cacheKey, chunk.chunkIndex),
          chunk
        )
      );
    }

    for (const chunk of createDuplicateValueChunkCaches(analysis)) {
      writes.push(
        this.cacheService.set(
          getResponseAnalysisDuplicateChunkCacheKey(cacheKey, chunk.chunkIndex),
          chunk
        )
      );
    }

    await Promise.all(writes);
  }

  private createJobResult(
    data: CodingAnalysisJobData,
    status: CodingAnalysisJobResult['status']
  ): CodingAnalysisJobResult {
    return {
      workspaceId: data.workspaceId,
      cacheKey: data.cacheKey,
      status,
      sourceRevision: data.sourceRevision,
      completedAt: new Date().toISOString()
    };
  }

  private logResponseAnalysisTiming(
    workspaceId: number,
    startedAt: number,
    status: string
  ): void {
    const durationMs = Date.now() - startedAt;
    const message = `Response analysis for workspace ${workspaceId} ${status} in ${durationMs}ms.`;
    if (durationMs >= this.slowResponseAnalysisThresholdMs) {
      this.logger.warn(message);
      return;
    }
    this.logger.log(message);
  }

  private async computeResponseAnalysis(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number,
    job?: Job<CodingAnalysisJobData>
  ): Promise<ResponseAnalysisDto> {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber(
      'INTENDED_INCOMPLETE'
    );
    const [
      exclusions,
      defaultMirCode,
      derivedVariableMap,
      sourceRevision,
      manualVariables
    ] = await Promise.all([
      this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId),
      this.getDefaultMirCode(workspaceId),
      this.getDerivedVariableMap(workspaceId),
      this.resolveSourceRevision(workspaceId, job?.data.sourceRevision),
      this.getManualAnalysisVariables(workspaceId)
    ]);

    if (manualVariables.length === 0) {
      this.logger.warn(
        `No manual coding variables found for analysis in workspace ${workspaceId}`
      );
      return this.createEmptyAnalysisResult(
        matchingFlags,
        threshold,
        sourceRevision
      );
    }

    this.logger.log(
      `Restricting response analysis for workspace ${workspaceId} to ${manualVariables.length} manual coding variables.`
    );

    // 1. Identify relevant UnitName+Variable combinations
    this.logger.log(
      `Identifying relevant variables for analysis in workspace ${workspaceId}...`
    );
    const relevantVariablesQuery = this.responseRepository
      .createQueryBuilder('response')
      .select(this.normalizedUnitNameExpression, 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [codingIncompleteStatus, intendedIncompleteStatus]
      });
    this.applyManualVariableFilter(
      relevantVariablesQuery,
      manualVariables,
      'relevantManualVariable'
    );
    applyResolvedExclusionsToQuery(relevantVariablesQuery, exclusions);
    const relevantVariables =
      await relevantVariablesQuery.getRawMany<ManualAnalysisVariable>();

    if (relevantVariables.length === 0) {
      this.logger.warn(
        `No relevant variables found for analysis in workspace ${workspaceId}`
      );
      return this.createEmptyAnalysisResult(
        matchingFlags,
        threshold,
        sourceRevision
      );
    }

    this.logger.log(
      `Found ${relevantVariables.length} variable groups to analyze. Processing in chunks...`
    );

    const emptyResponses: EmptyResponseDto[] = [];
    const duplicateValueGroups: DuplicateValueGroupDto[] = [];
    let totalProcessed = 0;

    // Check if aggregation is already applied (marked by code_v2 = -111)
    const aggregationAppliedQuery = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 });
    this.applyManualVariableFilter(
      aggregationAppliedQuery,
      manualVariables,
      'aggregationManualVariable'
    );
    applyResolvedExclusionsToQuery(aggregationAppliedQuery, exclusions);
    const isAggregationApplied = (await aggregationAppliedQuery.getCount()) > 0;

    // 2. Process in chunks
    const chunkSize = 25; // Number of unit-name variable groups per query
    for (let i = 0; i < relevantVariables.length; i += chunkSize) {
      const chunk = relevantVariables.slice(i, i + chunkSize);

      const qb = this.responseRepository
        .createQueryBuilder('response')
        .select('response.id', 'responseId')
        .addSelect('response.value', 'value')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.status_v2', 'statusV2')
        .addSelect('response.code_v2', 'codeV2')
        .addSelect('unit.name', 'unitName')
        .addSelect('unit.alias', 'unitAlias')
        .addSelect('person.login', 'personLogin')
        .addSelect('person.code', 'personCode')
        .addSelect('person.group', 'personGroup')
        .addSelect('bookletinfo.name', 'bookletName')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: [codingIncompleteStatus, intendedIncompleteStatus]
        })
        // Exclude already-aggregated responses (non-master duplicates) so they don't reappear after aggregation
        .andWhere(
          '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :emptyCode))',
          { aggregatedCode: -111, emptyCode: defaultMirCode }
        );
      applyResolvedExclusionsToQuery(qb, exclusions);

      qb.andWhere(
        new Brackets(qbInside => {
          chunk.forEach((item, index) => {
            const params = {
              [`unitName${index}`]: item.unitName,
              [`vid${index}`]: item.variableId
            };
            if (index === 0) {
              qbInside.where(
                `${this.normalizedUnitNameExpression} = :unitName${index} AND response.variableid = :vid${index}`,
                params
              );
            } else {
              qbInside.orWhere(
                `${this.normalizedUnitNameExpression} = :unitName${index} AND response.variableid = :vid${index}`,
                params
              );
            }
          });
        })
      );

      const responsesBatch = await qb.getRawMany<AnalysisResponseRow>();
      totalProcessed += responsesBatch.length;

      this.analyzeBatch(
        responsesBatch,
        matchingFlags,
        emptyResponses,
        duplicateValueGroups,
        derivedVariableMap
      );

      // Explicitly free memory if possible (though GC handles function scope)
      if (
        (i + chunkSize) % 500 === 0 ||
        i + chunkSize >= relevantVariables.length
      ) {
        const processed = Math.min(i + chunkSize, relevantVariables.length);
        const progress = Math.round(
          (processed / relevantVariables.length) * 100
        );
        if (job) {
          await job.progress(progress);
        }
        this.logger.log(
          `Processed ${processed}/${relevantVariables.length} variable groups...`
        );
        if (global.gc) {
          global.gc();
        }
      }
    }

    const mergedGroupsMap = new Map<string, DuplicateValueGroupDto>();
    for (const group of duplicateValueGroups) {
      const key = `${group.unitName}_${group.variableId}_${group.normalizedValue}`;
      if (mergedGroupsMap.has(key)) {
        // Merge occurrences into the existing group
        mergedGroupsMap.get(key)!.occurrences.push(...group.occurrences);
      } else {
        mergedGroupsMap.set(key, {
          ...group,
          occurrences: [...group.occurrences]
        });
      }
    }

    // Apply threshold filter on merged groups and build the final list
    const mergedGroups = Array.from(mergedGroupsMap.values()).filter(
      group => group.occurrences.length >= threshold
    );

    // Sort results
    emptyResponses.sort((a, b) => {
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
      return a.personLogin.localeCompare(b.personLogin);
    });

    mergedGroups.sort((a, b) => {
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      return a.variableId.localeCompare(b.variableId);
    });

    const totalDuplicateResponses = mergedGroups.reduce(
      (sum, group) => sum + group.occurrences.length,
      0
    );
    const aggregationSummary = createAggregationSummary(
      mergedGroups.length,
      totalDuplicateResponses,
      totalProcessed,
      threshold,
      matchingFlags
    );

    this.logger.log(
      `Analysis complete. Processed ${totalProcessed} responses. Found ${mergedGroups.length} duplicate groups.`
    );

    return {
      emptyResponses: {
        total: emptyResponses.length,
        totalUncoded: emptyResponses.filter(r => !r.isCoded).length,
        items: emptyResponses
      },
      duplicateValues: {
        total: mergedGroups.length,
        totalResponses: totalDuplicateResponses,
        groups: mergedGroups,
        isAggregationApplied
      },
      aggregationSummary,
      matchingFlags: matchingFlags as unknown as string[],
      analysisTimestamp: new Date().toISOString(),
      sourceRevision
    };
  }

  private analyzeBatch(
    responses: AnalysisResponseRow[],
    matchingFlags: ResponseMatchingFlag[],
    emptyResponses: EmptyResponseDto[],
    duplicateValueGroups: DuplicateValueGroupDto[],
    derivedVariableMap: Map<string, Set<string>>
  ) {
    // We group by Unit+Variable within this batch
    // Since our query chunked by Unit+Variable, we can treat this batch as a collection of complete groups

    // Group responses by unit+variable
    const responsesByUnitVariable = new Map<string, AnalysisResponseRow[]>();

    for (const response of responses) {
      // Empty Check - IMPROVED LOGIC
      const value = response.value;

      if (!isAggregatableValue(value)) {
        emptyResponses.push({
          unitName: response.unitName || '',
          unitAlias: response.unitAlias || null,
          variableId: response.variableId,
          personLogin: response.personLogin || '',
          personCode: response.personCode || '',
          personGroup: response.personGroup || '',
          bookletName: response.bookletName || 'Unknown',
          responseId: Number(response.responseId),
          value: response.value,
          isCoded:
            response.statusV2 !== null && response.statusV2 !== undefined,
          assignedCode:
            response.codeV2 === null || response.codeV2 === undefined ?
              null :
              Number(response.codeV2)
        });
        continue; // Skip empty for duplicates
      }

      if (
        isDerivedAggregationVariable(
          derivedVariableMap,
          response.unitName || '',
          response.variableId
        )
      ) {
        continue;
      }

      const key = `${response.unitName || ''}_${response.variableId}`;
      if (!responsesByUnitVariable.has(key)) {
        responsesByUnitVariable.set(key, []);
      }
      responsesByUnitVariable.get(key)!.push(response);
    }

    for (const [, groupResponses] of responsesByUnitVariable.entries()) {
      const valueGroups = new Map<string, AnalysisResponseRow[]>();
      for (const response of groupResponses) {
        const normalizedValue = normalizeAggregationValue(
          response.value,
          matchingFlags
        );
        if (!valueGroups.has(normalizedValue)) {
          valueGroups.set(normalizedValue, []);
        }
        valueGroups.get(normalizedValue)!.push(response);
      }

      for (const [normalizedValue, valGroup] of valueGroups.entries()) {
        const first = valGroup[0];
        duplicateValueGroups.push({
          unitName: first.unitName || '',
          unitAlias: first.unitAlias || null,
          variableId: first.variableId,
          normalizedValue,
          originalValue: first.value || '',
          occurrences: valGroup.map(r => ({
            personLogin: r.personLogin || 'Unknown',
            personCode: r.personCode || '',
            bookletName: r.bookletName || 'Unknown',
            responseId: Number(r.responseId),
            value: r.value || ''
          }))
        });
      }
    }
  }

  private createEmptyAnalysisResult(
    matchingFlags: ResponseMatchingFlag[],
    threshold: number | null = null,
    sourceRevision?: number
  ): ResponseAnalysisDto {
    const result: ResponseAnalysisDto = {
      emptyResponses: {
        total: 0,
        totalUncoded: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: createAggregationSummary(
        0,
        0,
        0,
        threshold,
        matchingFlags
      ),
      matchingFlags: matchingFlags as unknown as string[],
      analysisTimestamp: new Date().toISOString(),
      sourceRevision
    };

    return result;
  }

  private async getManualAnalysisVariables(
    workspaceId: number
  ): Promise<ManualAnalysisVariable[]> {
    const variables =
      await this.codingValidationService.getCodingIncompleteVariables(
        workspaceId
      );
    const uniqueVariables = new Map<string, ManualAnalysisVariable>();

    variables.forEach(variable => {
      const unitName = this.normalizeUnitName(variable.unitName);
      const variableId = String(variable.variableId || '').trim();
      if (!unitName || !variableId) {
        return;
      }
      uniqueVariables.set(`${unitName}::${variableId}`, {
        unitName,
        variableId
      });
    });

    return Array.from(uniqueVariables.values());
  }

  private normalizeUnitName(unitName: string | null | undefined): string {
    return String(unitName || '')
      .trim()
      .replace(/\.XML$/i, '')
      .toUpperCase();
  }

  private applyManualVariableFilter(
    query: SelectQueryBuilder<ResponseEntity>,
    variables: ManualAnalysisVariable[],
    parameterPrefix: string
  ): void {
    query.andWhere(
      new Brackets(qbInside => {
        variables.forEach((variable, index) => {
          const unitParam = `${parameterPrefix}Unit${index}`;
          const variableParam = `${parameterPrefix}Variable${index}`;
          const params = {
            [unitParam]: variable.unitName,
            [variableParam]: variable.variableId
          };
          const condition =
            `${this.normalizedUnitNameExpression} = :${unitParam} ` +
            `AND response.variableid = :${variableParam}`;

          if (index === 0) {
            qbInside.where(condition, params);
            return;
          }
          qbInside.orWhere(condition, params);
        });
      })
    );
  }

  private async resolveSourceRevision(
    workspaceId: number,
    plannedRevision?: number
  ): Promise<number> {
    if (plannedRevision !== undefined) {
      return plannedRevision;
    }

    try {
      const rows = (await this.responseRepository.query(
        'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
        [workspaceId]
      )) as Array<{ revision: number | string }>;
      return Number(rows[0]?.revision || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve test result revision for response analysis: ${message}`
      );
      return 0;
    }
  }

  private async getDerivedVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    try {
      return await this.workspaceFilesService.getDerivedVariableMap(
        workspaceId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not load derived variable map for workspace ${workspaceId}: ${message}`
      );
      return new Map<string, Set<string>>();
    }
  }
}
