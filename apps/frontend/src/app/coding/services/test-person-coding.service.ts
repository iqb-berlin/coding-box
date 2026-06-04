import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  Observable,
  Subject,
  catchError,
  of,
  throwError
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { suppressGlobalHttpErrorContext } from '../../core/interceptors/http-error-context';
import { ExpectedCombinationDto } from '../../../../../../api-dto/coding/expected-combination.dto';
import {
  ValidateCodingCompletenessResponseDto
} from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  ValidateCodingCompletenessRequestDto
} from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';
import { ExternalCodingImportResultDto } from '../../../../../../api-dto/coding/external-coding-import-result.dto';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import {
  CodingFreshnessJobResultDto,
  CodingFreshnessScopeDto,
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessVersion,
  StartCodingFreshnessJobDto
} from '../../../../../../api-dto/coding/coding-freshness.dto';
import { AutocodingReadinessDto } from '../../../../../../api-dto/coding/autocoding-readiness.dto';
import { ResponseMatchingFlag } from '../../ws-admin/services/workspace-settings.service';

interface ExternalCodingImportWithPreviewDto {
  file: string;
  fileName?: string;
  previewOnly?: boolean;
  sourceFormat?: 'external-coding' | 'coding-list' | 'coding-results';
  sourceVersion?: 'v1' | 'v2' | 'v3';
  scoreMode?: 'import' | 'derive';
  existingCodingMode?: 'skip-conflicts' | 'fill-empty' | 'overwrite';
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

export interface CohensKappaCoderPair {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  kappa: number | null;
  agreement: number;
  totalItems: number;
  validPairs: number;
  interpretation: string;
}

export interface CohensKappaVariableSummary {
  unitName: string;
  variableId: string;
  meanKappa: number | null;
  meanAgreement: number | null;
  caseCount: number;
  doubleCodedCount: number;
  doubleCodedRate: number | null;
  validPairCount: number;
  coderPairCount: number;
  coderPairs: CohensKappaCoderPair[];
}

export interface CohensKappaStatisticsResponse {
  variables: CohensKappaVariableSummary[];
  workspaceSummary: {
    totalCodedResponses: number;
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    meanAgreement: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: 'weighted' | 'unweighted';
  };
}

export interface AggregationSettingsResponse {
  success: boolean;
  threshold: number;
  flags: ResponseMatchingFlag[];
  aggregationActive: boolean;
  revertedResponses: number;
  message: string;
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
  source?: 'manual-selection' | 'coding-freshness';
  freshnessVersion?: 'v1' | 'v3';
  freshnessStates?: ('PENDING' | 'STALE')[];
  unitCount?: number;
}

export interface JobInfo extends JobStatus {
  jobId: string;
}

export interface WorkspaceGroupCodingStats {
  groupName: string;
  testPersonCount: number;
  responsesToCode: number;
}

export interface CaseCoverageOverview {
  totalCasesToCode: number;
  effectiveTotalCasesToCode: number;
  casesInJobs: number;
  effectiveCasesInJobs: number;
  doubleCodedCases: number;
  singleCodedCases: number;
  unassignedCases: number;
  effectiveUnassignedCases: number;
  coveragePercentage: number;
  rawCoveragePercentage: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
  statusTotalCasesToCode?: number;
  coveredSourceVariableCount?: number;
  coveredSourceResponseCount?: number;
}

export interface CodingProgressOverview {
  totalCasesToCode: number;
  completedCases: number;
  completionPercentage: number;
  rawTotalCasesToCode: number;
  rawCompletedCases: number;
  rawCompletionPercentage: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
  statusTotalCasesToCode?: number;
  coveredSourceVariableCount?: number;
  coveredSourceResponseCount?: number;
}

export interface AppliedResultsOverview {
  totalIncompleteResponses: number;
  appliedResponses: number;
  remainingResponses: number;
  completionPercentage: number;
  rawTotalIncompleteResponses: number;
  rawAppliedResponses: number;
  rawCompletionPercentage: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
  statusTotalIncompleteResponses?: number;
  coveredSourceVariableCount?: number;
  coveredSourceResponseCount?: number;
  deriveErrorTotalResponses?: number;
  deriveErrorAppliedResponses?: number;
  deriveErrorRemainingResponses?: number;
  deriveErrorRawTotalResponses?: number;
  deriveErrorRawAppliedResponses?: number;
}

@Injectable({
  providedIn: 'root'
})
export class TestPersonCodingService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private autoCodingCompletedSubject = new Subject<void>();
  private testResultsChangedSubject = new Subject<void>();
  autoCodingCompleted$ = this.autoCodingCompletedSubject.asObservable();
  testResultsChanged$ = this.testResultsChangedSubject.asObservable();

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  private hasJobId(jobId: string | null | undefined): jobId is string {
    return typeof jobId === 'string' && jobId.trim().length > 0;
  }

  notifyAutoCodingCompleted(): void {
    this.autoCodingCompletedSubject.next();
  }

  notifyTestResultsChanged(): void {
    this.testResultsChangedSubject.next();
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
        catchError(error => of({
          totalResponses: 0,
          statusCounts: {},
          message: this.extractBackendErrorMessage(error)
        }))
      );
  }

  getManualTestPersons(workspaceId: number, testPersonIds?: string, codedStatus?: string): Observable<unknown> {
    let params = new HttpParams();
    if (testPersonIds) {
      params = params.set('testPersons', testPersonIds);
    }
    if (codedStatus) {
      params = params.set('codedStatus', codedStatus);
    }

    return this.http
      .get<unknown>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/manual`,
      { headers: this.authHeader, params }
    )
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

  private extractBackendErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const responseMessage = error.error?.message;
      if (Array.isArray(responseMessage)) {
        return responseMessage.join(' ');
      }
      if (typeof responseMessage === 'string' && responseMessage.trim() !== '') {
        return responseMessage;
      }
      if (typeof error.error === 'string' && error.error.trim() !== '') {
        return error.error;
      }
    }

    if (error instanceof Error && error.message.trim() !== '') {
      return error.message;
    }

    return 'Failed to start test persons coding';
  }

  getJobStatus(workspaceId: number, jobId: string): Observable<JobStatus | { error: string }> {
    if (!this.hasJobId(jobId)) {
      return of({ error: 'Fehlende Job-ID für Statusabfrage' });
    }

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
    if (!this.hasJobId(jobId)) {
      return of({ success: false, message: 'Fehlende Job-ID für Abbruch' });
    }

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
    if (!this.hasJobId(jobId)) {
      return of({ success: false, message: 'Fehlende Job-ID für Löschung' });
    }

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

  getCodingFreshness(workspaceId: number): Observable<CodingFreshnessSummaryDto> {
    return this.http
      .get<CodingFreshnessSummaryDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/freshness`,
      {
        headers: this.authHeader,
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        catchError(() => of({
          workspaceId,
          currentRevision: 0,
          items: []
        }))
      );
  }

  getAutocodingReadiness(
    workspaceId: number,
    autoCoderRun: 1 | 2 = 1,
    forceRefresh = false
  ): Observable<AutocodingReadinessDto> {
    let params = new HttpParams().set('autoCoderRun', autoCoderRun.toString());
    if (forceRefresh) {
      params = params.set('forceRefresh', 'true');
    }

    return this.http
      .get<AutocodingReadinessDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/readiness`,
      {
        headers: this.authHeader,
        params,
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        catchError(error => throwError(() => error))
      );
  }

  getCodingFreshnessScope(
    workspaceId: number,
    version?: 'v1' | 'v2' | 'v3',
    states?: ('PENDING' | 'STALE' | 'MANUAL_REVIEW_REQUIRED')[]
  ): Observable<CodingFreshnessScopeDto> {
    let params = new HttpParams();
    if (version) {
      params = params.set('version', version);
    }
    if (states && states.length > 0) {
      params = params.set('state', states.join(','));
    }

    return this.http
      .get<CodingFreshnessScopeDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/freshness/scope`,
      {
        headers: this.authHeader,
        params,
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        catchError(() => {
          const fallback: CodingFreshnessScopeDto = {
            workspaceId,
            currentRevision: 0,
            versions: version ?
              [version] :
              (['v1', 'v2', 'v3'] as CodingFreshnessVersion[]),
            states: states || ([
              'PENDING',
              'STALE',
              'MANUAL_REVIEW_REQUIRED'
            ] as CodingFreshnessState[]),
            unitCount: 0,
            personCount: 0,
            groupCount: 0,
            affectedResponseCount: 0,
            unitIds: [],
            personIds: [],
            groupNames: [],
            groups: []
          };
          return of(fallback);
        })
      );
  }

  startFreshnessCoding(
    workspaceId: number,
    request: StartCodingFreshnessJobDto
  ): Observable<CodingFreshnessJobResultDto> {
    return this.http
      .post<CodingFreshnessJobResultDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/freshness/code`,
      request,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          totalResponses: 0,
          statusCounts: {},
          message: 'Failed to start coding freshness job',
          unitCount: 0,
          personCount: 0,
          groupNames: []
        }))
      );
  }

  restartJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string; jobId?: string }> {
    if (!this.hasJobId(jobId)) {
      return of({ success: false, message: 'Fehlende Job-ID für Neustart' });
    }

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
        catchError(error => throwError(() => error))
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

  startExternalCodingImportJob(
    workspaceId: number,
    data: {
      file: string;
      fileName?: string;
      sourceFormat?: 'external-coding' | 'coding-list' | 'coding-results';
      sourceVersion?: 'v1' | 'v2' | 'v3';
      scoreMode?: 'import' | 'derive';
      existingCodingMode?: 'skip-conflicts' | 'fill-empty' | 'overwrite';
    }
  ): Observable<{ jobId: string }> {
    return this.http
      .post<{ jobId: string }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/external-coding-import/apply`,
      {
        file: data.file,
        fileName: data.fileName,
        sourceFormat: data.sourceFormat,
        sourceVersion: data.sourceVersion,
        scoreMode: data.scoreMode,
        existingCodingMode: data.existingCodingMode
      },
      { headers: this.authHeader }
    );
  }

  getExternalCodingImportJobStatus(
    workspaceId: number,
    jobId: string
  ): Observable<{
      status: string;
      progress: number;
      result?: {
        message: string;
        processedRows: number;
        updatedRows: number;
        errorCount: number;
        affectedRowCount: number;
      };
      error?: string;
    }> {
    return this.http
      .get<{
      status: string;
      progress: number;
      result?: {
        message: string;
        processedRows: number;
        updatedRows: number;
        errorCount: number;
        affectedRowCount: number;
      };
      error?: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/external-coding-import/job/${jobId}`,
      { headers: this.authHeader }
    );
  }

  getExternalCodingImportResult(
    workspaceId: number,
    jobId: string
  ): Observable<ExternalCodingImportResultDto> {
    return this.http
      .get<ExternalCodingImportResultDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/external-coding-import/job/${jobId}/result`,
      { headers: this.authHeader }
    );
  }

  getCodingProgressOverview(workspaceId: number): Observable<CodingProgressOverview | null> {
    return this.http
      .get<CodingProgressOverview>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/progress-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of(null))
      );
  }

  getAppliedResultsOverview(workspaceId: number): Observable<AppliedResultsOverview | null> {
    return this.http
      .get<AppliedResultsOverview>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/applied-results-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of(null))
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
    statusTotalVariables?: number;
    coveredSourceVariableCount?: number;
    coveredSourceResponseCount?: number;
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
      statusTotalVariables?: number;
      coveredSourceVariableCount?: number;
      coveredSourceResponseCount?: number;
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
          },
          statusTotalVariables: 0,
          coveredSourceVariableCount: 0,
          coveredSourceResponseCount: 0
        }))
      );
  }

  getCaseCoverageOverview(workspaceId: number): Observable<CaseCoverageOverview> {
    return this.http
      .get<CaseCoverageOverview>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/case-coverage-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          totalCasesToCode: 0,
          effectiveTotalCasesToCode: 0,
          casesInJobs: 0,
          effectiveCasesInJobs: 0,
          doubleCodedCases: 0,
          singleCodedCases: 0,
          unassignedCases: 0,
          effectiveUnassignedCases: 0,
          coveragePercentage: 0,
          rawCoveragePercentage: 0,
          aggregationActive: false,
          aggregationThreshold: null,
          aggregatedDuplicateCases: 0,
          statusTotalCasesToCode: 0,
          coveredSourceVariableCount: 0,
          coveredSourceResponseCount: 0
        }))
      );
  }

  getResponseAnalysis(
    workspaceId: number,
    threshold?: number,
    emptyPage?: number,
    emptyLimit?: number,
    duplicatePage?: number,
    duplicateLimit?: number
  ): Observable<ResponseAnalysisDto> {
    let params = new HttpParams();
    if (threshold) {
      params = params.set('threshold', threshold.toString());
    }
    if (emptyPage) params = params.set('emptyPage', emptyPage.toString());
    if (emptyLimit) params = params.set('emptyLimit', emptyLimit.toString());
    if (duplicatePage) {
      params = params.set('duplicatePage', duplicatePage.toString());
    }
    if (duplicateLimit) {
      params = params.set('duplicateLimit', duplicateLimit.toString());
    }

    return this.http
      .get<ResponseAnalysisDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/response-analysis`,
      { headers: this.authHeader, params }
    );
  }

  getAggregationSettings(workspaceId: number): Observable<AggregationSettingsResponse> {
    return this.http.get<AggregationSettingsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/aggregation-settings`,
      { headers: this.authHeader }
    );
  }

  saveAggregationSettings(
    workspaceId: number,
    threshold: number,
    flags: ResponseMatchingFlag[]
  ): Observable<AggregationSettingsResponse> {
    return this.http.post<AggregationSettingsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/aggregation-settings`,
      { threshold, flags },
      { headers: this.authHeader }
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

  applyDuplicateAggregation(
    workspaceId: number,
    threshold: number,
    aggregateMode: boolean
  ): Observable<{
      success: boolean;
      aggregatedGroups: number;
      aggregatedResponses: number;
      uniqueCodingCases: number;
      message: string;
    }> {
    return this.http
      .post<{
      success: boolean;
      aggregatedGroups: number;
      aggregatedResponses: number;
      uniqueCodingCases: number;
      message: string;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/apply-duplicate-aggregation`,
      { threshold, aggregateMode },
      { headers: this.authHeader }
    )
      .pipe(
        catchError(() => of({
          success: false,
          aggregatedGroups: 0,
          aggregatedResponses: 0,
          uniqueCodingCases: 0,
          message: 'Fehler beim Anwenden der Aggregation'
        }))
      );
  }

  getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50,
    onlyConflicts: boolean = false,
    excludeTrainings: boolean = false,
    search?: string,
    coderId?: number,
    statusFilter?: string,
    resolvedFilter?: string,
    agreementFilter?: 'all' | 'match' | 'differ',
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[]
  ): Observable<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        isResolved: boolean;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          score: number | null;
          notes: string | null;
          supervisorComment: string | null;
          codedAt: string;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString())
      .set('onlyConflicts', onlyConflicts.toString())
      .set('excludeTrainings', excludeTrainings.toString());

    if (search && search.trim() !== '') {
      params = params.set('search', search.trim());
    }

    if (coderId) {
      params = params.set('coderId', coderId.toString());
    }

    if (statusFilter && statusFilter !== 'all') {
      params = params.set('statusFilter', statusFilter);
    }

    if (resolvedFilter && resolvedFilter !== 'all') {
      params = params.set('resolvedFilter', resolvedFilter);
    }

    if (agreementFilter && agreementFilter !== 'all') {
      params = params.set('agreementFilter', agreementFilter);
    }

    if (jobDefinitionIds?.length) {
      params = params.set('jobDefinitionIds', jobDefinitionIds.join(','));
    }

    if (coderTrainingIds?.length) {
      params = params.set('coderTrainingIds', coderTrainingIds.join(','));
    }

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
        isResolved: boolean;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          score: number | null;
          notes: string | null;
          supervisorComment: string | null;
          codedAt: string;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review`,
      { headers: this.authHeader, params }
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
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string
  ): Observable<CohensKappaStatisticsResponse> {
    let params = new HttpParams();

    params = params.set('weightedMean', weightedMean.toString());
    params = params.set('excludeTrainings', excludeTrainings.toString());

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }

    return this.http
      .get<CohensKappaStatisticsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          variables: [],
          workspaceSummary: {
            totalCodedResponses: 0,
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            meanAgreement: null,
            variablesIncluded: 0,
            codersIncluded: 0,
            weightingMethod: 'weighted' as 'weighted' | 'unweighted'
          }
        }))
      );
  }

  exportCohensKappaSummaryAsCsv(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId
    );

    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/export/summary/csv`,
        {
          headers: this.authHeader,
          params,
          responseType: 'blob',
          context: suppressGlobalHttpErrorContext()
        }
      );
  }

  exportCohensKappaStatisticsAsXlsx(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId
    );

    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/export/xlsx`,
        {
          headers: this.authHeader,
          params,
          responseType: 'blob',
          context: suppressGlobalHttpErrorContext()
        }
      );
  }

  exportCohensKappaStatisticsAsCsv(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId
    );

    return this.http
      .get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/export/csv`,
        {
          headers: this.authHeader,
          params,
          responseType: 'blob',
          context: suppressGlobalHttpErrorContext()
        }
      );
  }

  private buildCohensKappaExportParams(
    weightedMean: boolean,
    excludeTrainings: boolean,
    unitName?: string,
    variableId?: string
  ): HttpParams {
    let params = new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('excludeTrainings', excludeTrainings.toString());

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }

    return params;
  }

  getWorkspaceCohensKappaSummary(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true
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
        weightingMethod: 'weighted' | 'unweighted';
      };
    }> {
    const params = new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('excludeTrainings', excludeTrainings.toString());
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
        weightingMethod: 'weighted' | 'unweighted';
      };
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/workspace-summary`,
      { headers: this.authHeader, params }
    )
      .pipe(
        catchError(() => of({
          coderPairs: [],
          workspaceSummary: {
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            variablesIncluded: 0,
            codersIncluded: 0,
            weightingMethod: 'weighted' as 'weighted' | 'unweighted'
          }
        }))
      );
  }
}
