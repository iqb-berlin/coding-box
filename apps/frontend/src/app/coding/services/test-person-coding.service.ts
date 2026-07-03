import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  finalize,
  of,
  shareReplay,
  tap,
  throwError
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { suppressGlobalHttpErrorContext } from '../../core/interceptors/http-error-context';
import { AuthService } from '../../core/services/auth.service';
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
import { CodingBackgroundJobsService } from './coding-background-jobs.service';

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

export interface DoubleCodedResolutionDecision {
  responseId: number;
  selectedJobId?: number;
  code?: number;
  score?: number | null;
  resolutionComment?: string;
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
    calculationLevel?: CohensKappaCalculationLevel;
  };
}

export type CohensKappaCalculationLevel = 'code' | 'score';

export interface CohensKappaScope {
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
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

export interface AutoCodingCompletedEvent {
  jobId?: string;
}

export type CodingStatisticsVersion = 'v1' | 'v2' | 'v3';

export interface TestResultsChangedEvent {
  workspaceId?: number;
  statisticsVersion?: CodingStatisticsVersion;
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
  private authService = inject(AuthService);
  private codingBackgroundJobsService = inject(CodingBackgroundJobsService);
  private autoCodingCompletedSubject = new Subject<AutoCodingCompletedEvent>();
  private testResultsChangedSubject = new Subject<TestResultsChangedEvent>();
  private pendingStatisticsVersions = new Map<number, CodingStatisticsVersion>();
  private codingFreshnessCache = new Map<number, CodingFreshnessSummaryDto>();
  private codingFreshnessRequests = new Map<number, Observable<CodingFreshnessSummaryDto>>();
  private autocodingReadinessCache = new Map<string, AutocodingReadinessDto>();
  private autocodingReadinessRequests = new Map<string, Observable<AutocodingReadinessDto>>();
  private codingFreshnessScopeCache = new Map<string, CodingFreshnessScopeDto>();
  private codingFreshnessScopeRequests = new Map<string, Observable<CodingFreshnessScopeDto>>();
  private appliedResultsOverviewCache = new Map<number, AppliedResultsOverview | null>();
  private appliedResultsOverviewRequests = new Map<number, Observable<AppliedResultsOverview | null>>();
  private responseAnalysisGuardPollTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private responseAnalysisGuardThresholds = new Map<number, number | undefined>();
  private freshnessCodingGuardPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly responseAnalysisGuardPollIntervalMs = 5000;
  private readonly freshnessCodingGuardPollIntervalMs = 5000;
  private readonly responseAnalysisGuardJobId = 'manual-response-analysis';
  private codingStatusCacheGeneration = 0;
  autoCodingCompleted$ = this.autoCodingCompletedSubject.asObservable();
  testResultsChanged$ = this.testResultsChangedSubject.asObservable();

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
  }

  private async getValidAuthToken(): Promise<string | undefined> {
    return this.authService.getValidToken();
  }

  private hasJobId(jobId: string | null | undefined): jobId is string {
    return typeof jobId === 'string' && jobId.trim().length > 0;
  }

  private deleteCacheKeysForWorkspace<T>(cache: Map<string, T>, workspaceId: number): void {
    const workspacePrefix = `${workspaceId}:`;
    Array.from(cache.keys())
      .filter(key => key.startsWith(workspacePrefix))
      .forEach(key => cache.delete(key));
  }

  notifyAutoCodingCompleted(jobId?: string): void {
    this.invalidateCodingStatusCache();
    this.autoCodingCompletedSubject.next({ jobId });
  }

  notifyTestResultsChanged(event: TestResultsChangedEvent = {}): void {
    this.invalidateCodingStatusCache(event.workspaceId);
    if (event.workspaceId && event.statisticsVersion) {
      this.pendingStatisticsVersions.set(event.workspaceId, event.statisticsVersion);
    }
    this.testResultsChangedSubject.next(event);
  }

  consumePendingStatisticsVersion(workspaceId: number): CodingStatisticsVersion | null {
    const version = this.pendingStatisticsVersions.get(workspaceId) ?? null;
    this.pendingStatisticsVersions.delete(workspaceId);
    return version;
  }

  invalidateCodingStatusCache(workspaceId?: number): void {
    this.codingStatusCacheGeneration += 1;
    if (!workspaceId) {
      this.codingFreshnessCache.clear();
      this.codingFreshnessRequests.clear();
      this.autocodingReadinessCache.clear();
      this.autocodingReadinessRequests.clear();
      this.codingFreshnessScopeCache.clear();
      this.codingFreshnessScopeRequests.clear();
      this.appliedResultsOverviewCache.clear();
      this.appliedResultsOverviewRequests.clear();
      return;
    }

    this.codingFreshnessCache.delete(workspaceId);
    this.codingFreshnessRequests.delete(workspaceId);
    this.appliedResultsOverviewCache.delete(workspaceId);
    this.appliedResultsOverviewRequests.delete(workspaceId);
    this.deleteCacheKeysForWorkspace(this.autocodingReadinessCache, workspaceId);
    this.deleteCacheKeysForWorkspace(this.autocodingReadinessRequests, workspaceId);
    this.deleteCacheKeysForWorkspace(this.codingFreshnessScopeCache, workspaceId);
    this.deleteCacheKeysForWorkspace(this.codingFreshnessScopeRequests, workspaceId);
  }

  private createCodingFreshnessFallback(workspaceId: number): CodingFreshnessSummaryDto {
    return {
      workspaceId,
      currentRevision: 0,
      items: []
    };
  }

  private createAutocodingReadinessFallback(
    workspaceId: number,
    autoCoderRun: 1 | 2
  ): AutocodingReadinessDto {
    return {
      workspaceId,
      autoCoderRun,
      readiness: 'NO_RESULTS',
      blockers: [],
      rawResponsesTotal: 0,
      rawResponsesWithRelevantStatus: 0,
      resultUnitsTotal: 0,
      resultUnitKeysTotal: 0,
      matchedUnitFiles: 0,
      missingUnitFiles: [],
      matchedCodingSchemes: 0,
      missingCodingSchemes: [],
      invalidCodingSchemes: [],
      validVariablePairs: 0,
      validResponses: 0,
      codeableResponses: 0,
      invalidVariableSamples: []
    };
  }

  private createCodingFreshnessScopeFallback(
    workspaceId: number,
    version?: CodingFreshnessVersion,
    states?: CodingFreshnessState[]
  ): CodingFreshnessScopeDto {
    return {
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
    const cached = this.codingFreshnessCache.get(workspaceId);
    if (this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId)) {
      return of(cached || this.createCodingFreshnessFallback(workspaceId));
    }

    if (cached) {
      return of(cached);
    }

    const pendingRequest = this.codingFreshnessRequests.get(workspaceId);
    if (pendingRequest) {
      return pendingRequest;
    }

    const requestGeneration = this.codingStatusCacheGeneration;
    const request$ = this.http
      .get<CodingFreshnessSummaryDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/freshness`,
      {
        headers: this.authHeader,
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        tap(summary => {
          if (this.codingStatusCacheGeneration === requestGeneration) {
            this.codingFreshnessCache.set(workspaceId, summary);
          }
        }),
        catchError(() => of(this.createCodingFreshnessFallback(workspaceId))),
        finalize(() => {
          if (this.codingFreshnessRequests.get(workspaceId) === request$) {
            this.codingFreshnessRequests.delete(workspaceId);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.codingFreshnessRequests.set(workspaceId, request$);
    return request$;
  }

  getAutocodingReadiness(
    workspaceId: number,
    autoCoderRun: 1 | 2 = 1,
    forceRefresh = false
  ): Observable<AutocodingReadinessDto> {
    const cacheKey = `${workspaceId}:${autoCoderRun}`;
    const cached = this.autocodingReadinessCache.get(cacheKey);
    if (this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId)) {
      return of(cached || this.createAutocodingReadinessFallback(workspaceId, autoCoderRun));
    }

    if (!forceRefresh) {
      if (cached) {
        return of(cached);
      }

      const pendingRequest = this.autocodingReadinessRequests.get(cacheKey);
      if (pendingRequest) {
        return pendingRequest;
      }
    }

    let params = new HttpParams().set('autoCoderRun', autoCoderRun.toString());
    if (forceRefresh) {
      params = params.set('forceRefresh', 'true');
    }

    const requestGeneration = this.codingStatusCacheGeneration;
    const request$ = this.http
      .get<AutocodingReadinessDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/readiness`,
      {
        headers: this.authHeader,
        params,
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        tap(readiness => {
          if (
            this.codingStatusCacheGeneration === requestGeneration &&
            this.autocodingReadinessRequests.get(cacheKey) === request$
          ) {
            this.autocodingReadinessCache.set(cacheKey, readiness);
          }
        }),
        catchError(error => throwError(() => error)),
        finalize(() => {
          if (this.autocodingReadinessRequests.get(cacheKey) === request$) {
            this.autocodingReadinessRequests.delete(cacheKey);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.autocodingReadinessRequests.set(cacheKey, request$);
    return request$;
  }

  getCodingFreshnessScope(
    workspaceId: number,
    version?: 'v1' | 'v2' | 'v3',
    states?: ('PENDING' | 'STALE' | 'MANUAL_REVIEW_REQUIRED')[]
  ): Observable<CodingFreshnessScopeDto> {
    const cacheKey = [
      workspaceId,
      version || 'all',
      states?.join(',') || 'all'
    ].join(':');
    const cached = this.codingFreshnessScopeCache.get(cacheKey);
    if (this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId)) {
      return of(cached || this.createCodingFreshnessScopeFallback(workspaceId, version, states));
    }

    if (cached) {
      return of(cached);
    }

    const pendingRequest = this.codingFreshnessScopeRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    let params = new HttpParams();
    if (version) {
      params = params.set('version', version);
    }
    if (states && states.length > 0) {
      params = params.set('state', states.join(','));
    }

    const requestGeneration = this.codingStatusCacheGeneration;
    const request$ = this.http
      .get<CodingFreshnessScopeDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/freshness/scope`,
      {
        headers: this.authHeader,
        params,
        context: suppressGlobalHttpErrorContext()
      }
    )
      .pipe(
        tap(scope => {
          if (this.codingStatusCacheGeneration === requestGeneration) {
            this.codingFreshnessScopeCache.set(cacheKey, scope);
          }
        }),
        catchError(() => of(this.createCodingFreshnessScopeFallback(workspaceId, version, states))),
        finalize(() => {
          if (this.codingFreshnessScopeRequests.get(cacheKey) === request$) {
            this.codingFreshnessScopeRequests.delete(cacheKey);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.codingFreshnessScopeRequests.set(cacheKey, request$);
    return request$;
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
      const token = await this.getValidAuthToken();
      const response = await fetch(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/external-coding-import/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
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
    if (this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId)) {
      return this.appliedResultsOverviewCache.has(workspaceId) ?
        of(this.appliedResultsOverviewCache.get(workspaceId) ?? null) :
        of(null);
    }

    if (this.appliedResultsOverviewCache.has(workspaceId)) {
      return of(this.appliedResultsOverviewCache.get(workspaceId) ?? null);
    }

    const pendingRequest = this.appliedResultsOverviewRequests.get(workspaceId);
    if (pendingRequest) {
      return pendingRequest;
    }

    const requestGeneration = this.codingStatusCacheGeneration;
    const request$ = this.http
      .get<AppliedResultsOverview>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/applied-results-overview`,
      { headers: this.authHeader }
    )
      .pipe(
        tap(overview => {
          if (this.codingStatusCacheGeneration === requestGeneration) {
            this.appliedResultsOverviewCache.set(workspaceId, overview);
          }
        }),
        catchError(() => of(null)),
        finalize(() => {
          if (this.appliedResultsOverviewRequests.get(workspaceId) === request$) {
            this.appliedResultsOverviewRequests.delete(workspaceId);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.appliedResultsOverviewRequests.set(workspaceId, request$);
    return request$;
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

  setResponseAnalysisGuardRunning(
    workspaceId: number | null | undefined,
    isRunning: boolean
  ): void {
    if (!workspaceId) {
      return;
    }

    if (!isRunning) {
      this.clearResponseAnalysisGuardPolling(workspaceId);
    }

    this.codingBackgroundJobsService.setJobRunning(
      workspaceId,
      'response-analysis',
      isRunning,
      this.responseAnalysisGuardJobId
    );
  }

  trackResponseAnalysisGuardUntilComplete(
    workspaceId: number | null | undefined,
    threshold?: number
  ): void {
    if (!workspaceId) {
      return;
    }

    this.responseAnalysisGuardThresholds.set(workspaceId, threshold);
    this.setResponseAnalysisGuardRunning(workspaceId, true);
    this.scheduleResponseAnalysisGuardPoll(workspaceId);
  }

  private scheduleResponseAnalysisGuardPoll(workspaceId: number): void {
    if (this.responseAnalysisGuardPollTimers.has(workspaceId)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      this.responseAnalysisGuardPollTimers.delete(workspaceId);
      this.pollResponseAnalysisGuard(workspaceId);
    }, this.responseAnalysisGuardPollIntervalMs);
    this.responseAnalysisGuardPollTimers.set(workspaceId, timeoutId);
  }

  private pollResponseAnalysisGuard(workspaceId: number): void {
    const threshold = this.responseAnalysisGuardThresholds.get(workspaceId);
    this.getResponseAnalysis(workspaceId, threshold)
      .pipe(catchError(() => {
        this.scheduleResponseAnalysisGuardPoll(workspaceId);
        return EMPTY;
      }))
      .subscribe(analysis => {
        if (analysis?.isCalculating === true) {
          this.scheduleResponseAnalysisGuardPoll(workspaceId);
          return;
        }

        this.invalidateCodingStatusCache(workspaceId);
        this.setResponseAnalysisGuardRunning(workspaceId, false);
      });
  }

  private clearResponseAnalysisGuardPolling(workspaceId: number): void {
    const timeoutId = this.responseAnalysisGuardPollTimers.get(workspaceId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.responseAnalysisGuardPollTimers.delete(workspaceId);
    }
    this.responseAnalysisGuardThresholds.delete(workspaceId);
  }

  setFreshnessCodingGuardRunning(
    workspaceId: number | null | undefined,
    jobId: string | null | undefined,
    isRunning: boolean
  ): void {
    if (!workspaceId || !jobId) {
      return;
    }

    if (!isRunning) {
      this.clearFreshnessCodingGuardPolling(workspaceId, jobId);
    }

    this.codingBackgroundJobsService.setJobRunning(
      workspaceId,
      'freshness-coding',
      isRunning,
      jobId
    );
  }

  trackFreshnessCodingGuardUntilComplete(
    workspaceId: number | null | undefined,
    jobId: string | null | undefined
  ): void {
    if (!workspaceId || !jobId) {
      return;
    }

    this.setFreshnessCodingGuardRunning(workspaceId, jobId, true);
    this.scheduleFreshnessCodingGuardPoll(workspaceId, jobId);
  }

  private scheduleFreshnessCodingGuardPoll(
    workspaceId: number,
    jobId: string
  ): void {
    const pollKey = this.createFreshnessCodingGuardPollKey(workspaceId, jobId);
    if (this.freshnessCodingGuardPollTimers.has(pollKey)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      this.freshnessCodingGuardPollTimers.delete(pollKey);
      this.pollFreshnessCodingGuard(workspaceId, jobId);
    }, this.freshnessCodingGuardPollIntervalMs);
    this.freshnessCodingGuardPollTimers.set(pollKey, timeoutId);
  }

  private pollFreshnessCodingGuard(
    workspaceId: number,
    jobId: string
  ): void {
    this.getJobStatus(workspaceId, jobId)
      .pipe(catchError(() => of({ error: `Failed to get status for job ${jobId}` })))
      .subscribe(status => {
        if (!('status' in status)) {
          this.scheduleFreshnessCodingGuardPoll(workspaceId, jobId);
          return;
        }

        if (!this.isTerminalCodingJobStatus(status.status)) {
          this.scheduleFreshnessCodingGuardPoll(workspaceId, jobId);
          return;
        }

        this.invalidateCodingStatusCache(workspaceId);
        this.setFreshnessCodingGuardRunning(workspaceId, jobId, false);
      });
  }

  private clearFreshnessCodingGuardPolling(
    workspaceId: number,
    jobId: string
  ): void {
    const pollKey = this.createFreshnessCodingGuardPollKey(workspaceId, jobId);
    const timeoutId = this.freshnessCodingGuardPollTimers.get(pollKey);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.freshnessCodingGuardPollTimers.delete(pollKey);
    }
  }

  private createFreshnessCodingGuardPollKey(
    workspaceId: number,
    jobId: string
  ): string {
    return `${workspaceId}:${jobId}`;
  }

  private isTerminalCodingJobStatus(status: JobStatus['status']): boolean {
    return ['completed', 'failed', 'cancelled', 'paused'].includes(status);
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
        appliedCode: number | null;
        appliedScore: number | null;
        appliedComment: string | null;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          codingIssueOption: number | null;
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
        appliedCode: number | null;
        appliedScore: number | null;
        appliedComment: string | null;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          codingIssueOption: number | null;
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
    dto: { decisions: DoubleCodedResolutionDecision[] }
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
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<CohensKappaStatisticsResponse> {
    let params = new HttpParams();

    params = params.set('weightedMean', weightedMean.toString());
    params = params.set('excludeTrainings', excludeTrainings.toString());
    params = params.set('level', calculationLevel);

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }
    params = this.appendCohensKappaScopeParams(params, scope);

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
            weightingMethod: 'weighted' as 'weighted' | 'unweighted',
            calculationLevel
          }
        }))
      );
  }

  exportCohensKappaSummaryAsCsv(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId,
      scope,
      calculationLevel
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
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId,
      scope,
      calculationLevel
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
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId,
      scope,
      calculationLevel
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
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): HttpParams {
    let params = new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('excludeTrainings', excludeTrainings.toString())
      .set('level', calculationLevel);

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }

    return this.appendCohensKappaScopeParams(params, scope);
  }

  private appendCohensKappaScopeParams(params: HttpParams, scope?: CohensKappaScope): HttpParams {
    let scopedParams = params;

    if (scope?.jobDefinitionIds?.length) {
      scopedParams = scopedParams.set('jobDefinitionIds', scope.jobDefinitionIds.join(','));
    }
    if (scope?.coderTrainingIds?.length) {
      scopedParams = scopedParams.set('coderTrainingIds', scope.coderTrainingIds.join(','));
    }
    if (scope?.coderIds?.length) {
      scopedParams = scopedParams.set('coderIds', scope.coderIds.join(','));
    }

    return scopedParams;
  }

  getWorkspaceCohensKappaSummary(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    scope?: CohensKappaScope
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
    const params = this.appendCohensKappaScopeParams(new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('excludeTrainings', excludeTrainings.toString()), scope);
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
