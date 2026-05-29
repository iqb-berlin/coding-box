import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

export type DistributionVariable = { unitName: string; variableId: string; includeDeriveError?: boolean };

export interface DistributionVariableBundle {
  id: number;
  name: string;
  caseOrderingMode?: 'continuous' | 'alternating';
  variables: DistributionVariable[];
}

export interface DistributedCodingJobsResponse extends DistributionCalculationResponse {
  success: boolean;
  jobsCreated: number;
  message: string;
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

export interface DistributionPreviewCoder {
  id: number;
  name: string;
  username: string;
  capacityPercent?: number;
}

export interface DistributionCalculationResponse {
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
  warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
  pairDistribution?: Record<string, number>;
  tasksPerCoder?: Record<string, number>;
  coderWeights?: Record<string, number>;
}

export interface JobDefinitionDistributionPreviewResponse extends DistributionCalculationResponse {
  selectedVariables: DistributionVariable[];
  selectedVariableBundles: DistributionVariableBundle[];
  selectedCoders: DistributionPreviewCoder[];
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
    selectedVariableBundles?: DistributionVariableBundle[],
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
    selectedVariableBundles?: DistributionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    maxCodingCases?: number,
    distributionSeed?: string
  ): Observable<DistributionCalculationResponse> {
    const body: {
      selectedVariables: DistributionVariable[];
      selectedVariableBundles?: DistributionVariableBundle[];
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
