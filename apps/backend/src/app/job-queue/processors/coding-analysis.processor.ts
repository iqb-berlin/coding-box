import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import {
  Logger, OnModuleDestroy, OnModuleInit, Optional
} from '@nestjs/common';
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
  isAggregatableResponse,
  isDerivedAggregationVariable,
  normalizeAggregationValue
} from '../../database/services/coding/aggregation-metrics.util';
import { EmptyResponseSelectionService } from '../../database/services/coding/empty-response-selection.service';
import { hasGeoGebraConstruction } from '../../database/services/coding/geogebra-response.util';
import { isUncodedV2Response } from '../../database/services/coding/response-v2-coding.util';
import {
  getCodingAnalysisRunMarkerKey, FileCodingAnalysis
} from '../../database/services/coding/coding-analysis-cache-key.util';
import {
  IQB_STANDARD_MISSING_CODES,
  MissingsProfilesService
} from '../../database/services/coding/missings-profiles.service';

import {
  ANALYSIS_RESULT_TTL_SECONDS, cleanExpiredCodingAnalysisResults, CodingAnalysisResultWriter
} from '../../database/services/coding/coding-analysis-result-store';
import { readPostgresQueryBatches } from '../../database/services/shared/postgres-query-batches.util';
import { ANALYSIS_BATCH_SIZE, DuplicateCandidate, writeDuplicateResults } from './coding-analysis-duplicates';

type ResponseRow = {
  id: number;
  unitid: number;
  variableid: string;
  subform: string | null;
  value: string | null;
  status: number;
  status_v1: number | null;
  status_v2: number | null;
  code_v2: string | null;
  score_v2: string | null;
  unitName: string;
  unitAlias: string | null;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
};

const CLEANUP_INTERVAL_MS = 5 * 60_000;

@Processor('response-analysis', { concurrency: 1 })
export class CodingAnalysisProcessor extends WorkspaceWorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CodingAnalysisProcessor.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;

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

  onModuleInit(): void {
    const clean = () => cleanExpiredCodingAnalysisResults().catch(error => {
      this.logger.warn(`Could not clean up response analysis files: ${getErrorMessage(error)}`);
    });
    clean();
    this.cleanupTimer = setInterval(clean, CLEANUP_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
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

    const writer = await CodingAnalysisResultWriter.create(workspaceId);
    const refreshLease = setInterval(() => {
      writer.refreshLease().catch(error => {
        this.logger.warn(`Could not renew response analysis file lease for job ${job.id}: ${getErrorMessage(error)}`);
      });
    }, CLEANUP_INTERVAL_MS).unref();

    let publicationAttempted = false;
    try {
      const analysis = await this.computeResponseAnalysis(
        workspaceId, matchingFlags as ResponseMatchingFlag[], threshold, writer, job
      );
      clearInterval(refreshLease);
      await writer.finish();

      publicationAttempted = true;
      const published = job.data.runId ?
        await this.cacheService.publishIfMarkerMatches(cacheKey, analysis, ANALYSIS_RESULT_TTL_SECONDS, {
          key: getCodingAnalysisRunMarkerKey(cacheKey), value: job.data.runId
        }) :
        await this.cacheService.set(cacheKey, analysis, ANALYSIS_RESULT_TTL_SECONDS);

      if (!published) {
        if (!job.data.runId) throw new Error('Could not publish response analysis');
        this.logger.log(`Discarding stale response analysis for workspace ${workspaceId} (job ${job.id})`);
        await writer.discard();
        return analysis.aggregationSummary;
      }
      await job.updateProgress(100);
      return analysis.aggregationSummary;
    } catch (error) {
      // A lost Redis reply can leave the pointer published. Keep the finished file until expiry.
      if (!publicationAttempted) {
        await writer.discard().catch(cause => this.logger.warn(getErrorMessage(cause)));
      }
      this.logger.error(`Response analysis failed: ${getErrorMessage(error)}`, getErrorStack(error));
      throw error;
    } finally {
      clearInterval(refreshLease);
    }
  }

  private async computeResponseAnalysis(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number,
    writer: CodingAnalysisResultWriter,
    job: Job<CodingAnalysisJobData>
  ): Promise<FileCodingAnalysis> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const defaultMirCode = await this.getDefaultMirCode(workspaceId);
    const emptyResponseContext =
      await this.emptyResponseSelectionService.createContext(workspaceId);
    const { query, isAggregationApplied } = await this.createAnalysisQuery(workspaceId, exclusions, defaultMirCode);
    const totalCandidates = await query.getCount();

    let totalEmpty = 0;
    let totalUncoded = 0;
    let totalProcessed = 0;
    let reportedProgress = 0;
    let manager: EntityManager | undefined;

    for await (const rows of readPostgresQueryBatches<ResponseRow>(
      query, ANALYSIS_BATCH_SIZE, async snapshotManager => { manager = snapshotManager; }
    )) {
      const emptyResponses = await this.emptyResponseSelectionService.filterEffectivelyEmptyResponses(
        rows.map(row => ({ ...row, unit: { name: row.unitName } })),
        emptyResponseContext,
        manager
      );
      await writer.appendItems('empty', emptyResponses.map(row => this.toEmptyResponse(row)));
      totalEmpty += emptyResponses.length;
      totalUncoded += emptyResponses.filter(isUncodedV2Response).length;

      const emptyIds = new Set(emptyResponses.map(row => row.id));
      const candidates: DuplicateCandidate[] = [];
      for (const row of rows) {
        if (emptyIds.has(row.id) || !isAggregatableResponse(row) ||
          isDerivedAggregationVariable(emptyResponseContext.derivedVariableMap, row.unitName, row.variableid)) continue;

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
      await writer.appendCandidates(candidates);
      totalProcessed += rows.length;
      const progress = totalCandidates ? Math.min(98, Math.round((totalProcessed / totalCandidates) * 98)) : 0;
      if (progress > reportedProgress) {
        await job.updateProgress(progress);
        reportedProgress = progress;
      }
    }

    const { groups, occurrences } = await writeDuplicateResults(writer, threshold);

    return {
      storage: 'file',
      resultId: writer.resultId,
      emptyResponses: { total: totalEmpty, totalUncoded },
      duplicateValues: {
        total: groups,
        totalResponses: occurrences,
        isAggregationApplied
      },
      aggregationSummary: createAggregationSummary(
        groups, occurrences, totalProcessed, threshold, matchingFlags
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
      'response.subform AS subform',
      'response.value AS value', 'response.status AS status', 'response.status_v1 AS status_v1',
      'response.status_v2 AS status_v2', 'response.code_v2 AS code_v2', 'response.score_v2 AS score_v2',
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
      value: hasGeoGebraConstruction(row.value) ? null : row.value,
      isCoded: !isUncodedV2Response(row),
      assignedCode: row.code_v2 === null ? undefined : Number(row.code_v2)
    };
  }
}
