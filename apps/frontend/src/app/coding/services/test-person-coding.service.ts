import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  of
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import {
  ValidateCodingCompletenessResponseDto
} from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  ValidateCodingCompletenessRequestDto
} from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';
import { ExternalCodingImportResultDto } from '../../../../../../api-dto/coding/external-coding-import-result.dto';

interface ExternalCodingImportWithPreviewDto {
  file: string;
  fileName?: string;
  previewOnly?: boolean;
}

export interface CodingStatistics {
  totalResponses: number;
  statusCounts: {
    [key: string]: number;
  };
}

export interface CodingStatisticsWithJob extends CodingStatistics {
  jobId?: string;
  message?: string;
}

export interface CodingListItem {
  unit_key: string;
  unit_alias: string;
  login_name: string;
  login_code: string;
  booklet_id: string;
  variable_id: string;
  variable_page: string;
  variable_anchor: string;
  url: string;
}

export interface PaginatedCodingList {
  data: CodingListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface JobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: number;
  result?: CodingStatistics;
  error?: string;
  workspaceId?: number;
  createdAt?: Date;
  testPersonId?: string;
  groupNames?: string;
  durationMs?: number;
  completedAt?: Date;
  autoCoderRun?: number;
}

export interface JobInfo extends JobStatus {
  jobId: string;
}

export interface WorkspaceGroupCodingStats {
  groupName: string;
  testPersonCount: number;
  responsesToCode: number;
}

@Injectable({
  providedIn: 'root'
})
export class TestPersonCodingService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  codeTestPersons(workspaceId: number, testPersonIds: string, autoCoderRun: number = 1): Observable<CodingStatisticsWithJob> {
    const params = new HttpParams()
      .set('testPersons', testPersonIds)
      .set('autoCoderRun', autoCoderRun.toString());

    return this.http
      .get<CodingStatisticsWithJob>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getManualTestPersons(workspaceId: number, testPersonIds?: string): Observable<unknown> {
    let url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/manual`;
    if (testPersonIds) {
      url += `?testPersons=${testPersonIds}`;
    }

    return this.http
      .get<unknown>(url, { headers: this.authHeader })
      .pipe(
        catchError(() => of([]))
      );
  }

  getCodingList(
    workspaceId: number,
    authToken: string,
    serverUrl?: string,
    page = 1,
    limit = 20
  ): Observable<PaginatedCodingList> {
    let params = new HttpParams()
      .set('authToken', authToken)
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (serverUrl) {
      params = params.set('serverUrl', serverUrl);
    }

    return this.http
      .get<PaginatedCodingList>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/coding-list`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page,
          limit
        }))
      );
  }

  getCodingStatistics(workspaceId: number): Observable<CodingStatistics> {
    return this.http
      .get<CodingStatistics>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/statistics`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ totalResponses: 0, statusCounts: {} }))
      );
  }

  getJobStatus(workspaceId: number, jobId: string): Observable<JobStatus | { error: string }> {
    return this.http
      .get<JobStatus | { error: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ error: `Failed to get status for job ${jobId}` }))
      );
  }

  cancelJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .get<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/cancel`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to cancel job ${jobId}` }))
      );
  }

  deleteJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .get<{ success: boolean; message: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/delete`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to delete job ${jobId}` }))
      );
  }

  exportCodingListAsCsv(workspaceId: number): Observable<Blob> {
    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/coding-list/csv`,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(() => of(new Blob(['No data available'], { type: 'text/csv' })))
      );
  }

  exportCodingListAsExcel(workspaceId: number): Observable<Blob> {
    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/coding-list/excel`,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(() => of(new Blob(['No data available'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })))
      );
  }

  getAllJobs(workspaceId: number): Observable<JobInfo[]> {
    return this.http
      .get<JobInfo[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }

  getWorkspaceGroups(workspaceId: number): Observable<WorkspaceGroupCodingStats[]> {
    return this.http
      .get<WorkspaceGroupCodingStats[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/groups/stats`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }

  restartJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string; jobId?: string }> {
    return this.http
      .get<{ success: boolean; message: string; jobId?: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/job/${jobId}/restart`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({ success: false, message: `Failed to restart job ${jobId}` }))
      );
  }

  validateCodingCompleteness(
    workspaceId: number,
    expectedCombinations: ExpectedCombinationDto[],
    page?: number,
    pageSize?: number
  ): Observable<ValidateCodingCompletenessResponseDto> {
    const request: ValidateCodingCompletenessRequestDto = {
      expectedCombinations,
      page: page || 1,
      pageSize: pageSize || 50
    };

    return this.http
      .post<ValidateCodingCompletenessResponseDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/validate-completeness`,
      request,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          results: [],
          total: 0,
          missing: 0,
          currentPage: page || 1,
          pageSize: pageSize || 50,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false
        }))
      );
  }

  downloadValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Observable<Blob> {
    const request = {
      cacheKey
    };

    return this.http
      .post(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/validate-completeness/export-excel`,
        request,
        {
          headers: this.authHeader,
          responseType: 'blob'
        }
      )
      .pipe(
        catchError(error => {
          throw error;
        })
      );
  }

  async importExternalCodingWithProgress(
    workspaceId: number,
    data: ExternalCodingImportWithPreviewDto,
    onProgress: (progress: number, message: string) => void,
    onComplete: (result: ExternalCodingImportResultDto) => void,
    onError: (error: string) => void
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/external-coding-import/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.authHeader
          },
          body: JSON.stringify(data)
        }
      );

      if (!response.ok) {
        onError(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        onError('No response body available for streaming');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          const value = result.value;

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const progressData = JSON.parse(line.substring(6));

                if (progressData.error) {
                  onError(progressData.message);
                  return;
                } if (progressData.result) {
                  onComplete(progressData.result);
                  return;
                }
                onProgress(progressData.progress, progressData.message);
              } catch (parseError) {
                // Skip invalid SSE data lines silently
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError(`Failed to start import: ${errorMessage}`);
    }
  }

  getCodingProgressOverview(workspaceId: number): Observable<{
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
  }> {
    return this.http
      .get<{
      totalCasesToCode: number;
      completedCases: number;
      completionPercentage: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/progress-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          totalCasesToCode: 0,
          completedCases: 0,
          completionPercentage: 0
        }))
      );
  }

  generateCoderTrainingPackages(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[]
  ): Observable<{
      coderId: number;
      coderName: string;
      responses: {
        responseId: number;
        unitAlias: string;
        variableId: string;
        unitName: string;
        value: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        bookletName: string;
        variable: string;
      }[];
    }[]> {
    const request = {
      selectedCoders,
      variableConfigs
    };

    return this.http
      .post<{
      coderId: number;
      coderName: string;
      responses: {
        responseId: number;
        unitAlias: string;
        variableId: string;
        unitName: string;
        value: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        bookletName: string;
        variable: string;
      }[];
    }[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-training-packages`,
      request,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of([]))
      );
  }

  getVariableCoverageOverview(workspaceId: number): Observable<{
    totalVariables: number;
    coveredVariables: number;
    coveredByDraft: number;
    coveredByPendingReview: number;
    coveredByApproved: number;
    conflictedVariables: number;
    missingVariables: number;
    partiallyAbgedeckteVariablen?: number;
    fullyAbgedeckteVariablen?: number;
    coveragePercentage: number;
    variableCaseCounts: { unitName: string; variableId: string; caseCount: number }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{
        variableKey: string;
        conflictingDefinitions: Array<{
          id: number;
          status: string;
        }>;
      }>;
    };
  }> {
    return this.http
      .get<{
      totalVariables: number;
      coveredVariables: number;
      coveredByDraft: number;
      coveredByPendingReview: number;
      coveredByApproved: number;
      conflictedVariables: number;
      missingVariables: number;
      partiallyAbgedeckteVariablen?: number;
      fullyAbgedeckteVariablen?: number;
      coveragePercentage: number;
      variableCaseCounts: { unitName: string; variableId: string; caseCount: number }[];
      coverageByStatus: {
        draft: string[];
        pending_review: string[];
        approved: string[];
        conflicted: Array<{
          variableKey: string;
          conflictingDefinitions: Array<{
            id: number;
            status: string;
          }>;
        }>;
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/variable-coverage-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          totalVariables: 0,
          coveredVariables: 0,
          coveredByDraft: 0,
          coveredByPendingReview: 0,
          coveredByApproved: 0,
          conflictedVariables: 0,
          missingVariables: 0,
          partiallyAbgedeckteVariablen: 0,
          fullyAbgedeckteVariablen: 0,
          coveragePercentage: 0,
          variableCaseCounts: [],
          coverageByStatus: {
            draft: [],
            pending_review: [],
            approved: [],
            conflicted: []
          }
        }))
      );
  }

  getCaseCoverageOverview(workspaceId: number): Observable<{
    totalCasesToCode: number;
    casesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    coveragePercentage: number;
  }> {
    return this.http
      .get<{
      totalCasesToCode: number;
      casesInJobs: number;
      doubleCodedCases: number;
      singleCodedCases: number;
      unassignedCases: number;
      coveragePercentage: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/case-coverage-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          totalCasesToCode: 0,
          casesInJobs: 0,
          doubleCodedCases: 0,
          singleCodedCases: 0,
          unassignedCases: 0,
          coveragePercentage: 0
        }))
      );
  }

  getResponseAnalysis(workspaceId: number): Observable<{
    emptyResponses: {
      total: number;
      items: {
        unitName: string;
        unitAlias: string | null;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        responseId: number;
      }[];
    };
    duplicateValues: {
      total: number;
      totalResponses: number;
      groups: {
        unitName: string;
        unitAlias: string | null;
        variableId: string;
        normalizedValue: string;
        originalValue: string;
        occurrences: {
          personLogin: string;
          personCode: string;
          bookletName: string;
          responseId: number;
          value: string;
        }[];
      }[];
    };
    matchingFlags: string[];
    analysisTimestamp: string;
  }> {
    return this.http
      .get<{
      emptyResponses: {
        total: number;
        items: {
          unitName: string;
          unitAlias: string | null;
          variableId: string;
          personLogin: string;
          personCode: string;
          bookletName: string;
          responseId: number;
        }[];
      };
      duplicateValues: {
        total: number;
        totalResponses: number;
        groups: {
          unitName: string;
          unitAlias: string | null;
          variableId: string;
          normalizedValue: string;
          originalValue: string;
          occurrences: {
            personLogin: string;
            personCode: string;
            bookletName: string;
            responseId: number;
            value: string;
          }[];
        }[];
      };
      matchingFlags: string[];
      analysisTimestamp: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/response-analysis`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          emptyResponses: { total: 0, items: [] },
          duplicateValues: { total: 0, totalResponses: 0, groups: [] },
          matchingFlags: [],
          analysisTimestamp: new Date().toISOString()
        }))
      );
  }

  applyEmptyResponseCoding(workspaceId: number): Observable<{
    success: boolean;
    updatedCount: number;
    message: string;
  }> {
    return this.http
      .post<{
      success: boolean;
      updatedCount: number;
      message: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/apply-empty-responses`,
      {},
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          success: false,
          updatedCount: 0,
          message: 'Fehler beim Anwenden der Kodierung'
        }))
      );
  }

  getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50
  ): Observable<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: string;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http
      .get<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: string;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          data: [],
          total: 0,
          page,
          limit
        }))
      );
  }

  applyDoubleCodedResolutions(
    workspaceId: number,
    dto: { decisions: Array<{ responseId: number; selectedJobId: number; resolutionComment?: string }> }
  ): Observable<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
    }> {
    return this.http
      .post<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/apply-resolutions`,
      dto,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          success: false,
          appliedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          message: 'Failed to apply resolutions'
        }))
      );
  }

  getCohensKappaStatistics(
    workspaceId: number,
    unitName?: string,
    variableId?: string
  ): Observable<{
      variables: Array<{
        unitName: string;
        variableId: string;
        coderPairs: Array<{
          coder1Id: number;
          coder1Name: string;
          coder2Id: number;
          coder2Name: string;
          kappa: number | null;
          agreement: number;
          totalItems: number;
          validPairs: number;
          interpretation: string;
        }>;
      }>;
      workspaceSummary: {
        totalDoubleCodedResponses: number;
        totalCoderPairs: number;
        averageKappa: number | null;
        variablesIncluded: number;
        codersIncluded: number;
      };
    }> {
    let params = new HttpParams();

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }

    return this.http
      .get<{
      variables: Array<{
        unitName: string;
        variableId: string;
        coderPairs: Array<{
          coder1Id: number;
          coder1Name: string;
          coder2Id: number;
          coder2Name: string;
          kappa: number | null;
          agreement: number;
          totalItems: number;
          validPairs: number;
          interpretation: string;
        }>;
      }>;
      workspaceSummary: {
        totalDoubleCodedResponses: number;
        totalCoderPairs: number;
        averageKappa: number | null;
        variablesIncluded: number;
        codersIncluded: number;
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          variables: [],
          workspaceSummary: {
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            variablesIncluded: 0,
            codersIncluded: 0
          }
        }))
      );
  }

  getWorkspaceCohensKappaSummary(
    workspaceId: number
  ): Observable<{
      coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        kappa: number | null;
        agreement: number;
        totalSharedResponses: number;
        validPairs: number;
        interpretation: string;
      }>;
      workspaceSummary: {
        totalDoubleCodedResponses: number;
        totalCoderPairs: number;
        averageKappa: number | null;
        variablesIncluded: number;
        codersIncluded: number;
      };
    }> {
    return this.http
      .get<{
      coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        kappa: number | null;
        agreement: number;
        totalSharedResponses: number;
        validPairs: number;
        interpretation: string;
      }>;
      workspaceSummary: {
        totalDoubleCodedResponses: number;
        totalCoderPairs: number;
        averageKappa: number | null;
        variablesIncluded: number;
        codersIncluded: number;
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/workspace-summary`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          coderPairs: [],
          workspaceSummary: {
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            variablesIncluded: 0,
            codersIncluded: 0
          }
        }))
      );
  }
}
