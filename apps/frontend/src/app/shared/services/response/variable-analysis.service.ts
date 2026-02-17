import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  Observable
} from 'rxjs';
import { logger } from 'nx/src/utils/logger';
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
}

export interface VariableAnalysisResultDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
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
    ).pipe(
      catchError(error => {
        logger.error(`Error creating variable analysis job: ${error.message}`);
        throw error;
      })
    );
  }

  getAnalysisJob(
    workspaceId: number,
    jobId: string
  ): Observable<VariableAnalysisJobDto> {
    return this.http.get<VariableAnalysisJobDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        logger.error(`Error getting variable analysis job: ${error.message}`);
        throw error;
      })
    );
  }

  getAnalysisResults(
    workspaceId: number,
    jobId: string
  ): Observable<VariableAnalysisResultDto> {
    return this.http.get<VariableAnalysisResultDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/results`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        logger.error(`Error getting variable analysis results: ${error.message}`);
        throw error;
      })
    );
  }

  getAllJobs(workspaceId: number): Observable<VariableAnalysisJobDto[]> {
    return this.http.get<VariableAnalysisJobDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        logger.error(`Error getting all variable analysis jobs: ${error.message}`);
        throw error;
      })
    );
  }

  cancelJob(workspaceId: number, jobId: string): Observable<JobCancelResult> {
    return this.http.post<JobCancelResult>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}/cancel`,
      null,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        logger.error(`Error cancelling variable analysis job: ${error.message}`);
        throw error;
      })
    );
  }

  deleteJob(workspaceId: number, jobId: string): Observable<JobCancelResult> {
    return this.http.delete<JobCancelResult>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs/${jobId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        logger.error(`Error deleting variable analysis job: ${error.message}`);
        throw error;
      })
    );
  }

  deleteAllJobs(workspaceId: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/variable-analysis/jobs`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        logger.error(`Error deleting all variable analysis jobs: ${error.message}`);
        throw error;
      })
    );
  }
}
