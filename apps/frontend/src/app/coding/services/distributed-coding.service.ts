import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

type DistributionVariable = { unitName: string; variableId: string; includeDeriveError?: boolean };

export interface DistributedCodingJobsResponse {
  success: boolean;
  jobsCreated: number;
  message: string;
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId?: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, {
    totalCases: number;
    distinctCases?: number;
    codingTasksTotal?: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: string[];
  pairDistribution?: Record<string, number>;
  tasksPerCoder?: Record<string, number>;
  coderWeights?: Record<string, number>;
  jobs: {
    itemKey?: string;
    coderId: number;
    coderName: string;
    variable: { unitName: string; variableId: string };
    jobId: number;
    jobName: string;
    caseCount: number;
  }[];
}

@Injectable({
  providedIn: 'root'
})
export class DistributedCodingService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  private getErrorMessage(error: unknown): string {
    const httpError = error as {
      error?: { message?: string | string[] } | string;
      message?: string;
    };

    if (typeof httpError.error === 'string' && httpError.error.trim()) {
      return httpError.error;
    }

    if (httpError.error && typeof httpError.error === 'object' && 'message' in httpError.error) {
      const message = httpError.error.message;
      return Array.isArray(message) ? message.join(', ') : message || 'Unbekannter Fehler';
    }

    return httpError.message || 'Unbekannter Fehler';
  }

  createDistributedCodingJobs(
    workspaceId: number,
    selectedVariables: DistributionVariable[],
    selectedCoders: { id: number; name: string; username: string; weight?: number; capacityPercent?: number }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: DistributionVariable[] }[],
    caseOrderingMode?: 'continuous' | 'alternating',
    maxCodingCases?: number,
    displayOptions?: {
      showScore?: boolean;
      allowComments?: boolean;
      suppressGeneralInstructions?: boolean;
    },
    distributionSeed?: string
  ): Observable<DistributedCodingJobsResponse> {
    return this.http
      .post<DistributedCodingJobsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/create-distributed-jobs`,
      {
        selectedVariables,
        selectedCoders,
        doubleCodingAbsolute,
        doubleCodingPercentage,
        selectedVariableBundles,
        caseOrderingMode,
        maxCodingCases,
        distributionSeed,
        showScore: displayOptions?.showScore,
        allowComments: displayOptions?.allowComments,
        suppressGeneralInstructions: displayOptions?.suppressGeneralInstructions
      },
      {}
    )
      .pipe(
        catchError(error => throwError(() => new Error(this.getErrorMessage(error))))
      );
  }

  calculateDistribution(
    workspaceId: number,
    selectedVariables: DistributionVariable[],
    selectedCoders: { id: number; name: string; username: string; weight?: number; capacityPercent?: number }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: DistributionVariable[] }[],
    caseOrderingMode?: 'continuous' | 'alternating',
    maxCodingCases?: number,
    distributionSeed?: string
  ): Observable<{
      distribution: Record<string, Record<string, number>>;
      distributionByCoderId?: Record<string, Record<string, number>>;
      doubleCodingInfo: DistributedCodingJobsResponse['doubleCodingInfo'];
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      pairDistribution?: Record<string, number>;
      tasksPerCoder?: Record<string, number>;
      coderWeights?: Record<string, number>;
      warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
    }> {
    const body: {
      selectedVariables: DistributionVariable[];
      selectedVariableBundles?: { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: DistributionVariable[] }[];
      selectedCoders: { id: number; name: string; username: string; weight?: number; capacityPercent?: number }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
      distributionSeed?: string;
    } = {
      selectedVariables,
      selectedVariableBundles,
      selectedCoders,
      doubleCodingAbsolute,
      doubleCodingPercentage,
      caseOrderingMode,
      distributionSeed
    };

    if (maxCodingCases !== undefined && maxCodingCases !== null) {
      body.maxCodingCases = maxCodingCases;
    }

    return this.http
      .post<{
      distribution: Record<string, Record<string, number>>;
      distributionByCoderId?: Record<string, Record<string, number>>;
      doubleCodingInfo: DistributedCodingJobsResponse['doubleCodingInfo'];
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      pairDistribution?: Record<string, number>;
      tasksPerCoder?: Record<string, number>;
      coderWeights?: Record<string, number>;
      warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/calculate-distribution`,
      body,
      {}
    )
      .pipe(
        catchError(error => throwError(() => new Error(this.getErrorMessage(error))))
      );
  }
}
