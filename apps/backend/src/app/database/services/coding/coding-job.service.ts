import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SaveCodingProgressDto } from '../../../admin/coding-job/dto/save-coding-progress.dto';
import { SaveCodingNotesDto } from '../../../admin/coding-job/dto/save-coding-notes.dto';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CreateCodingJobDto } from '../../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../../admin/coding-job/dto/update-coding-job.dto';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobFreshnessImpactDto, JobDefinitionRefreshPreviewDto } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { ReplayCodingSessionDto } from '../../../../../../../api-dto/coding/replay-coding-session.dto';
import {
  ResponseMatchingFlag, SelectableReviewCode, JobCreationWarning, TransferCodingCasesResult, VariableReference, BundleItem, DistributionCoderInput, DistributionDoubleCodingInfo, DistributionPlanRequest, DistributionVariableUsageRequest, DistributionVariableUsageBatchRequest, DistributionVariableUsageByStatus, DeriveErrorManualCodingRequest, CodingJobNavigationUnit, DistributedCodingJobsResult, DistributedCodingJobsTransactionHook, CodingJobIssueSummary, CodingJobListFilters, RefreshDistributedCodingJobsTransactionHook, JobDefinitionRefreshCodingJobsResult, SlimResponse, CodingJobAggregationSettings
} from './coding-job.types';
import { CodingJobMutationService } from './coding-job-mutation.service';
import { CodingJobResponsesService } from './coding-job-responses.service';
import { CodingJobAccessService } from './coding-job-access.service';
import { CodingJobQueryService } from './coding-job-query.service';
import { CodingJobDistributionService } from './coding-job-distribution.service';
import { CodingJobStatusService } from './coding-job-status.service';
import { CodingJobProgressService } from './coding-job-progress.service';
import { CodingJobSchemeService } from './coding-job-scheme.service';
import { CodingJobReplayService } from './coding-job-replay.service';
import { CodingJobAggregationService } from './coding-job-aggregation.service';

export * from './coding-job.types';

/** Public application facade; feature providers own persistence and policies. */
@Injectable()
export class CodingJobService {
  constructor(
    private readonly mutation: CodingJobMutationService,
    private readonly responses: CodingJobResponsesService,
    private readonly access: CodingJobAccessService,
    private readonly query: CodingJobQueryService,
    private readonly distribution: CodingJobDistributionService,
    private readonly status: CodingJobStatusService,
    private readonly progress: CodingJobProgressService,
    private readonly scheme: CodingJobSchemeService,
    private readonly replay: CodingJobReplayService,
    private readonly aggregation: CodingJobAggregationService
  ) {}

  async getIncludeDeriveErrorInManualCoding(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<boolean> { return this.access.getIncludeDeriveErrorInManualCoding(workspaceId, manager); }

  async assertDeriveErrorManualCodingEnabled(
    workspaceId: number,
    request: DeriveErrorManualCodingRequest,
    manager?: EntityManager
  ): Promise<void> { return this.access.assertDeriveErrorManualCodingEnabled(workspaceId, request, manager); }

  async assertUserCanAccessCodingJob(
    codingJobId: number,
    workspaceId: number,
    userId: number,
    managerAccessLevel = 2
  ): Promise<void> { return this.access.assertUserCanAccessCodingJob(codingJobId, workspaceId, userId, managerAccessLevel); }

  async assertUserCanCodeCodingJob(
    codingJobId: number,
    workspaceId: number,
    userId: number
  ): Promise<void> { return this.access.assertUserCanCodeCodingJob(codingJobId, workspaceId, userId); }

  async assertCodersCanCodeInWorkspace(
    userIds: number[],
    workspaceId: number
  ): Promise<void> { return this.access.assertCodersCanCodeInWorkspace(userIds, workspaceId); }

  async getResolvedCodingIssueReviewResponseIds(
    codingJobId: number
  ): Promise<number[]> { return this.query.getResolvedCodingIssueReviewResponseIds(codingJobId); }

  async getOpenCodingIssueReviewResponseIds(
    codingJobId: number
  ): Promise<number[]> { return this.query.getOpenCodingIssueReviewResponseIds(codingJobId); }

  async getCodingJobProgress(
    jobId: number,
    manager?: EntityManager
  ): Promise<{ progress: number; coded: number; total: number; open: number }> { return this.query.getCodingJobProgress(jobId, manager); }

  async getCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> { return this.query.getCodingJobCountsByDefinitionIds(workspaceId, definitionIds); }

  async getBlockingCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> { return this.query.getBlockingCodingJobCountsByDefinitionIds(workspaceId, definitionIds); }

  async getCodingJobFreshnessImpact(
    workspaceId: number,
    codingJobId: number
  ): Promise<CodingJobFreshnessImpactDto> { return this.query.getCodingJobFreshnessImpact(workspaceId, codingJobId); }

  async previewJobDefinitionRefresh(
    workspaceId: number,
    request: DistributionPlanRequest
  ): Promise<JobDefinitionRefreshPreviewDto> { return this.distribution.previewJobDefinitionRefresh(workspaceId, request); }

  async deleteCodingJobsByDefinition(
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<number> { return this.mutation.deleteCodingJobsByDefinition(workspaceId, jobDefinitionId); }

  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit?: number,
    assignedToUserId?: number,
    filters: CodingJobListFilters = {}
  ): Promise<{
      data: (CodingJob & {
        assignedCoders?: number[];
        assignedVariables?: { unitName: string; variableId: string }[];
        assignedVariableBundles?: {
          name: string;
          variables: { unitName: string; variableId: string }[];
        }[];
        progress?: number;
        codedUnits?: number;
        totalUnits?: number;
        openUnits?: number;
        hasIssues?: boolean;
        issueSummary?: CodingJobIssueSummary;
      })[];
      total: number;
      totalOpenUnits?: number;
      page: number;
      limit?: number;
    }> { return this.query.getCodingJobs(workspaceId, page, limit, assignedToUserId, filters); }

  async getCodingJob(
    id: number,
    workspaceId?: number
  ): Promise<{
      codingJob: CodingJob & { durationSeconds?: number };
      assignedCoders: number[];
      variables: { unitName: string; variableId: string }[];
      variableBundles: VariableBundle[];
    }> { return this.query.getCodingJob(id, workspaceId); }

  async createCodingJob(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJob> { return this.mutation.createCodingJob(workspaceId, createCodingJobDto); }

  async updateCodingJob(
    id: number,
    workspaceId: number,
    updateCodingJobDto: UpdateCodingJobDto
  ): Promise<CodingJob> { return this.mutation.updateCodingJob(id, workspaceId, updateCodingJobDto); }

  async updateCodingJobDisplayOptionsByDefinitionId(
    workspaceId: number,
    jobDefinitionId: number,
    options: {
      showScore?: boolean;
      allowComments?: boolean;
      suppressGeneralInstructions?: boolean;
    },
    manager?: EntityManager
  ): Promise<number> { return this.mutation.updateCodingJobDisplayOptionsByDefinitionId(workspaceId, jobDefinitionId, options, manager); }

  async pauseCodingJob(id: number, workspaceId: number): Promise<CodingJob> { return this.status.pauseCodingJob(id, workspaceId); }

  async resumeCodingJob(id: number, workspaceId: number): Promise<CodingJob> { return this.status.resumeCodingJob(id, workspaceId); }

  async submitCodingJob(id: number, workspaceId: number): Promise<CodingJob> { return this.status.submitCodingJob(id, workspaceId); }

  async markCodingJobResultsApplied(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> { return this.status.markCodingJobResultsApplied(id, workspaceId, manager); }

  async getCodingJobByIdForWorkspace(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> { return this.query.getCodingJobByIdForWorkspace(id, workspaceId, manager); }

  async deleteCodingJob(
    id: number,
    workspaceId: number
  ): Promise<{ success: boolean }> { return this.mutation.deleteCodingJob(id, workspaceId); }

  async assignCoders(
    codingJobId: number,
    userIds: number[],
    manager?: EntityManager,
    workspaceId?: number
  ): Promise<CodingJobCoder[]> { return this.mutation.assignCoders(codingJobId, userIds, manager, workspaceId); }

  async transferCodingCases(
    workspaceId: number,
    sourceCoderId: number,
    targetCoderId: number
  ): Promise<TransferCodingCasesResult> { return this.mutation.transferCodingCases(workspaceId, sourceCoderId, targetCoderId); }

  async getCodingJobsByCoder(coderId: number): Promise<CodingJob[]> { return this.query.getCodingJobsByCoder(coderId); }

  async getCodersByJobId(jobId: number): Promise<number[]> { return this.query.getCodersByJobId(jobId); }

  async getCodingJobById(id: number): Promise<
  CodingJob & {
    assignedCoders?: number[];
    assignedVariables?: { unitName: string; variableId: string }[];
    assignedVariableBundles?: {
      name: string;
      variables: { unitName: string; variableId: string }[];
    }[];
    variables?: { unitName: string; variableId: string }[];
    variableBundles?: {
      name: string;
      variables: { unitName: string; variableId: string }[];
    }[];
  }
  > { return this.query.getCodingJobById(id); }

  async getResponsesForCodingJob(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<ResponseEntity[]> { return this.responses.getResponsesForCodingJob(codingJobId, manager); }

  async saveCodingProgress(
    codingJobId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> { return this.progress.saveCodingProgress(codingJobId, progress); }

  async saveCodingIssueReviewProgress(
    sourceCodingJobId: number,
    reviewerUserId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> { return this.progress.saveCodingIssueReviewProgress(sourceCodingJobId, reviewerUserId, progress); }

  async getCodingSchemeScoreForUnitCode(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number
  ): Promise<number | null> { return this.scheme.getCodingSchemeScoreForUnitCode(codingJobUnit, workspaceId, codeId); }

  async getSelectableReviewCodeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number,
    manager?: EntityManager
  ): Promise<SelectableReviewCode> { return this.scheme.getSelectableReviewCodeForUnit(codingJobUnit, workspaceId, codeId, manager); }

  async getSelectableReviewCodesForUnits(
    codingJobUnits: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<CodingJobUnit, SelectableReviewCode[]>> { return this.scheme.getSelectableReviewCodesForUnits(codingJobUnits, workspaceId); }

  async saveCodingNotes(
    codingJobId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> { return this.progress.saveCodingNotes(codingJobId, notesDto); }

  async saveCodingIssueReviewNotes(
    sourceCodingJobId: number,
    reviewerUserId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> { return this.progress.saveCodingIssueReviewNotes(sourceCodingJobId, reviewerUserId, notesDto); }

  async getCodingProgress(
    codingJobId: number
  ): Promise<Record<string, SaveCodingProgressDto['selectedCode']>> { return this.replay.getCodingProgress(codingJobId); }

  async getCodingNotes(codingJobId: number): Promise<Record<string, string>> { return this.replay.getCodingNotes(codingJobId); }

  async getCodingJobUnits(
    codingJobId: number,
    onlyOpen: boolean = false
  ): Promise<CodingJobNavigationUnit[]> { return this.replay.getCodingJobUnits(codingJobId, onlyOpen); }

  async getCodingJobReplaySession(
    codingJobId: number,
    workspaceId: number,
    onlyOpen: boolean = false
  ): Promise<ReplayCodingSessionDto> { return this.replay.getCodingJobReplaySession(codingJobId, workspaceId, onlyOpen); }

  async restartCodingJobWithOpenUnits(
    codingJobId: number,
    workspaceId: number
  ): Promise<CodingJob> { return this.status.restartCodingJobWithOpenUnits(codingJobId, workspaceId); }

  async createCodingJobWithUnitSubset(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto,
    unitSubset: SlimResponse[]
  ): Promise<CodingJob> { return this.mutation.createCodingJobWithUnitSubset(workspaceId, createCodingJobDto, unitSubset); }

  async getCurrentAggregationSettingsSnapshot(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJobAggregationSettings> { return this.aggregation.getCurrentAggregationSettingsSnapshot(workspaceId, manager); }

  async getAggregationSettingsForCodingJob(
    codingJob: CodingJob,
    manager?: EntityManager
  ): Promise<CodingJobAggregationSettings> { return this.aggregation.getAggregationSettingsForCodingJob(codingJob, manager); }

  async getDerivedVariableMapForAggregation(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> { return this.aggregation.getDerivedVariableMapForAggregation(workspaceId, manager); }

  async getResponseMatchingMode(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<ResponseMatchingFlag[]> { return this.aggregation.getResponseMatchingMode(workspaceId, manager); }

  async setResponseMatchingMode(
    workspaceId: number,
    flags: ResponseMatchingFlag[],
    manager?: EntityManager
  ): Promise<ResponseMatchingFlag[]> { return this.aggregation.setResponseMatchingMode(workspaceId, flags, manager); }

  normalizeResponseMatchingFlags(
    flags: ResponseMatchingFlag[] | undefined | null
  ): ResponseMatchingFlag[] { return this.aggregation.normalizeResponseMatchingFlags(flags); }

  normalizeValue(value: string | null, flags: ResponseMatchingFlag[]): string { return this.aggregation.normalizeValue(value, flags); }

  aggregateResponsesByValue(
    responses: SlimResponse[],
    flags: ResponseMatchingFlag[]
  ): {
      normalizedValue: string;
      responses: SlimResponse[];
      totalResponses: number;
    }[] { return this.aggregation.aggregateResponsesByValue(responses, flags); }

  async getResponsesForVariables(
    workspaceId: number,
    variables: VariableReference[]
  ): Promise<ResponseEntity[]> { return this.responses.getResponsesForVariables(workspaceId, variables); }

  async getSlimResponsesForVariables(
    workspaceId: number,
    variables: VariableReference[],
    manager?: EntityManager
  ): Promise<SlimResponse[]> { return this.responses.getSlimResponsesForVariables(workspaceId, variables, manager); }

  async getSlimResponsesForVariableCoverage(
    workspaceId: number,
    variables: VariableReference[],
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    derivedVariableMap: Map<string, Set<string>>,
    manager?: EntityManager
  ): Promise<SlimResponse[]> { return this.responses.getSlimResponsesForVariableCoverage(workspaceId, variables, matchingFlags, aggregationThreshold, derivedVariableMap, manager); }

  async calculateDistributionVariableUsage(
    workspaceId: number,
    request: DistributionVariableUsageRequest
  ): Promise<Map<string, number>> { return this.distribution.calculateDistributionVariableUsage(workspaceId, request); }

  async calculateDistributionVariableUsageBatch(
    workspaceId: number,
    requests: DistributionVariableUsageBatchRequest[]
  ): Promise<Map<string | number, Map<string, number>>> { return this.distribution.calculateDistributionVariableUsageBatch(workspaceId, requests); }

  async calculateDistributionVariableUsageByStatusBatch(
    workspaceId: number,
    requests: DistributionVariableUsageBatchRequest[]
  ): Promise<Map<string | number, Map<string, DistributionVariableUsageByStatus>>> { return this.distribution.calculateDistributionVariableUsageByStatusBatch(workspaceId, requests); }

  async calculateDistribution(
    workspaceId: number,
    request: {
      selectedVariables: VariableReference[];
      selectedVariableBundles?: BundleItem[];
      selectedCoders: DistributionCoderInput[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number | null;
      distributionSeed?: string | number;
    }
  ): Promise<{
      distribution: Record<string, Record<string, number>>;
      distributionByCoderId: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
      aggregationInfo: Record<
      string,
      { uniqueCases: number; totalResponses: number }
      >;
      matchingFlags: ResponseMatchingFlag[];
      warnings: JobCreationWarning[];
      pairDistribution: Record<string, number>;
      tasksPerCoder: Record<string, number>;
      coderWeights: Record<string, number>;
    }> { return this.distribution.calculateDistribution(workspaceId, request); }

  async refreshDistributedCodingJobs(
    workspaceId: number,
    request: DistributionPlanRequest,
    afterRefreshInTransaction?: RefreshDistributedCodingJobsTransactionHook
  ): Promise<JobDefinitionRefreshCodingJobsResult> { return this.distribution.refreshDistributedCodingJobs(workspaceId, request, afterRefreshInTransaction); }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: DistributionPlanRequest,
    afterCreateInTransaction?: DistributedCodingJobsTransactionHook
  ): Promise<DistributedCodingJobsResult> { return this.distribution.createDistributedCodingJobs(workspaceId, request, afterCreateInTransaction); }

  async hasCodingIssues(codingJobId: number): Promise<boolean> { return this.query.hasCodingIssues(codingJobId); }

  async getBulkCodingProgress(
    codingJobIds: number[],
    workspaceId: number
  ): Promise<
    Record<number, Record<string, SaveCodingProgressDto['selectedCode']>>
    > { return this.replay.getBulkCodingProgress(codingJobIds, workspaceId); }

  async getAggregationThreshold(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<number | null> { return this.aggregation.getAggregationThreshold(workspaceId, manager); }

  async setAggregationThreshold(
    workspaceId: number,
    threshold: number | null,
    manager?: EntityManager
  ): Promise<void> { return this.aggregation.setAggregationThreshold(workspaceId, threshold, manager); }
}
