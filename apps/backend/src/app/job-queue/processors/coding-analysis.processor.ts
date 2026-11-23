import { randomUUID } from 'node:crypto';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { ResponseEntity } from '../../database/entities/response.entity';
import { ResponseMatchingFlag } from '../../database/services/coding/coding-job.service';
import type { EmptyResponseDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES } from '../../database/utils/manual-coding-candidate.util';
import { CodingAnalysisJobData } from '../job-queue.service';
import {
  applyResolvedExclusionsToQuery,
  ResolvedWorkspaceExclusions,
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

import { readPostgresQueryBatches } from '../../database/services/shared/postgres-query-batches.util';
import { ANALYSIS_BATCH_SIZE, DuplicateCandidate, writeDuplicateResults } from './coding-analysis-duplicates';

type ResponseRow = {
  id: number;
  unitid: number;
  variableid: string;
  value: string | null;
  status_v1: number | null;
  status_v2: number | null;
  code_v2: string | null;
  unitName: string;
  unitAlias: string | null;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
};

const TARGET_STAGED_CANDIDATES = 5000;
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
    const candidateKey = `${listPrefix}:candidates`;
    const stagingKeys = [...Object.values(lists), candidateKey];
    // Renew staging keys even while the cursor or a variable takes longer to process.
    const renewStagingTtl = setInterval(() => {
      Promise.all(stagingKeys.map(key => this.cacheService.expire(key, LIST_WRITE_TTL_SECONDS))).catch(error => this.logger.warn(`Could not renew response analysis lists for job ${job.id}: ${getErrorMessage(error)}`));
    }, (LIST_WRITE_TTL_SECONDS / 2) * 1000).unref();
    let publicationAttempted = false;
    try {
      const analysis = await this.computeResponseAnalysis(
        workspaceId, matchingFlags as ResponseMatchingFlag[], threshold, listPrefix, job
      ).finally(() => clearInterval(renewStagingTtl));
      publicationAttempted = true;
      const published = await this.cacheService.publishListResult(cacheKey, analysis, {
        ttl: CODING_ANALYSIS_CACHE_TTL_SECONDS,
        listTtl: CODING_ANALYSIS_CACHE_TTL_SECONDS + 60,
        lists: [
          { key: lists.empty, length: analysis.emptyResponses.total },
          { key: lists.duplicates, length: analysis.duplicateValues.total },
          { key: lists.occurrences, length: analysis.duplicateValues.totalResponses }
        ],
        marker: job.data.runId ? { key: getCodingAnalysisRunMarkerKey(cacheKey), value: job.data.runId } : undefined
      });
      if (!published) {
        this.logger.log(`Discarding stale response analysis for workspace ${workspaceId} (job ${job.id})`);
        await Promise.all(stagingKeys.map(key => this.cacheService.delete(key)));
        return analysis.aggregationSummary;
      }
      await job.updateProgress(100);
      this.logger.log(`Response analysis for workspace ${workspaceId} completed and cached.`);
      return analysis.aggregationSummary;
    } catch (error) {
      // A lost Redis reply can leave the result published. Its lists then have their own expiry.
      if (!publicationAttempted) {
        await Promise.all(stagingKeys.map(key => this.cacheService.delete(key)));
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
    const { query, isAggregationApplied } = await this.createAnalysisQuery(workspaceId, exclusions, defaultMirCode);
    const totalCandidates = await query.getCount();

    const lists = getCodingAnalysisListKeys(listPrefix);
    const candidateKey = `${listPrefix}:candidates`;
    let totalEmpty = 0;
    let totalUncoded = 0;
    let totalDuplicateGroups = 0;
    let totalDuplicateResponses = 0;
    let totalProcessed = 0;
    let reportedProgress = 0;
    let candidateCount = 0;
    let previousVariable = '';
    let manager: EntityManager | undefined;

    const flushCandidates = async () => {
      const result = await writeDuplicateResults(
        this.cacheService, listPrefix, candidateKey, candidateCount, threshold, totalDuplicateResponses, LIST_WRITE_TTL_SECONDS
      );
      totalDuplicateGroups += result.groups;
      totalDuplicateResponses += result.occurrences;
      if (candidateCount && !await this.cacheService.delete(candidateKey)) {
        throw new Error('Could not clear response analysis candidates');
      }
      candidateCount = 0;
    };

    for await (const rows of readPostgresQueryBatches<ResponseRow>(
      query, ANALYSIS_BATCH_SIZE, async snapshotManager => { manager = snapshotManager; }
    )) {
      const emptyResponses = await this.emptyResponseSelectionService.filterEffectivelyEmptyResponses(
        rows.map(row => ({ ...row, unit: { name: row.unitName } })),
        emptyResponseContext,
        manager
      );
      await this.cacheService.appendListItems(lists.empty, emptyResponses.map(row => this.toEmptyResponse(row)), LIST_WRITE_TTL_SECONDS);
      totalEmpty += emptyResponses.length;
      totalUncoded += emptyResponses.filter(row => row.status_v2 === null).length;

      const emptyIds = new Set(emptyResponses.map(row => row.id));
      let candidates: DuplicateCandidate[] = [];
      for (const row of rows) {
        if (emptyIds.has(row.id) || !isAggregatableValue(row.value) ||
          isDerivedAggregationVariable(emptyResponseContext.derivedVariableMap, row.unitName, row.variableid)) continue;

        const variable = JSON.stringify([row.unitName, row.variableid]);
        // Keep the staging set small, while letting every value of a variable reach the same aggregation.
        if (variable !== previousVariable && candidateCount + candidates.length >= TARGET_STAGED_CANDIDATES) {
          await this.cacheService.appendSortedItems(candidateKey, candidates, LIST_WRITE_TTL_SECONDS);
          candidateCount += candidates.length;
          await flushCandidates();
          candidates = [];
        }
        previousVariable = variable;
        candidates.push([
          row.unitName, row.variableid, normalizeAggregationValue(row.value, matchingFlags),
          row.unitName ? null : row.unitid, row.unitAlias || null,
          {
            personLogin: row.personLogin || 'Unknown',
            personCode: row.personCode || '',
            bookletName: row.bookletName || 'Unknown',
            responseId: row.id,
            value: row.value || ''
          }
        ]);
      }
      await this.cacheService.appendSortedItems(candidateKey, candidates, LIST_WRITE_TTL_SECONDS);
      candidateCount += candidates.length;
      totalProcessed += rows.length;
      const progress = totalCandidates ? Math.min(98, Math.round((totalProcessed / totalCandidates) * 98)) : 0;
      if (progress > reportedProgress) {
        await job.updateProgress(progress);
        reportedProgress = progress;
      }
    }

    await flushCandidates();

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

  private async createAnalysisQuery(workspaceId: number, exclusions: ResolvedWorkspaceExclusions, defaultMirCode: number) {
    const scopedQuery = this.responseRepository.createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    applyResolvedExclusionsToQuery(scopedQuery, exclusions);

    const isAggregationApplied = await scopedQuery.clone()
      .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 })
      .getExists();
    const query = scopedQuery
      .andWhere('response.status_v1 IN (:...statuses)', { statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES })
      .andWhere(
        '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :emptyCode))',
        { aggregatedCode: -111, emptyCode: defaultMirCode }
      );
    query.select([
      'response.id AS id', 'response.unitid AS unitid', 'response.variableid AS variableid',
      'response.value AS value', 'response.status_v1 AS status_v1',
      'response.status_v2 AS status_v2', 'response.code_v2 AS code_v2',
      'unit.name AS "unitName"', 'unit.alias AS "unitAlias"', 'person.login AS "personLogin"',
      'person.code AS "personCode"', 'person.group AS "personGroup"', 'bookletinfo.name AS "bookletName"'
    ])
      .orderBy('unit.name COLLATE "C"', 'ASC')
      .addOrderBy('response.variableid COLLATE "C"', 'ASC')
      .addOrderBy('person.login', 'ASC')
      .addOrderBy('response.id', 'ASC');

    return { query, isAggregationApplied };
  }

  private toEmptyResponse(row: ResponseRow): EmptyResponseDto {
    return {
      unitName: row.unitName,
      unitAlias: row.unitAlias || null,
      variableId: row.variableid,
      personLogin: row.personLogin || '',
      personCode: row.personCode || '',
      personGroup: row.personGroup || '',
      bookletName: row.bookletName || 'Unknown',
      responseId: row.id,
      value: row.value,
      isCoded: row.status_v2 !== null,
      assignedCode: row.code_v2 === null ? undefined : Number(row.code_v2)
    };
  }
}
