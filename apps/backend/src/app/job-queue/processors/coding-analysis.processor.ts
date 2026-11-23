import { randomUUID } from 'node:crypto';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { ResponseEntity } from '../../database/entities/response.entity';
import { ResponseMatchingFlag } from '../../database/services/coding/coding-job.service';
import {
  EmptyResponseDto,
  DuplicateValueGroupDto
} from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES } from '../../database/utils/manual-coding-candidate.util';
import { CodingAnalysisJobData } from '../job-queue.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../../database/services/workspace/workspace-exclusion.service';
import {
  createAggregationSummary,
  isAggregatableValue,
  isDerivedAggregationVariable,
  normalizeAggregationValue
} from '../../database/services/coding/aggregation-metrics.util';
import { EmptyResponseSelectionService } from '../../database/services/coding/empty-response-selection.service';
import {
  getCodingAnalysisListKeys, getCodingAnalysisRunMarkerKey, PagedCodingAnalysis
} from '../../database/services/coding/coding-analysis-cache-key.util';
import {
  IQB_STANDARD_MISSING_CODES,
  MissingsProfilesService
} from '../../database/services/coding/missings-profiles.service';

const CODING_ANALYSIS_CACHE_TTL_SECONDS = 600;
const LIST_WRITE_TTL_SECONDS = 3600;

@Processor('response-analysis', { concurrency: 1 })
export class CodingAnalysisProcessor extends WorkspaceWorkerHost {
  private readonly logger = new Logger(CodingAnalysisProcessor.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private emptyResponseSelectionService: EmptyResponseSelectionService,
    @Optional()
    private missingsProfilesService?: MissingsProfilesService
  ) {
    super();
  }

  async processWorkspaceJob(job: Job<CodingAnalysisJobData>) {
    return this.handleResponseAnalysis(job);
  }

  @OnWorkerEvent('completed')
  async releaseCompletedRunMarker(job: Job<CodingAnalysisJobData>): Promise<void> {
    await this.releaseRunMarker(job);
  }

  @OnWorkerEvent('failed')
  async releaseFailedRunMarker(job: Job<CodingAnalysisJobData> | undefined): Promise<void> {
    await this.releaseRunMarker(job, true);
  }

  private async releaseRunMarker(job: Job<CodingAnalysisJobData> | undefined, verifyFailure = false): Promise<void> {
    if (!job?.data.runId) return;
    try {
      if (verifyFailure && await job.getState() !== 'failed') return;
      await this.cacheService.deleteIfMarkerMatches(getCodingAnalysisRunMarkerKey(job.data.cacheKey), job.data.runId);
    } catch (error) {
      this.logger.warn(`Could not release response analysis marker for job ${job.id}: ${getErrorMessage(error)}`);
    }
  }

  private async getDefaultMirCode(workspaceId: number): Promise<number> {
    if (!this.missingsProfilesService) {
      return IQB_STANDARD_MISSING_CODES.mir;
    }

    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      null,
      'mir'
    );
    return missing.code;
  }

  async handleResponseAnalysis(job: Job<CodingAnalysisJobData>) {
    const {
      workspaceId, matchingFlags, threshold, cacheKey
    } = job.data;
    this.logger.log(`Processing response analysis for workspace ${workspaceId}...`);

    const listPrefix = `${cacheKey}:results:${randomUUID()}`;
    const lists = getCodingAnalysisListKeys(listPrefix);
    let committed = false;
    try {
      const analysis = await this.computeResponseAnalysis(
        workspaceId, matchingFlags as ResponseMatchingFlag[], threshold, listPrefix, job
      );
      await Promise.all([
        this.cacheService.expire(lists.empty, CODING_ANALYSIS_CACHE_TTL_SECONDS + 60),
        this.cacheService.expire(lists.duplicates, CODING_ANALYSIS_CACHE_TTL_SECONDS + 60)
      ]);
      if (job.data.runId) {
        const published = await this.cacheService.setIfMarkerMatches(
          cacheKey, analysis, CODING_ANALYSIS_CACHE_TTL_SECONDS, getCodingAnalysisRunMarkerKey(cacheKey), job.data.runId
        );
        if (!published) {
          this.logger.log(`Discarding stale response analysis for workspace ${workspaceId} (job ${job.id})`);
          await Promise.all([this.cacheService.delete(lists.empty), this.cacheService.delete(lists.duplicates)]);
          return analysis.aggregationSummary;
        }
      } else if (!(await this.cacheService.set(cacheKey, analysis, CODING_ANALYSIS_CACHE_TTL_SECONDS))) {
        throw new Error('Could not publish response analysis result');
      }
      committed = true;
      await job.updateProgress(100);
      this.logger.log(`Response analysis for workspace ${workspaceId} completed and cached.`);
      return analysis.aggregationSummary;
    } catch (error) {
      if (!committed) {
        await Promise.all([this.cacheService.delete(lists.empty), this.cacheService.delete(lists.duplicates)]);
      }
      this.logger.error(`Response analysis failed: ${getErrorMessage(error)}`, getErrorStack(error));
      throw error;
    }
  }

  private async computeResponseAnalysis(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number,
    listPrefix: string,
    job: Job<CodingAnalysisJobData>
  ): Promise<PagedCodingAnalysis> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const defaultMirCode = await this.getDefaultMirCode(workspaceId);
    const emptyResponseContext =
      await this.emptyResponseSelectionService.createContext(workspaceId);
    const { derivedVariableMap } = emptyResponseContext;

    // A logical unit and variable must be processed together, including all test persons.
    this.logger.log(`Identifying relevant variables for analysis in workspace ${workspaceId}...`);
    const relevantVariablesQuery = this.responseRepository
      .createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
      });
    applyResolvedExclusionsToQuery(relevantVariablesQuery, exclusions);
    const relevantVariables = await relevantVariablesQuery
      .getRawMany<{ unitName: string; variableId: string }>();
    relevantVariables.sort((a, b) => (
      a.unitName.localeCompare(b.unitName) || a.variableId.localeCompare(b.variableId)
    ));

    this.logger.log(`Found ${relevantVariables.length} variable groups to analyze.`);

    const lists = getCodingAnalysisListKeys(listPrefix);
    let totalEmpty = 0;
    let totalUncoded = 0;
    let totalDuplicateGroups = 0;
    let totalDuplicateResponses = 0;
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
    applyResolvedExclusionsToQuery(aggregationAppliedQuery, exclusions);
    const isAggregationApplied = await aggregationAppliedQuery
      .getCount() > 0;

    // 2. Process in chunks
    const chunkSize = 5;
    for (let i = 0; i < relevantVariables.length; i += chunkSize) {
      const chunk = relevantVariables.slice(i, i + chunkSize);

      const qb = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('booklet.person', 'person')
        .select([
          'response.id', 'response.unitid', 'response.variableid', 'response.value',
          'response.status_v1', 'response.status_v2', 'response.code_v2',
          'unit.id', 'unit.name', 'unit.alias', 'booklet.id', 'bookletinfo.id', 'bookletinfo.name',
          'person.id', 'person.login', 'person.code', 'person.group'
        ])
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
        })
        // Exclude already-aggregated responses (non-master duplicates) so they don't reappear after aggregation
        .andWhere(
          '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :emptyCode))',
          { aggregatedCode: -111, emptyCode: defaultMirCode }
        );
      applyResolvedExclusionsToQuery(qb, exclusions);

      qb.andWhere(new Brackets(qbInside => {
        chunk.forEach((item, index) => {
          const params = { [`unit${index}`]: item.unitName, [`vid${index}`]: item.variableId };
          if (index === 0) {
            qbInside.where(`unit.name = :unit${index} AND response.variableid = :vid${index}`, params);
          } else {
            qbInside.orWhere(`unit.name = :unit${index} AND response.variableid = :vid${index}`, params);
          }
        });
      }));

      const responsesBatch = await qb.getMany();
      totalProcessed += responsesBatch.length;
      const effectivelyEmptyResponses =
        await this.emptyResponseSelectionService.filterEffectivelyEmptyResponses(
          responsesBatch,
          emptyResponseContext
        );

      const emptyResponses: EmptyResponseDto[] = [];
      const duplicateValueGroups: DuplicateValueGroupDto[] = [];
      this.analyzeBatch(
        responsesBatch,
        matchingFlags,
        emptyResponses,
        duplicateValueGroups,
        derivedVariableMap,
        new Set(effectivelyEmptyResponses.map(response => response.id))
      );

      const duplicateGroups = duplicateValueGroups.filter(group => group.occurrences.length >= threshold);
      emptyResponses.sort((a, b) => (
        a.unitName.localeCompare(b.unitName) ||
        a.variableId.localeCompare(b.variableId) ||
        a.personLogin.localeCompare(b.personLogin)
      ));
      duplicateGroups.sort((a, b) => (
        a.unitName.localeCompare(b.unitName) || a.variableId.localeCompare(b.variableId)
      ));

      await this.cacheService.appendListItems(lists.empty, emptyResponses, LIST_WRITE_TTL_SECONDS);
      await this.cacheService.appendListItems(lists.duplicates, duplicateGroups, LIST_WRITE_TTL_SECONDS);
      totalEmpty += emptyResponses.length;
      totalUncoded += emptyResponses.filter(response => !response.isCoded).length;
      totalDuplicateGroups += duplicateGroups.length;
      totalDuplicateResponses += duplicateGroups.reduce((count, group) => count + group.occurrences.length, 0);

      const processed = Math.min(i + chunkSize, relevantVariables.length);
      if (processed % 50 === 0 || processed === relevantVariables.length) {
        await job.updateProgress(Math.min(99, Math.round((processed / relevantVariables.length) * 100)));
      }
    }

    return {
      storage: 'paged',
      listPrefix,
      emptyResponses: { total: totalEmpty, totalUncoded },
      duplicateValues: {
        total: totalDuplicateGroups,
        totalResponses: totalDuplicateResponses,
        isAggregationApplied
      },
      aggregationSummary: createAggregationSummary(
        totalDuplicateGroups, totalDuplicateResponses, totalProcessed, threshold, matchingFlags
      ),
      matchingFlags,
      analysisTimestamp: new Date().toISOString()
    };
  }

  private analyzeBatch(
    responses: ResponseEntity[],
    matchingFlags: ResponseMatchingFlag[],
    emptyResponses: EmptyResponseDto[],
    duplicateValueGroups: DuplicateValueGroupDto[],
    derivedVariableMap: Map<string, Set<string>>,
    effectivelyEmptyResponseIds: Set<number>
  ) {
    // We group by Unit+Variable within this batch
    // Since our query chunked by Unit+Variable, we can treat this batch as a collection of complete groups

    // Group responses by unit+variable
    const responsesByUnitVariable = new Map<string, ResponseEntity[]>();

    for (const response of responses) {
      // Empty Check - IMPROVED LOGIC
      const value = response.value;

      if (effectivelyEmptyResponseIds.has(response.id)) {
        emptyResponses.push({
          unitName: response.unit?.name || '',
          unitAlias: response.unit?.alias || null,
          variableId: response.variableid,
          personLogin: response.unit?.booklet?.person?.login || '',
          personCode: response.unit?.booklet?.person?.code || '',
          personGroup: response.unit?.booklet?.person?.group || '',
          bookletName: response.unit?.booklet?.bookletinfo?.name || 'Unknown',
          responseId: response.id,
          value: response.value,
          isCoded: response.status_v2 !== null,
          assignedCode: response.code_v2 ?? undefined
        });
        continue;
      }

      if (!isAggregatableValue(value)) {
        continue; // Skip empty for duplicates
      }

      if (isDerivedAggregationVariable(
        derivedVariableMap,
        response.unit?.name || '',
        response.variableid
      )) {
        continue;
      }

      const key = JSON.stringify([response.unit?.name || response.unitid, response.variableid]);
      if (!responsesByUnitVariable.has(key)) {
        responsesByUnitVariable.set(key, []);
      }
      responsesByUnitVariable.get(key)!.push(response);
    }

    for (const [, groupResponses] of responsesByUnitVariable.entries()) {
      const valueGroups = new Map<string, ResponseEntity[]>();
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
          unitName: first.unit?.name || '',
          unitAlias: first.unit?.alias || null,
          variableId: first.variableid,
          normalizedValue,
          originalValue: first.value || '',
          occurrences: valGroup.map(r => ({
            personLogin: r.unit?.booklet?.person?.login || 'Unknown',
            personCode: r.unit?.booklet?.person?.code || '',
            bookletName: r.unit?.booklet?.bookletinfo?.name || 'Unknown',
            responseId: r.id,
            value: r.value || ''
          }))
        });
      }
    }
  }
}
