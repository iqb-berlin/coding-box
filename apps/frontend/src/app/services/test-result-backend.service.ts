import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../injection-tokens';

export interface TestResultExportJob {
  jobId: string;
  status: string;
  progress: number;
  exportType: string;
  createdAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class TestResultBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  getExportOptions(workspaceId: number): Observable<{
    testPersons: {
      id: number;
      code: string;
      groupName: string;
      login: string;
    }[];
    groups: string[];
    booklets: string[];
    units: string[];
  }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/options`;
    return this.http.get<{
      testPersons: {
        id: number;
        code: string;
        groupName: string;
        login: string;
      }[];
      groups: string[];
      booklets: string[];
      units: string[];
    }>(url, {
      headers: this.authHeader
    });
  }

  startExportTestResultsJob(
    workspaceId: number,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    }
  ): Observable<{ jobId: string; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/job`;
    return this.http.post<{ jobId: string; message: string }>(
      url,
      filters || {},
      {
        headers: this.authHeader
      }
    );
  }

  startExportTestLogsJob(
    workspaceId: number,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    }
  ): Observable<{ jobId: string; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/logs/job`;
    return this.http.post<{ jobId: string; message: string }>(
      url,
      filters || {},
      {
        headers: this.authHeader
      }
    );
  }

  getExportTestResultsJobs(workspaceId: number): Observable<TestResultExportJob[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/jobs`;
    return this.http.get<TestResultExportJob[]>(url, {
      headers: this.authHeader
    });
  }

  downloadExportTestResultsJob(
    workspaceId: number,
    jobId: string
  ): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/jobs/${jobId}/download`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  deleteTestResultExportJob(
    workspaceId: number,
    jobId: string
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/jobs/${jobId}`;
    return this.http.delete<{ success: boolean; message: string }>(url, {
      headers: this.authHeader
    });
  }
}
