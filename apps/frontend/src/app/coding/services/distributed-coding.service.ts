import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class DistributedCodingService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  createDistributedCodingJobs(
    workspaceId: number,
    selectedVariables: { unitName: string; variableId: string }[],
    selectedCoders: { id: number; name: string; username: string }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[],
    caseOrderingMode?: 'continuous' | 'alternating',
    maxCodingCases?: number
  ): Observable<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    return this.http
      .post<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/create-distributed-jobs`,
      {
        selectedVariables,
        selectedCoders,
        doubleCodingAbsolute,
        doubleCodingPercentage,
        selectedVariableBundles,
        caseOrderingMode,
        maxCodingCases
      },
      {}
    )
      .pipe(
        catchError(() => of({
          success: false,
          jobsCreated: 0,
          message: 'Failed to create distributed jobs',
          distribution: {},
          doubleCodingInfo: {},
          aggregationInfo: {},
          matchingFlags: [],
          jobs: []
        }))
      );
  }

  calculateDistribution(
    workspaceId: number,
    selectedVariables: { unitName: string; variableId: string }[],
    selectedCoders: { id: number; name: string; username: string }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[],
    maxCodingCases?: number
  ): Observable<{
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
    }> {
    const body: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      maxCodingCases?: number;
    } = {
      selectedVariables,
      selectedVariableBundles,
      selectedCoders,
      doubleCodingAbsolute,
      doubleCodingPercentage
    };

    if (maxCodingCases !== undefined && maxCodingCases !== null) {
      body.maxCodingCases = maxCodingCases;
    }

    return this.http
      .post<{
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/calculate-distribution`,
      body,
      {}
    )
      .pipe(
        catchError(() => of({
          distribution: {},
          doubleCodingInfo: {},
          aggregationInfo: {},
          matchingFlags: [],
          warnings: []
        }))
      );
  }
}
