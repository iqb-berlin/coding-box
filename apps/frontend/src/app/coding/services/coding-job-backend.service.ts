import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { SERVER_URL } from '../../injection-tokens';
import { ValidationTaskStateService } from '../../shared/services/validation/validation-task-state.service';
import type { DistributedCodingJobsResponse } from './distributed-coding.service';
import type {
  CodingJobFreshnessImpactDto,
  JobDefinitionRefreshApplyResultDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../api-dto/coding/job-refresh.dto';
import {
  CodingJob,
  JobDefinitionCoderConfig,
  Variable,
  VariableBundle
} from '../models/coding-job.model';

export interface CodingExportConfig {
  exportType:
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'detailed'
  | 'coding-times'
  | 'results-by-version';
  userId: number;
  version?: 'v1' | 'v2' | 'v3';
  format?: 'csv' | 'excel';
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
  includeResponseValues?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  doubleCodingMethod?:
  | 'new-row-per-variable'
  | 'new-column-per-coder'
  | 'most-frequent';
  includeComments?: boolean;
  includeModalValue?: boolean;
  includeDoubleCoded?: boolean;
  excludeAutoCoded?: boolean;
  trainingRequired?: boolean;
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
  authToken?: string;
  serverUrl?: string;
}

interface JobDefinitionApiResponse {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assigned_variables?: import('../models/coding-job.model').Variable[];
  assigned_variable_bundles?: import('../models/coding-job.model').VariableBundle[];
  assigned_coders?: number[];
  assigned_coder_configs?: JobDefinitionCoderConfig[];
  assignedCoderConfigs?: JobDefinitionCoderConfig[];
  distribution_seed?: string;
  distributionSeed?: string;
  planned_variable_usage?: Record<string, number>;
  plannedVariableUsage?: Record<string, number>;
  duration_seconds?: number;
  max_coding_cases?: number;
  double_coding_absolute?: number;
  double_coding_percentage?: number;
  case_ordering_mode?: 'continuous' | 'alternating';
  show_score?: boolean;
  allow_comments?: boolean;
  suppress_general_instructions?: boolean;
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  createdJobsCount?: number;
  created_jobs_count?: number;
  blockingCreatedJobsCount?: number;
  blocking_created_jobs_count?: number;
  openCreatedJobsCount?: number;
  open_created_jobs_count?: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: import('../models/coding-job.model').Variable[];
  assignedVariableBundles?: import('../models/coding-job.model').VariableBundle[];
  assignedCoders?: number[];
  assignedCoderConfigs?: JobDefinitionCoderConfig[];
  distributionSeed?: string;
  plannedVariableUsage?: Record<string, number>;
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  createdJobsCount?: number;
  blockingCreatedJobsCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TransferCodingCasesResponse {
  sourceCoderId: number;
  targetCoderId: number;
  affectedJobs: number;
  updatedAssignments: number;
  removedDuplicateAssignments: number;
  transferredCases: number;
}

export interface ApplyCodingResultsOptions {
  overwriteExisting?: boolean;
}

export interface ApplyCodingResultsResponse {
  success: boolean;
  updatedResponsesCount: number;
  skippedReviewCount: number;
  skippedAlreadyCodedCount: number;
  overwrittenExistingCount: number;
  messageKey: string;
  messageParams?: Record<string, unknown>;
}

export interface BulkApplyCodingResultsResponse {
  success: boolean;
  jobsProcessed: number;
  totalUpdatedResponses: number;
  totalSkippedReview: number;
  totalSkippedAlreadyCoded: number;
  totalOverwrittenExisting: number;
  message: string;
  results: Array<{
    jobId: number;
    jobName: string;
    hasIssues: boolean;
    skipped: boolean;
    skippedReason?: 'coding-issues' | 'training-job' | 'not-completed' | 'freshness-stale';
    result?: {
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      skippedAlreadyCodedCount: number;
      overwrittenExistingCount: number;
      message: string;
    };
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class CodingJobBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private validationTaskStateService = inject(ValidationTaskStateService);

  private getAuthHeader(authToken?: string) {
    return { Authorization: `Bearer ${authToken || localStorage.getItem('id_token')}` };
  }

  private get authHeader() {
    return this.getAuthHeader();
  }

  getVariableBundles(workspaceId: number): Observable<VariableBundle[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/variable-bundle`;
    return this.http
      .get<PaginatedResponse<VariableBundle>>(url, { headers: this.authHeader })
      .pipe(map(response => response.data));
  }

  private mapApiCodingJob(job: unknown): CodingJob {
    if (!job) {
      return job as CodingJob;
    }

    const apiJob = job as Record<string, unknown>;
    const distributionSeed = apiJob.distributionSeed ?? apiJob.distribution_seed;

    const mapped: Partial<CodingJob> = {
      ...apiJob,
      assignedCoders: (apiJob.assignedCoders ??
        apiJob.assigned_coders ??
        []) as number[],
      assignedCoderConfigs: (apiJob.assignedCoderConfigs ??
        apiJob.assigned_coder_configs ??
        []) as JobDefinitionCoderConfig[],
      distributionSeed: typeof distributionSeed === 'string' ? distributionSeed : undefined,
      assignedVariables: (apiJob.assignedVariables ??
        apiJob.assigned_variables ??
        apiJob.variables ??
        []) as Variable[],
      variables: (apiJob.variables ??
        apiJob.assigned_variables ??
        apiJob.assignedVariables ??
        []) as Variable[],
      assignedVariableBundles: (apiJob.assignedVariableBundles ??
        apiJob.assigned_variable_bundles ??
        apiJob.variableBundles ??
        apiJob.variable_bundles ??
        []) as VariableBundle[],
      variableBundles: (apiJob.variableBundles ??
        apiJob.variable_bundles ??
        apiJob.assigned_variable_bundles ??
        apiJob.assignedVariableBundles ??
        []) as VariableBundle[],
      progress: (apiJob.progress ?? 0) as number,
      codedUnits: (apiJob.codedUnits ??
        apiJob.coded_units ??
        apiJob.coded ??
        0) as number,
      totalUnits: (apiJob.totalUnits ??
        apiJob.total_units ??
        apiJob.total ??
        0) as number,
      openUnits: (apiJob.openUnits ??
        apiJob.open_units ??
        apiJob.open ??
        0) as number,
      aggregationEnabled: (apiJob.aggregationEnabled ??
        apiJob.aggregation_enabled) as boolean | undefined,
      aggregationThreshold: (apiJob.aggregationThreshold ??
        apiJob.aggregation_threshold) as number | null | undefined,
      responseMatchingFlags: (apiJob.responseMatchingFlags ??
        apiJob.response_matching_flags) as string[] | null | undefined,
      aggregationSettingsVersion: (apiJob.aggregationSettingsVersion ??
        apiJob.aggregation_settings_version) as number | null | undefined,
      freshnessStatus: (apiJob.freshnessStatus ??
        apiJob.freshness_status) as CodingJob['freshnessStatus'],
      freshnessReason: (apiJob.freshnessReason ??
        apiJob.freshness_reason) as string | null | undefined,
      freshnessUpdatedAt: (apiJob.freshnessUpdatedAt ??
        apiJob.freshness_updated_at) as string | Date | null | undefined,
      freshnessAffectedUnits: (apiJob.freshnessAffectedUnits ??
        apiJob.freshness_affected_units) as number | undefined,
      freshnessAffectedResponses: (apiJob.freshnessAffectedResponses ??
        apiJob.freshness_affected_responses) as number | undefined,
      showScore: (apiJob.showScore ?? apiJob.show_score) as boolean | undefined,
      allowComments: (apiJob.allowComments ?? apiJob.allow_comments) as boolean | undefined,
      suppressGeneralInstructions: (apiJob.suppressGeneralInstructions ??
        apiJob.suppress_general_instructions) as boolean | undefined,
      jobDefinitionId: (apiJob.jobDefinitionId ??
        apiJob.job_definition_id) as number | undefined,
      created_at: (apiJob.created_at ?? apiJob.createdAt) as Date,
      updated_at: (apiJob.updated_at ?? apiJob.updatedAt) as Date,
      workspace_id: (apiJob.workspace_id ?? apiJob.workspaceId) as number
    };

    return mapped as CodingJob;
  }

  getCodingJobs(
    workspaceId: number,
    page?: number,
    limit?: number
  ): Observable<PaginatedResponse<CodingJob>> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job`;
    let params = new HttpParams();

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<PaginatedResponse<unknown>>(url, { params, headers: this.authHeader }).pipe(
      map(response => ({
        ...response,
        data: (response.data || []).map((j: unknown) => this.mapApiCodingJob(j))
      }))
    );
  }

  getCodingJob(
    workspaceId: number,
    codingJobId: number,
    authToken?: string
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http
      .get<unknown>(url, { headers: this.getAuthHeader(authToken) })
      .pipe(map(job => this.mapApiCodingJob(job)));
  }

  createCodingJob(
    workspaceId: number,
    codingJob: Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job`;
    return this.http.post<CodingJob>(url, codingJob, { headers: this.authHeader });
  }

  updateCodingJob(
    workspaceId: number,
    codingJobId: number,
    codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>,
    authToken?: string
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.put<CodingJob>(url, codingJob, { headers: this.getAuthHeader(authToken) });
  }

  deleteCodingJob(
    workspaceId: number,
    codingJobId: number
  ): Observable<{ success: boolean }> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.delete<{ success: boolean }>(url, { headers: this.authHeader });
  }

  transferCodingCases(
    workspaceId: number,
    sourceCoderId: number,
    targetCoderId: number
  ): Observable<TransferCodingCasesResponse> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/transfer-cases`;
    return this.http.post<TransferCodingCasesResponse>(
      url,
      { sourceCoderId, targetCoderId },
      { headers: this.authHeader }
    );
  }

  startCodingJob(
    workspaceId: number,
    codingJobId: number
  ): Observable<{ total: number; firstReplayUrl: string }> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/start`;
    return this.http.post<{ total: number; firstReplayUrl: string }>(url, {}, { headers: this.authHeader });
  }

  getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string,
    trainingRequired?: boolean
  ): Observable<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
      uniqueCasesAfterAggregation: number;
      isDerived: boolean;
      coderTrainingRequired?: boolean;
    }[]
    > {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/incomplete-variables`;
    let params = new HttpParams();
    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (trainingRequired !== undefined) {
      params = params.set('trainingRequired', trainingRequired.toString());
    }
    params = params.set('_t', Date.now().toString());
    return this.http.get<
    {
      unitName: string;
      variableId: string;
      responseCount: number;
      casesInJobs: number;
      availableCases: number;
      uniqueCasesAfterAggregation: number;
      isDerived: boolean;
      coderTrainingRequired?: boolean;
    }[]
    >(url, { params, headers: this.authHeader });
  }

  getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Observable<number> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/applied-results-count`;
    return this.http.post<number>(url, { incompleteVariables }, { headers: this.authHeader });
  }

  triggerResponseAnalysis(workspaceId: number, threshold?: number): Observable<void> {
    return this.http.post<void>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/response-analysis`,
      threshold === undefined ? {} : { threshold },
      { headers: this.authHeader }
    );
  }

  saveCodingProgress(
    workspaceId: number,
    codingJobId: number,
    progressData: {
      testPerson: string;
      unitId: string;
      variableId: string;
      selectedCode: {
        id: number;
        code: string;
        label: string;
        [key: string]: unknown;
      } | null;
      isOpen?: boolean;
      notes?: string;
    },
    authToken?: string
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/progress`;
    return this.http.post<CodingJob>(url, progressData, { headers: this.getAuthHeader(authToken) });
  }

  updateCodingJobKeepalive(
    workspaceId: number,
    codingJobId: number,
    codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>,
    authToken?: string
  ): void {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    fetch(url, {
      method: 'PUT',
      keepalive: true,
      headers: {
        ...this.getAuthHeader(authToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(codingJob)
    }).catch(() => undefined);
  }

  saveCodingNotes(
    workspaceId: number,
    codingJobId: number,
    notesData: {
      testPerson: string;
      unitId: string;
      variableId: string;
      notes?: string;
    },
    authToken?: string
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/notes`;
    return this.http.post<CodingJob>(url, notesData, { headers: this.getAuthHeader(authToken) });
  }

  restartCodingJobWithOpenUnits(
    workspaceId: number,
    codingJobId: number
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/restart-open-units`;
    return this.http.post<CodingJob>(url, {}, { headers: this.authHeader });
  }

  getCodingProgress(
    workspaceId: number,
    codingJobId: number,
    authToken?: string
  ): Observable<Record<string, unknown>> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/progress`;
    return this.http.get<Record<string, unknown>>(url, {
      headers: this.getAuthHeader(authToken)
    });
  }

  getBulkCodingProgress(
    workspaceId: number,
    jobIds: number[]
  ): Observable<Record<number, Record<string, unknown>>> {
    const jobIdsParam = jobIds.join(',');
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/progress/bulk?jobIds=${jobIdsParam}`;
    return this.http.get<Record<number, Record<string, unknown>>>(url, {
      headers: this.authHeader
    });
  }

  getCodingNotes(
    workspaceId: number,
    codingJobId: number,
    authToken?: string
  ): Observable<Record<string, string> | null> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding-job/${codingJobId}/notes`;
    return this.http.get<Record<string, string> | null>(url, {
      headers: this.getAuthHeader(authToken)
    });
  }

  getCodingJobUnits(
    workspaceId: number,
    codingJobId: number,
    authToken?: string,
    onlyOpen: boolean = false
  ): Observable<
    Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      isDoubleCoded: boolean;
      otherCoders: string[];
    }>
    > {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/units`;
    let params = new HttpParams();
    if (onlyOpen) {
      params = params.set('onlyOpen', 'true');
    }
    return this.http.get<
    Array<{
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      isDoubleCoded: boolean;
      otherCoders: string[];
    }>
    >(url, { headers: this.getAuthHeader(authToken), params });
  }

  applyCodingResults(
    workspaceId: number,
    codingJobId: number,
    options: ApplyCodingResultsOptions = {}
  ): Observable<ApplyCodingResultsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/${codingJobId}/apply-results`;
    return this.http.post<ApplyCodingResultsResponse>(url, options, { headers: this.authHeader }).pipe(
      tap(result => {
        if (result.success) {
          this.validationTaskStateService.invalidateWorkspace(workspaceId);
        }
      })
    );
  }

  bulkApplyCodingResults(workspaceId: number): Observable<BulkApplyCodingResultsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/bulk-apply-results`;
    return this.http.post<BulkApplyCodingResultsResponse>(url, {}, { headers: this.authHeader }).pipe(
      tap(result => {
        if (result.success && result.totalUpdatedResponses > 0) {
          this.validationTaskStateService.invalidateWorkspace(workspaceId);
        }
      })
    );
  }

  getCodingJobFreshnessImpact(
    workspaceId: number,
    codingJobId: number
  ): Observable<CodingJobFreshnessImpactDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/${codingJobId}/freshness-impact`;
    return this.http.get<CodingJobFreshnessImpactDto>(url, { headers: this.authHeader });
  }

  createJobDefinition(
    workspaceId: number,
    jobDefinition: Omit<JobDefinition, 'id'>
  ): Observable<JobDefinition> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions`;
    return this.http.post<JobDefinition>(url, jobDefinition, { headers: this.authHeader });
  }

  updateJobDefinition(
    workspaceId: number,
    jobDefinitionId: number,
    jobDefinition: Partial<JobDefinition>
  ): Observable<JobDefinition> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}`;
    return this.http.put<JobDefinition>(url, jobDefinition, { headers: this.authHeader });
  }

  approveJobDefinition(
    workspaceId: number,
    jobDefinitionId: number,
    status: 'pending_review' | 'approved'
  ): Observable<JobDefinition> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}/approve`;
    return this.http.put<JobDefinition>(url, { status }, { headers: this.authHeader });
  }

  getJobDefinitions(workspaceId: number): Observable<JobDefinition[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions`;
    return this.http.get<JobDefinitionApiResponse[]>(url, { headers: this.authHeader }).pipe(
      map((definitions: JobDefinitionApiResponse[]) => definitions.map(def => ({
        id: def.id,
        status: def.status,
        assignedVariables: def.assigned_variables,
        assignedVariableBundles: def.assigned_variable_bundles,
        assignedCoders: def.assigned_coders,
        assignedCoderConfigs: def.assignedCoderConfigs ?? def.assigned_coder_configs,
        distributionSeed: def.distributionSeed ?? def.distribution_seed,
        plannedVariableUsage: def.plannedVariableUsage ?? def.planned_variable_usage,
        durationSeconds: def.duration_seconds,
        maxCodingCases: def.max_coding_cases,
        doubleCodingAbsolute: def.double_coding_absolute,
        doubleCodingPercentage: def.double_coding_percentage,
        caseOrderingMode: def.case_ordering_mode,
        showScore: def.showScore ?? def.show_score,
        allowComments: def.allowComments ?? def.allow_comments,
        suppressGeneralInstructions: def.suppressGeneralInstructions ?? def.suppress_general_instructions,
        createdJobsCount: def.createdJobsCount ?? def.created_jobs_count,
        blockingCreatedJobsCount: def.blockingCreatedJobsCount ??
          def.blocking_created_jobs_count ??
          def.openCreatedJobsCount ??
          def.open_created_jobs_count,
        createdAt: def.created_at,
        updatedAt: def.updated_at
      }))
      )
    );
  }

  deleteJobDefinition(
    workspaceId: number,
    jobDefinitionId: number
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}`;
    return this.http.delete<{ success: boolean; message: string }>(url, { headers: this.authHeader });
  }

  createCodingJobFromDefinition(
    workspaceId: number,
    jobDefinitionId: number
  ): Observable<DistributedCodingJobsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}/create-job`;
    return this.http.post<DistributedCodingJobsResponse>(url, {}, { headers: this.authHeader });
  }

  previewJobDefinitionRefresh(
    workspaceId: number,
    jobDefinitionId: number
  ): Observable<JobDefinitionRefreshPreviewDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}/refresh-preview`;
    return this.http.get<JobDefinitionRefreshPreviewDto>(url, { headers: this.authHeader });
  }

  applyJobDefinitionRefresh(
    workspaceId: number,
    jobDefinitionId: number
  ): Observable<JobDefinitionRefreshApplyResultDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}/refresh-apply`;
    return this.http.post<JobDefinitionRefreshApplyResultDto>(url, {}, { headers: this.authHeader }).pipe(
      tap(result => {
        if (result.success) {
          this.validationTaskStateService.invalidateWorkspace(workspaceId);
        }
      })
    );
  }

  startExportJob(
    workspaceId: number,
    exportConfig: CodingExportConfig
  ): Observable<{ jobId: string; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/start`;
    // Ensure serverUrl is set if not provided
    const configWithServerUrl = {
      ...exportConfig,
      serverUrl: exportConfig.serverUrl || window.location.origin
    };
    return this.http.post<{ jobId: string; message: string }>(
      url,
      configWithServerUrl,
      {
        headers: this.authHeader
      }
    );
  }

  getExportJobStatus(
    workspaceId: number,
    jobId: string
  ): Observable<{
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
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}`;
    return this.http.get<{
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
    }>(url, {
      headers: this.authHeader
    });
  }

  downloadExportFile(workspaceId: number, jobId: string): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}/download`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  cancelExportJob(
    workspaceId: number,
    jobId: string
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}/cancel`;
    return this.http.post<{ success: boolean; message: string }>(
      url,
      {},
      {
        headers: this.authHeader
      }
    );
  }
}
