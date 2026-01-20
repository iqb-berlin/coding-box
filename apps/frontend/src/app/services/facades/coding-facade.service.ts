import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CodingJob,
  VariableBundle
} from '../../coding/models/coding-job.model';
import { CodingService } from '../coding.service';
import { CodingJobBackendService, CodingExportConfig, JobDefinition } from '../coding-job-backend.service';
import { ReplayBackendService, ReplayStatisticsResponse } from '../replay-backend.service';
import {
  CodingTrainingBackendService,
  CreateCoderTrainingJobsResponse,
  TrainingCodingResult,
  WithinTrainingCodingResult,
  CodingJobForTraining
} from '../coding-training-backend.service';
import { VariableAnalysisService, VariableAnalysisResultDto, JobCancelResult } from '../variable-analysis.service';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { VariableAnalysisJobDto } from '../../models/variable-analysis-job.dto';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';
import { ResponseEntity } from '../../shared/models/response-entity.model';
import { CoderTraining } from '../../coding/models/coder-training.model';
import { CodeBookContentSetting } from '../../../../../../api-dto/coding/codebook-content-setting';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CodingJobItem {
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
}

export interface CodingJobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: number;
  result?: {
    totalResponses: number;
    statusCounts: Record<string, number>;
  };
  error?: string;
}

export interface BulkApplyResultItem {
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
}

export interface BulkApplyCodingResultsResponse {
  success: boolean;
  jobsProcessed: number;
  totalUpdatedResponses: number;
  totalSkippedReview: number;
  message: string;
  results: BulkApplyResultItem[];
}

export interface ExportJobStatus {
  status: string;
  progress: number;
  result?: {
    fileId: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    workspaceId: number;
    userId: number;
    exportType: string;
    createdAt: number;
  };
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodingFacadeService {
  private codingService = inject(CodingService);
  private codingJobBackendService = inject(CodingJobBackendService);
  private replayBackendService = inject(ReplayBackendService);
  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private variableAnalysisService = inject(VariableAnalysisService);

  getCodingJobStatus(workspaceId: number, jobId: string): Observable<CodingJobStatus> {
    return this.codingService.getCodingJobStatus(workspaceId, jobId);
  }

  getCodingListAsCsv(workspaceId: number): Observable<Blob> {
    return this.codingService.getCodingListAsCsv(workspaceId);
  }

  getCodingListAsExcel(workspaceId: number): Observable<Blob> {
    return this.codingService.getCodingListAsExcel(workspaceId);
  }

  getCodingResultsByVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    return this.codingService.getCodingResultsByVersion(workspaceId, version, includeReplayUrls);
  }

  getCodingResultsByVersionAsExcel(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    return this.codingService.getCodingResultsByVersionAsExcel(workspaceId, version, includeReplayUrls);
  }

  getCodingStatistics(workspaceId: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Observable<CodingStatistics> {
    return this.codingService.getCodingStatistics(workspaceId, version);
  }

  createCodingStatisticsJob(workspaceId: number): Observable<{ jobId: string; message: string }> {
    return this.codingService.createCodingStatisticsJob(workspaceId);
  }

  getResponsesByStatus(workspaceId: number, status: string, version: 'v1' | 'v2' | 'v3' = 'v1', page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    return this.codingService.getResponsesByStatus(workspaceId, status, version, page, limit);
  }

  getReplayUrl(workspaceId: number, responseId: number, authToken: string): Observable<{ replayUrl: string }> {
    return this.codingService.getReplayUrl(workspaceId, responseId, authToken);
  }

  getVariableBundles(workspaceId: number): Observable<VariableBundle[]> {
    return this.codingJobBackendService.getVariableBundles(workspaceId);
  }

  getCodingJobs(workspaceId: number, page?: number, limit?: number): Observable<PaginatedResponse<CodingJob>> {
    return this.codingJobBackendService.getCodingJobs(workspaceId, page, limit);
  }

  getCodingJob(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    return this.codingJobBackendService.getCodingJob(workspaceId, codingJobId);
  }

  createCodingJob(workspaceId: number, codingJob: Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>): Observable<CodingJob> {
    return this.codingJobBackendService.createCodingJob(workspaceId, codingJob);
  }

  updateCodingJob(workspaceId: number, codingJobId: number, codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>): Observable<CodingJob> {
    return this.codingJobBackendService.updateCodingJob(workspaceId, codingJobId, codingJob);
  }

  deleteCodingJob(workspaceId: number, codingJobId: number): Observable<{ success: boolean }> {
    return this.codingJobBackendService.deleteCodingJob(workspaceId, codingJobId);
  }

  startCodingJob(workspaceId: number, codingJobId: number): Observable<{ total: number; items: CodingJobItem[] }> {
    return this.codingJobBackendService.startCodingJob(workspaceId, codingJobId);
  }

  getAppliedResultsCount(workspaceId: number, incompleteVariables: { unitName: string; variableId: string }[]): Observable<number> {
    return this.codingJobBackendService.getAppliedResultsCount(workspaceId, incompleteVariables);
  }

  getCodingIncompleteVariables(workspaceId: number, unitName?: string): Observable<{ unitName: string; variableId: string; responseCount: number }[]> {
    return this.codingJobBackendService.getCodingIncompleteVariables(workspaceId, unitName);
  }

  createCoderTrainingJobs(workspaceId: number, selectedCoders: { id: number; name: string }[], variableConfigs: { variableId: string; unitId: string; sampleCount: number }[], trainingLabel: string, missingsProfileId?: number): Observable<CreateCoderTrainingJobsResponse> {
    return this.codingTrainingBackendService.createCoderTrainingJobs(workspaceId, selectedCoders, variableConfigs, trainingLabel, missingsProfileId);
  }

  getCoderTrainings(workspaceId: number): Observable<CoderTraining[]> {
    return this.codingTrainingBackendService.getCoderTrainings(workspaceId);
  }

  updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string): Observable<{ success: boolean; message: string }> {
    return this.codingTrainingBackendService.updateCoderTrainingLabel(workspaceId, trainingId, newLabel);
  }

  deleteCoderTraining(workspaceId: number, trainingId: number): Observable<{ success: boolean; message: string }> {
    return this.codingTrainingBackendService.deleteCoderTraining(workspaceId, trainingId);
  }

  compareTrainingCodingResults(workspaceId: number, trainingIds: string): Observable<TrainingCodingResult[]> {
    return this.codingTrainingBackendService.compareTrainingCodingResults(workspaceId, trainingIds);
  }

  compareWithinTrainingCodingResults(workspaceId: number, trainingId: number): Observable<WithinTrainingCodingResult[]> {
    return this.codingTrainingBackendService.compareWithinTrainingCodingResults(workspaceId, trainingId);
  }

  getCodingJobsForTraining(workspaceId: number, trainingId: number): Observable<CodingJobForTraining[]> {
    return this.codingTrainingBackendService.getCodingJobsForTraining(workspaceId, trainingId);
  }

  saveCodingProgress(workspaceId: number, codingJobId: number, progressData: { testPerson: string; unitId: string; variableId: string; selectedCode: { id: number; code: string; label: string; [key: string]: unknown }; isOpen?: boolean; notes?: string }): Observable<CodingJob> {
    return this.codingJobBackendService.saveCodingProgress(workspaceId, codingJobId, progressData);
  }

  restartCodingJobWithOpenUnits(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    return this.codingJobBackendService.restartCodingJobWithOpenUnits(workspaceId, codingJobId);
  }

  getCodingProgress(workspaceId: number, codingJobId: number): Observable<Record<string, unknown>> {
    return this.codingJobBackendService.getCodingProgress(workspaceId, codingJobId);
  }

  getBulkCodingProgress(workspaceId: number, jobIds: number[]): Observable<Record<number, Record<string, unknown>>> {
    return this.codingJobBackendService.getBulkCodingProgress(workspaceId, jobIds);
  }

  getCodingNotes(workspaceId: number, codingJobId: number): Observable<Record<string, string> | null> {
    return this.codingJobBackendService.getCodingNotes(workspaceId, codingJobId);
  }

  getCodingJobUnits(workspaceId: number, codingJobId: number): Observable<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }>> {
    return this.codingJobBackendService.getCodingJobUnits(workspaceId, codingJobId);
  }

  applyCodingResults(workspaceId: number, codingJobId: number): Observable<{ success: boolean; updatedResponsesCount: number; skippedReviewCount: number; messageKey: string; messageParams?: Record<string, unknown> }> {
    return this.codingJobBackendService.applyCodingResults(workspaceId, codingJobId);
  }

  bulkApplyCodingResults(workspaceId: number): Observable<BulkApplyCodingResultsResponse> {
    return this.codingJobBackendService.bulkApplyCodingResults(workspaceId);
  }

  createJobDefinition(workspaceId: number, jobDefinition: JobDefinition): Observable<JobDefinition> {
    return this.codingJobBackendService.createJobDefinition(workspaceId, jobDefinition);
  }

  updateJobDefinition(workspaceId: number, jobDefinitionId: number, jobDefinition: Partial<JobDefinition>): Observable<JobDefinition> {
    return this.codingJobBackendService.updateJobDefinition(workspaceId, jobDefinitionId, jobDefinition);
  }

  approveJobDefinition(workspaceId: number, jobDefinitionId: number, status: 'pending_review' | 'approved'): Observable<JobDefinition> {
    return this.codingJobBackendService.approveJobDefinition(workspaceId, jobDefinitionId, status);
  }

  getJobDefinitions(workspaceId: number): Observable<JobDefinition[]> {
    return this.codingJobBackendService.getJobDefinitions(workspaceId);
  }

  deleteJobDefinition(workspaceId: number, jobDefinitionId: number): Observable<{ success: boolean; message: string }> {
    return this.codingJobBackendService.deleteJobDefinition(workspaceId, jobDefinitionId);
  }

  startExportJob(workspaceId: number, exportConfig: CodingExportConfig): Observable<{ jobId: string; message: string }> {
    return this.codingJobBackendService.startExportJob(workspaceId, exportConfig);
  }

  getExportJobStatus(workspaceId: number, jobId: string): Observable<ExportJobStatus> {
    return this.codingJobBackendService.getExportJobStatus(workspaceId, jobId);
  }

  downloadExportFile(workspaceId: number, jobId: string): Observable<Blob> {
    return this.codingJobBackendService.downloadExportFile(workspaceId, jobId);
  }

  cancelExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.codingJobBackendService.cancelExportJob(workspaceId, jobId);
  }

  getMissingsProfiles(workspaceId: number): Observable<{ label: string; id: number }[]> {
    return this.codingService.getMissingsProfiles(workspaceId);
  }

  getMissingsProfileDetails(workspaceId: number, id: string | number): Observable<MissingsProfilesDto | null> {
    return this.codingService.getMissingsProfileDetails(workspaceId, id);
  }

  createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.codingService.createMissingsProfile(workspaceId, profile);
  }

  updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.codingService.updateMissingsProfile(workspaceId, label, profile);
  }

  deleteMissingsProfile(workspaceId: number, label: string): Observable<boolean> {
    return this.codingService.deleteMissingsProfile(workspaceId, label);
  }

  getCodingBook(workspaceId: number, missingsProfile: string, contentOptions: CodeBookContentSetting, unitList: number[]): Observable<Blob | null> {
    return this.codingService.getCodingBook(workspaceId, missingsProfile, contentOptions, unitList);
  }

  storeReplayStatistics(workspaceId: number, data: { unitId: string; bookletId?: string; testPersonLogin?: string; testPersonCode?: string; durationMilliseconds: number; replayUrl?: string; success?: boolean; errorMessage?: string }): Observable<ReplayStatisticsResponse> {
    return this.replayBackendService.storeReplayStatistics(workspaceId, data);
  }

  getReplayFrequencyByUnit(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getReplayFrequencyByUnit(workspaceId, options);
  }

  getReplayDurationStatistics(workspaceId: number, unitId?: string, options?: Record<string, unknown>): Observable<{ min: number; max: number; average: number; distribution: Record<string, number>; unitAverages?: Record<string, number>; }> {
    return this.replayBackendService.getReplayDurationStatistics(workspaceId, unitId, options);
  }

  getReplayDistributionByDay(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getReplayDistributionByDay(workspaceId, options);
  }

  getReplayDistributionByHour(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getReplayDistributionByHour(workspaceId, options);
  }

  getReplayErrorStatistics(workspaceId: number, options?: Record<string, unknown>): Observable<{ successRate: number; totalReplays: number; successfulReplays: number; failedReplays: number; commonErrors: Array<{ message: string; count: number }>; }> {
    return this.replayBackendService.getReplayErrorStatistics(workspaceId, options);
  }

  getFailureDistributionByUnit(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getFailureDistributionByUnit(workspaceId, options);
  }

  getFailureDistributionByDay(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getFailureDistributionByDay(workspaceId, options);
  }

  getFailureDistributionByHour(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getFailureDistributionByHour(workspaceId, options);
  }

  getVariableAnalysis(workspaceId: number, page: number = 1, limit: number = 100, unitId?: string, variableId?: string, derivation?: string): Observable<PaginatedResponse<VariableAnalysisItemDto>> {
    return this.codingService.getVariableAnalysis(workspaceId, page, limit, unitId, variableId, derivation);
  }

  createDistributedCodingJobs(workspaceId: number, selectedVariables: { unitName: string; variableId: string }[], selectedCoders: { id: number; name: string; username: string }[], doubleCodingAbsolute?: number, doubleCodingPercentage?: number, selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[], caseOrderingMode?: 'continuous' | 'alternating', maxCodingCases?: number): Observable<{ success: boolean; jobsCreated: number; message: string; distribution: Record<string, Record<string, number>>; doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>; aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>; matchingFlags: string[]; jobs: { coderId: number; coderName: string; variable: { unitName: string; variableId: string }; jobId: number; jobName: string; caseCount: number; }[]; }> {
    return this.codingService.createDistributedCodingJobs(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles, caseOrderingMode, maxCodingCases);
  }

  calculateDistribution(workspaceId: number, selectedVariables: { unitName: string; variableId: string }[], selectedCoders: { id: number; name: string; username: string }[], doubleCodingAbsolute?: number, doubleCodingPercentage?: number, selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[], maxCodingCases?: number): Observable<{
    distribution: Record<string, Record<string, number>>;
    doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
    aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
    matchingFlags: string[];
    warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
  }> {
    return this.codingService.calculateDistribution(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles, maxCodingCases);
  }

  resetCodingVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', unitFilters?: string[], variableFilters?: string[]): Observable<{ affectedResponseCount: number; cascadeResetVersions: ('v2' | 'v3')[]; message: string }> {
    return this.codingService.resetCodingVersion(workspaceId, version, unitFilters, variableFilters);
  }

  deleteVariableAnalysisJob(workspaceId: number, jobId: number): Observable<JobCancelResult> {
    return this.variableAnalysisService.deleteJob(workspaceId, jobId);
  }

  cancelVariableAnalysisJob(workspaceId: number, jobId: number): Observable<JobCancelResult> {
    return this.variableAnalysisService.cancelJob(workspaceId, jobId);
  }

  getAllVariableAnalysisJobs(workspaceId: number): Observable<VariableAnalysisJobDto[]> {
    return this.variableAnalysisService.getAllJobs(workspaceId);
  }

  createVariableAnalysisJob(workspaceId: number, unitId?: number, variableId?: string): Observable<VariableAnalysisJobDto> {
    return this.variableAnalysisService.createAnalysisJob(workspaceId, unitId, variableId);
  }

  getVariableAnalysisResults(workspaceId: number, jobId: number): Observable<VariableAnalysisResultDto> {
    return this.variableAnalysisService.getAnalysisResults(workspaceId, jobId);
  }
}
