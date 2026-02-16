import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SERVER_URL } from '../../injection-tokens';
import {
  CodingJob,
  Variable,
  VariableBundle
} from '../models/coding-job.model';

export interface CodingExportConfig {
  exportType:
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'detailed'
  | 'coding-times';
  userId: number;
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
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
  authToken?: string;
}

interface JobDefinitionApiResponse {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assigned_variables?: import('../models/coding-job.model').Variable[];
  assigned_variable_bundles?: import('../models/coding-job.model').VariableBundle[];
  assigned_coders?: number[];
  duration_seconds?: number;
  max_coding_cases?: number;
  double_coding_absolute?: number;
  double_coding_percentage?: number;
  case_ordering_mode?: 'continuous' | 'alternating';
  created_at?: Date;
  updated_at?: Date;
}

export interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: import('../models/coding-job.model').Variable[];
  assignedVariableBundles?: import('../models/coding-job.model').VariableBundle[];
  assignedCoders?: number[];
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class CodingJobBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
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

    const mapped: Partial<CodingJob> = {
      ...apiJob,
      assignedCoders: (apiJob.assignedCoders ??
        apiJob.assigned_coders ??
        []) as number[],
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
    codingJobId: number
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http
      .get<unknown>(url, { headers: this.authHeader })
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
    codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.put<CodingJob>(url, codingJob, { headers: this.authHeader });
  }

  deleteCodingJob(
    workspaceId: number,
    codingJobId: number
  ): Observable<{ success: boolean }> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.delete<{ success: boolean }>(url, { headers: this.authHeader });
  }

  startCodingJob(
    workspaceId: number,
    codingJobId: number
  ): Observable<{
      total: number;
      items: Array<{
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
      }>;
    }> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/start`;
    return this.http.post<{
      total: number;
      items: Array<{
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
      }>;
    }>(url, {}, { headers: this.authHeader });
  }

  getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string
  ): Observable<
    { unitName: string; variableId: string; responseCount: number }[]
    > {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/incomplete-variables`;
    let params = new HttpParams();
    if (unitName) {
      params = params.set('unitName', unitName);
    }
    params = params.set('_t', Date.now().toString());
    return this.http.get<
    { unitName: string; variableId: string; responseCount: number }[]
    >(url, { params, headers: this.authHeader });
  }

  getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Observable<number> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/applied-results-count`;
    return this.http.post<number>(url, { incompleteVariables }, { headers: this.authHeader });
  }

  triggerResponseAnalysis(workspaceId: number): Observable<void> {
    return this.http.post<void>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/response-analysis`,
      {},
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
      };
      isOpen?: boolean;
      notes?: string;
    }
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/progress`;
    return this.http.post<CodingJob>(url, progressData, { headers: this.authHeader });
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
    codingJobId: number
  ): Observable<Record<string, unknown>> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/progress`;
    return this.http.get<Record<string, unknown>>(url, {
      headers: this.authHeader
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
    codingJobId: number
  ): Observable<Record<string, string> | null> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding-job/${codingJobId}/notes`;
    return this.http.get<Record<string, string> | null>(url, {
      headers: this.authHeader
    });
  }

  getCodingJobUnits(
    workspaceId: number,
    codingJobId: number
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
    }>
    > {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/units`;
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
    }>
    >(url, { headers: this.authHeader });
  }

  applyCodingResults(
    workspaceId: number,
    codingJobId: number
  ): Observable<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/${codingJobId}/apply-results`;
    return this.http.post<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }>(url, {}, { headers: this.authHeader });
  }

  bulkApplyCodingResults(workspaceId: number): Observable<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    message: string;
    results: Array<{
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
    }>;
  }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/bulk-apply-results`;
    return this.http.post<{
      success: boolean;
      jobsProcessed: number;
      totalUpdatedResponses: number;
      totalSkippedReview: number;
      message: string;
      results: Array<{
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
      }>;
    }>(url, {}, { headers: this.authHeader });
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
        durationSeconds: def.duration_seconds,
        maxCodingCases: def.max_coding_cases,
        doubleCodingAbsolute: def.double_coding_absolute,
        doubleCodingPercentage: def.double_coding_percentage,
        caseOrderingMode: def.case_ordering_mode,
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

  startExportJob(
    workspaceId: number,
    exportConfig: CodingExportConfig
  ): Observable<{ jobId: string; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/start`;
    return this.http.post<{ jobId: string; message: string }>(
      url,
      exportConfig,
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
