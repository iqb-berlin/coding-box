import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { CoderTraining } from '../models/coder-training.model';

export interface CoderTrainingJob {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
}

export interface CreateCoderTrainingJobsResponse {
  success: boolean;
  jobsCreated: number;
  message: string;
  jobs: CoderTrainingJob[];
  trainingId?: number;
}

export interface TrainingCodingResult {
  unitName: string;
  variableId: string;
  trainings: Array<{
    trainingId: number;
    trainingLabel: string;
    code: string | null;
    score: number | null;
  }>;
}

export interface WithinTrainingCodingResult {
  unitName: string;
  variableId: string;
  personCode: string;
  testPerson: string;
  givenAnswer: string;
  coders: Array<{
    jobId: number;
    coderName: string;
    code: string | null;
    score: number | null;
  }>;
}

export interface CodingJobForTraining {
  id: number;
  name: string;
  description?: string;
  status: string;
  created_at: Date;
  coder: {
    userId: number;
    username: string;
  };
  unitsCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class CodingTrainingBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: {
      variableId: string;
      unitId: string;
      sampleCount: number;
    }[],
    trainingLabel: string,
    missingsProfileId?: number
  ): Observable<CreateCoderTrainingJobsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-training-jobs`;
    return this.http.post<CreateCoderTrainingJobsResponse>(url, {
      trainingLabel,
      selectedCoders,
      variableConfigs,
      missingsProfileId
    }, { headers: this.authHeader });
  }

  getCoderTrainings(workspaceId: number): Observable<CoderTraining[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings`;
    return this.http.get<CoderTraining[]>(url, { headers: this.authHeader });
  }

  updateCoderTrainingLabel(
    workspaceId: number,
    trainingId: number,
    newLabel: string
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}`;
    return this.http.put<{ success: boolean; message: string }>(url, {
      label: newLabel
    }, { headers: this.authHeader });
  }

  deleteCoderTraining(
    workspaceId: number,
    trainingId: number
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}`;
    return this.http.delete<{ success: boolean; message: string }>(url, { headers: this.authHeader });
  }

  compareTrainingCodingResults(
    workspaceId: number,
    trainingIds: string
  ): Observable<TrainingCodingResult[]> {
    const url = `${this.serverUrl
    }admin/workspace/${workspaceId}/coding/compare-training-results?trainingIds=${encodeURIComponent(
      trainingIds
    )}`;
    return this.http.get<TrainingCodingResult[]>(url, { headers: this.authHeader });
  }

  compareWithinTrainingCodingResults(
    workspaceId: number,
    trainingId: number
  ): Observable<WithinTrainingCodingResult[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/compare-within-training?trainingId=${trainingId}`;
    return this.http.get<WithinTrainingCodingResult[]>(url, { headers: this.authHeader });
  }

  getCodingJobsForTraining(
    workspaceId: number,
    trainingId: number
  ): Observable<CodingJobForTraining[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/jobs`;
    return this.http.get<CodingJobForTraining[]>(url, { headers: this.authHeader });
  }
}
