import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { EMPTY, Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SERVER_URL } from '../../../injection-tokens';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';
import { CodingBackgroundJobsService } from '../../../coding/services/coding-background-jobs.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';

export interface JobCancelResult {
  success: boolean;
  message: string;
}

export interface VariableFrequencyDto {
  unitId?: number;
  unitName?: string;
  variableId: string;
  value: string;
  label?: string;
  score?: number;
  schemaOrder?: number;
  isSchemaOnly?: boolean;
  isSchemaSupplemental?: boolean;
  count: number;
  validOccurrenceCount?: number;
  percentage: number;
  percentageTotal?: number;
  percentageValid?: number | null;
  pointBiserial?: number | null;
  codePbc?: number | null;
  categoryPbc?: number | null;
}

export type VariableAnalysisSortBy =
  | 'unitName'
  | 'variableId'
  | 'value'
  | 'label'
  | 'score'
  | 'count'
  | 'validOccurrenceCount'
  | 'percentage'
  | 'percentageTotal'
  | 'percentageValid'
  | 'totalCount'
  | 'validCount'
  | 'emptyCount'
  | 'emptyPercentage'
  | 'statusSummary';

export type VariableAnalysisSortDirection = 'asc' | 'desc';

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
  sourceVariableId?: string;
  variableAlias?: string;
  selectionSource?: string;
  sourceType?: string;
  isDerived?: boolean;
  hasCodingScheme?: boolean;
  totalCount?: number;
  validCount?: number;
  invalidCount?: number;
  emptyCount?: number;
  emptyPercentage?: number;
  distinctValueCount?: number;
  statusCounts?: VariableStatusCount[];
}

export interface VariableStatusCount {
  status: number | string;
  count: number;
  percentage: number;
}

export interface VariableAnalysisResultDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}

export interface VariableAnalysisTableRowDto extends VariableFrequencyDto {
  unitId: number;
  unitName: string;
  variableId: string;
  sourceVariableId?: string;
  variableAlias?: string;
  selectionSource?: string;
  sourceType?: string;
  isDerived?: boolean;
  hasCodingScheme?: boolean;
  totalCount: number;
  validCount?: number;
  invalidCount?: number;
  emptyCount: number;
  emptyPercentage: number;
  distinctValueCount: number;
  hiddenValueCount: number;
  statusCounts?: VariableStatusCount[];
  statusSummary: string;
  pointBiserial?: number | null;
  codePbc?: number | null;
  categoryPbc?: number | null;
}

export interface VariableAnalysisResultPageDto extends VariableAnalysisResultDto {
  unfilteredTotal: number;
  rows?: VariableAnalysisTableRowDto[];
  rowTotal?: number;
  pageableRowTotal?: number;
  unfilteredRowTotal?: number;
  maxPage?: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface VariableAnalysisResultPageOptions {
  page: number;
  pageSize: number;
  search?: string;
  onlyEmpty?: boolean;
  includeSchemaCodes?: boolean;
  sortBy?: VariableAnalysisSortBy;
  sortDirection?: VariableAnalysisSortDirection;
}

export interface VariableAnalysisExportOptions {
  search?: string;
  onlyEmpty?: boolean;
  includeSchemaCodes?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class VariableAnalysisService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private codingBackgroundJobsService = inject(CodingBackgroundJobsService);
  private testPersonCodingService = inject(TestPersonCodingService);
  private variableAnalysisGuardPollTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly variableAnalysisGuardJobId = 'variable-analysis-dialog';
  private readonly variableAnalysisGuardPollIntervalMs = 5000;
  private readonly activeJobStatuses = new Set<VariableAnalysisJobDto['status']>([
    'pending',
    'waiting',
    'processing'
  ]);

  get authHeader() {
    return {};
  }

  createAnalysisJob(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Observable<VariableAnalysisJobDto> {
    let params = new HttpParams();

    if (unitId) {
      params = params.set('unitId', unitId.toString());
    }

    if (variableId) {
      params = params.set('variableId', variableId);
    }

    return this.http.post<VariableAnalysisJobDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs`,
      null,
      { headers: this.authHeader, params }
    );
  }

  exportAnalysisResultsAsCsv(
    workspaceId: number,
    jobId: number | string,
    options: VariableAnalysisExportOptions = {}
  ): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/results/export/csv`,
      {
        headers: this.authHeader,
        params: this.buildExportParams(options),
        responseType: 'blob' as 'json'
      }
    ) as unknown as Observable<Blob>;
  }

  exportAnalysisResultsAsXlsx(
    workspaceId: number,
    jobId: number | string,
    options: VariableAnalysisExportOptions = {}
  ): Observable<Blob> {
    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/results/export/xlsx`,
      {
        headers: this.authHeader,
        params: this.buildExportParams(options),
        responseType: 'blob' as 'json'
      }
    ) as unknown as Observable<Blob>;
  }

  getAnalysisJob(
    workspaceId: number,
    jobId: number | string
  ): Observable<VariableAnalysisJobDto> {
    return this.http.get<VariableAnalysisJobDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}`,
      { headers: this.authHeader }
    );
  }

  /**
   * @deprecated Use getAnalysisResultsPage to avoid loading large result sets into memory.
   */
  getAnalysisResults(
    workspaceId: number,
    jobId: number | string
  ): Observable<VariableAnalysisResultDto> {
    return this.http.get<VariableAnalysisResultDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/results`,
      { headers: this.authHeader }
    );
  }

  getAnalysisResultsPage(
    workspaceId: number,
    jobId: number | string,
    options: VariableAnalysisResultPageOptions
  ): Observable<VariableAnalysisResultPageDto> {
    let params = new HttpParams()
      .set('page', options.page.toString())
      .set('pageSize', options.pageSize.toString());

    if (options.search) {
      params = params.set('search', options.search);
    }

    if (options.onlyEmpty) {
      params = params.set('onlyEmpty', 'true');
    }

    if (options.includeSchemaCodes) {
      params = params.set('includeSchemaCodes', 'true');
    }

    if (options.sortBy) {
      params = params.set('sortBy', options.sortBy);
    }

    if (options.sortDirection) {
      params = params.set('sortDirection', options.sortDirection);
    }

    return this.http.get<VariableAnalysisResultPageDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/results/page`,
      { headers: this.authHeader, params }
    );
  }

  getAllJobs(workspaceId: number): Observable<VariableAnalysisJobDto[]> {
    return this.http.get<VariableAnalysisJobDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs`,
      { headers: this.authHeader }
    );
  }

  setVariableAnalysisGuardRunning(
    workspaceId: number | null | undefined,
    isRunning: boolean
  ): void {
    if (!workspaceId) {
      return;
    }

    if (!isRunning) {
      this.clearVariableAnalysisGuardPolling(workspaceId);
    }

    this.codingBackgroundJobsService.setJobRunning(
      workspaceId,
      'response-analysis',
      isRunning,
      this.variableAnalysisGuardJobId
    );
  }

  trackVariableAnalysisGuardUntilComplete(
    workspaceId: number | null | undefined
  ): void {
    if (!workspaceId) {
      return;
    }

    this.setVariableAnalysisGuardRunning(workspaceId, true);
    this.scheduleVariableAnalysisGuardPoll(workspaceId);
  }

  private scheduleVariableAnalysisGuardPoll(workspaceId: number): void {
    if (this.variableAnalysisGuardPollTimers.has(workspaceId)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      this.variableAnalysisGuardPollTimers.delete(workspaceId);
      this.pollVariableAnalysisGuard(workspaceId);
    }, this.variableAnalysisGuardPollIntervalMs);
    this.variableAnalysisGuardPollTimers.set(workspaceId, timeoutId);
  }

  private pollVariableAnalysisGuard(workspaceId: number): void {
    this.getAllJobs(workspaceId)
      .pipe(catchError(() => {
        this.scheduleVariableAnalysisGuardPoll(workspaceId);
        return EMPTY;
      }))
      .subscribe(jobs => {
        const hasActiveAnalysisJob = jobs.some(job => (
          job.type === 'variable-analysis' &&
          this.activeJobStatuses.has(job.status)
        ));

        if (hasActiveAnalysisJob) {
          this.scheduleVariableAnalysisGuardPoll(workspaceId);
          return;
        }

        this.testPersonCodingService.invalidateCodingStatusCache(workspaceId);
        this.setVariableAnalysisGuardRunning(workspaceId, false);
      });
  }

  private clearVariableAnalysisGuardPolling(workspaceId: number): void {
    const timeoutId = this.variableAnalysisGuardPollTimers.get(workspaceId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.variableAnalysisGuardPollTimers.delete(workspaceId);
    }
  }

  cancelJob(
    workspaceId: number,
    jobId: number | string
  ): Observable<JobCancelResult> {
    return this.http.post<JobCancelResult>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/cancel`,
      null,
      { headers: this.authHeader }
    );
  }

  deleteJob(
    workspaceId: number,
    jobId: number | string
  ): Observable<JobCancelResult> {
    return this.http.delete<JobCancelResult>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}`,
      { headers: this.authHeader }
    );
  }

  deleteAllJobs(workspaceId: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs`,
      { headers: this.authHeader }
    );
  }

  private buildExportParams(
    options: VariableAnalysisExportOptions
  ): HttpParams {
    let params = new HttpParams();

    if (options.search) {
      params = params.set('search', options.search);
    }

    if (options.onlyEmpty) {
      params = params.set('onlyEmpty', 'true');
    }

    if (options.includeSchemaCodes) {
      params = params.set('includeSchemaCodes', 'true');
    }

    return params;
  }
}
