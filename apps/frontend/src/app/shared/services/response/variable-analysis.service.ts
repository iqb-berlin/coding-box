import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../../injection-tokens';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';

export interface JobCancelResult {
  success: boolean;
  message: string;
}

export interface VariableFrequencyDto {
  unitId?: number;
  unitName?: string;
  variableId: string;
  value: string;
  count: number;
  percentage: number;
}

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
  totalCount?: number;
  emptyCount?: number;
  emptyPercentage?: number;
  distinctValueCount?: number;
  statusCounts?: VariableStatusCount[];
}

export interface VariableStatusCount {
  status: number;
  count: number;
  percentage: number;
}

export interface VariableAnalysisResultDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}

export interface VariableAnalysisResultPageDto extends VariableAnalysisResultDto {
  unfilteredTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface VariableAnalysisResultPageOptions {
  page: number;
  pageSize: number;
  search?: string;
  onlyEmpty?: boolean;
}

export interface VariableAnalysisExportOptions {
  search?: string;
  onlyEmpty?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class VariableAnalysisService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
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

    return params;
  }
}
