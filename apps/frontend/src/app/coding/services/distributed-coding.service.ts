import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

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

  createDistributedCodingJobs(
    workspaceId: number,
    selectedVariables: { unitName: string; variableId: string }[],
    selectedCoders: { id: number; name: string; username: string; weight?: number; capacityPercent?: number }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: { unitName: string; variableId: string }[] }[],
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
        catchError(() => of({
          success: false,
          jobsCreated: 0,
          message: 'Failed to create distributed jobs',
          distribution: {},
          distributionByCoderId: {},
          doubleCodingInfo: {},
          aggregationInfo: {},
          matchingFlags: [],
          pairDistribution: {},
          tasksPerCoder: {},
          coderWeights: {},
          jobs: []
        }))
      );
  }

  calculateDistribution(
    workspaceId: number,
    selectedVariables: { unitName: string; variableId: string }[],
    selectedCoders: { id: number; name: string; username: string; weight?: number; capacityPercent?: number }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: { unitName: string; variableId: string }[] }[],
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
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: { unitName: string; variableId: string }[] }[];
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
        catchError(() => of({
          distribution: {},
          distributionByCoderId: {},
          doubleCodingInfo: {},
          aggregationInfo: {},
          matchingFlags: [],
          pairDistribution: {},
          tasksPerCoder: {},
          coderWeights: {},
          warnings: []
        }))
      );
  }
}
