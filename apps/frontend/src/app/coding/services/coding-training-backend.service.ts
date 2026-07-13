import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  finalize,
  of,
  shareReplay,
  switchMap,
  tap
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { CoderTraining } from '../models/coder-training.model';
import {
  ApplyTrainingDiscussionResultsRequestDto,
  ApplyTrainingDiscussionResultsResultDto,
  TrainingDiscussionApplyPreviewDto,
  TrainingDiscussionApplySource
} from '../../../../../../api-dto/coding/training-discussion-apply.dto';
import { TrainingComparisonFreshnessDto } from '../../../../../../api-dto/coding/training-comparison-freshness.dto';
import {
  TrainingCodingComparisonPageDto,
  TrainingCodingComparisonRowDto,
  TrainingComparisonFiltersDto,
  TrainingComparisonSortBy,
  TrainingComparisonSortDirection,
  WithinTrainingCodingComparisonPageDto,
  WithinTrainingCodingComparisonRowDto
} from '../../../../../../api-dto/coding/training-comparison.dto';
import { TrainingKappaStatisticsDto } from '../../../../../../api-dto/coding/training-kappa-statistics.dto';

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

export type TrainingCodingResult = TrainingCodingComparisonRowDto;
export type WithinTrainingCodingResult = WithinTrainingCodingComparisonRowDto;

export interface TrainingComparisonQueryOptions {
  page?: number;
  limit?: number;
  sortBy?: TrainingComparisonSortBy;
  sortDirection?: TrainingComparisonSortDirection;
  filters?: TrainingComparisonFiltersDto;
  selectedCoderKeys?: string[];
  selectedJobIds?: number[];
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

interface WithinTrainingComparisonCacheEntry {
  freshness: TrainingComparisonFreshnessDto;
  pages: Map<string, WithinTrainingCodingComparisonPageDto>;
}

@Injectable({
  providedIn: 'root'
})
export class CodingTrainingBackendService {
  private readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private readonly withinTrainingComparisonCache = new Map<string, WithinTrainingComparisonCacheEntry>();
  private coderTrainingsCache = new Map<number, CoderTraining[]>();
  private coderTrainingsInFlight = new Map<number, Observable<CoderTraining[]>>();

  private get authHeader() {
    return {};
  }

  private getWithinTrainingComparisonCacheKey(workspaceId: number, trainingId: number): string {
    return `${workspaceId}:${trainingId}`;
  }

  invalidateWithinTrainingComparisonCache(workspaceId: number, trainingId?: number): void {
    if (trainingId !== undefined) {
      this.withinTrainingComparisonCache.delete(
        this.getWithinTrainingComparisonCacheKey(workspaceId, trainingId)
      );
      return;
    }

    Array.from(this.withinTrainingComparisonCache.keys())
      .filter(key => key.startsWith(`${workspaceId}:`))
      .forEach(key => this.withinTrainingComparisonCache.delete(key));
  }

  createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: {
      variableId: string;
      unitId: string;
      sampleCount: number;
      includeDeriveError?: boolean;
    }[],
    trainingLabel: string,
    missingsProfileId?: number,
    assignedVariables?: { unitName: string; variableId: string; sampleCount: number; includeDeriveError?: boolean }[],
    assignedVariableBundles?: {
      id: number;
      name: string;
      sampleCount?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      variables?: { unitName: string; variableId: string; sampleCount?: number; includeDeriveError?: boolean }[];
    }[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: 'oldest_first' | 'newest_first' | 'random' | 'random_per_testgroup' | 'random_testgroups',
    referenceTrainingIds?: number[],
    referenceMode?: 'same' | 'different',
    showScore?: boolean,
    allowComments?: boolean,
    suppressGeneralInstructions?: boolean
  ): Observable<CreateCoderTrainingJobsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-training-jobs`;
    return this.http.post<CreateCoderTrainingJobsResponse>(url, {
      trainingLabel,
      selectedCoders,
      variableConfigs,
      missingsProfileId,
      assignedVariables,
      assignedVariableBundles,
      caseOrderingMode,
      caseSelectionMode,
      referenceTrainingIds,
      referenceMode,
      showScore,
      allowComments,
      suppressGeneralInstructions
    }, { headers: this.authHeader }).pipe(
      tap(response => {
        this.invalidateCoderTrainings(workspaceId);
        if (response.trainingId) {
          this.invalidateWithinTrainingComparisonCache(workspaceId, response.trainingId);
        } else {
          this.invalidateWithinTrainingComparisonCache(workspaceId);
        }
      })
    );
  }

  getCoderTrainings(workspaceId: number): Observable<CoderTraining[]> {
    const cachedTrainings = this.coderTrainingsCache.get(workspaceId);
    if (cachedTrainings) {
      return of([...cachedTrainings]);
    }

    const inFlightRequest = this.coderTrainingsInFlight.get(workspaceId);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings`;
    const request$ = this.http.get<CoderTraining[]>(url, { headers: this.authHeader })
      .pipe(
        tap(trainings => {
          if (this.coderTrainingsInFlight.get(workspaceId) === request$) {
            this.coderTrainingsCache.set(workspaceId, [...trainings]);
          }
        }),
        finalize(() => {
          if (this.coderTrainingsInFlight.get(workspaceId) === request$) {
            this.coderTrainingsInFlight.delete(workspaceId);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    this.coderTrainingsInFlight.set(workspaceId, request$);
    return request$;
  }

  invalidateCoderTrainings(workspaceId?: number): void {
    if (workspaceId === undefined) {
      this.coderTrainingsCache.clear();
      this.coderTrainingsInFlight.clear();
      return;
    }

    this.coderTrainingsCache.delete(workspaceId);
    this.coderTrainingsInFlight.delete(workspaceId);
  }

  updateCoderTraining(
    workspaceId: number,
    trainingId: number,
    label: string,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number; includeDeriveError?: boolean }[],
    missingsProfileId?: number,
    assignedVariables?: { unitName: string; variableId: string; sampleCount: number; includeDeriveError?: boolean }[],
    assignedVariableBundles?: {
      id: number;
      name: string;
      sampleCount?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      variables?: { unitName: string; variableId: string; sampleCount?: number; includeDeriveError?: boolean }[];
    }[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: 'oldest_first' | 'newest_first' | 'random' | 'random_per_testgroup' | 'random_testgroups',
    referenceTrainingIds?: number[],
    referenceMode?: 'same' | 'different',
    showScore?: boolean,
    allowComments?: boolean,
    suppressGeneralInstructions?: boolean
  ): Observable<{ success: boolean; message: string; jobsCreated?: number }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}`;
    return this.http.put<{ success: boolean; message: string; jobsCreated?: number }>(url, {
      label,
      selectedCoders,
      variableConfigs,
      missingsProfileId,
      assignedVariables,
      assignedVariableBundles,
      caseOrderingMode,
      caseSelectionMode,
      referenceTrainingIds,
      referenceMode,
      showScore,
      allowComments,
      suppressGeneralInstructions
    }, { headers: this.authHeader }).pipe(
      tap(() => {
        this.invalidateCoderTrainings(workspaceId);
        this.invalidateWithinTrainingComparisonCache(workspaceId, trainingId);
      })
    );
  }

  deleteCoderTraining(
    workspaceId: number,
    trainingId: number
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}`;
    return this.http.delete<{ success: boolean; message: string }>(url, { headers: this.authHeader }).pipe(
      tap(() => {
        this.invalidateCoderTrainings(workspaceId);
        this.invalidateWithinTrainingComparisonCache(workspaceId, trainingId);
      })
    );
  }

  updateCoderTrainingLabel(
    workspaceId: number,
    trainingId: number,
    newLabel: string
  ): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/label`;
    return this.http.put<{ success: boolean; message: string }>(url, {
      label: newLabel
    }, { headers: this.authHeader }).pipe(
      tap(() => {
        this.invalidateCoderTrainings(workspaceId);
        this.invalidateWithinTrainingComparisonCache(workspaceId, trainingId);
      })
    );
  }

  private buildTrainingComparisonParams(
    options: TrainingComparisonQueryOptions,
    selectedParamName?: 'coderKeys' | 'jobIds'
  ): HttpParams {
    let params = new HttpParams();

    if (options.page !== undefined) {
      params = params.set('page', options.page.toString());
    }
    if (options.limit !== undefined) {
      params = params.set('limit', options.limit.toString());
    }
    if (options.sortBy) {
      params = params.set('sortBy', options.sortBy);
    }
    if (options.sortDirection) {
      params = params.set('sortDirection', options.sortDirection);
    }

    const filters = options.filters;
    if (filters) {
      if (filters.unitName) params = params.set('unitName', filters.unitName);
      if (filters.variableId) params = params.set('variableId', filters.variableId);
      if (filters.personLogin) params = params.set('personLogin', filters.personLogin);
      if (filters.personGroup) params = params.set('personGroup', filters.personGroup);
      if (filters.bookletName) params = params.set('bookletName', filters.bookletName);
      if (filters.match) params = params.set('match', filters.match);
      if (filters.notesMode) params = params.set('notesMode', filters.notesMode);
      if (filters.regexSearch !== undefined) {
        params = params.set('regexSearch', filters.regexSearch.toString());
      }
    }

    if (selectedParamName === 'coderKeys' && options.selectedCoderKeys !== undefined) {
      params = params.set('coderKeys', options.selectedCoderKeys.join(','));
    }
    if (selectedParamName === 'jobIds' && options.selectedJobIds !== undefined) {
      params = params.set('jobIds', options.selectedJobIds.join(','));
    }

    return params;
  }

  compareTrainingCodingResults(
    workspaceId: number,
    trainingIds: string,
    options: TrainingComparisonQueryOptions = {}
  ): Observable<TrainingCodingComparisonPageDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/compare-training-results`;
    const params = this.buildTrainingComparisonParams(options, 'coderKeys')
      .set('trainingIds', trainingIds);
    return this.http.get<TrainingCodingComparisonPageDto>(url, { headers: this.authHeader, params });
  }

  compareWithinTrainingCodingResults(
    workspaceId: number,
    trainingId: number,
    options: TrainingComparisonQueryOptions = {}
  ): Observable<WithinTrainingCodingComparisonPageDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/compare-within-training`;
    const params = this.buildTrainingComparisonParams(options, 'jobIds')
      .set('trainingId', trainingId.toString());
    return this.http.get<WithinTrainingCodingComparisonPageDto>(url, { headers: this.authHeader, params });
  }

  getTrainingComparisonFreshness(
    workspaceId: number,
    trainingId: number
  ): Observable<TrainingComparisonFreshnessDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/comparison-freshness`;
    return this.http.get<TrainingComparisonFreshnessDto>(url, { headers: this.authHeader });
  }

  getCachedWithinTrainingCodingResults(
    workspaceId: number,
    trainingId: number,
    options: TrainingComparisonQueryOptions = {}
  ): Observable<WithinTrainingCodingComparisonPageDto> {
    const cacheKey = this.getWithinTrainingComparisonCacheKey(workspaceId, trainingId);
    const pageCacheKey = JSON.stringify(options);

    return this.getTrainingComparisonFreshness(workspaceId, trainingId).pipe(
      catchError(() => of(null)),
      switchMap(freshness => {
        if (!freshness) {
          return this.compareWithinTrainingCodingResults(workspaceId, trainingId, options);
        }

        const cached = this.withinTrainingComparisonCache.get(cacheKey);
        const cachedPage = cached?.pages.get(pageCacheKey);
        if (cached && cached.freshness.version === freshness.version && cachedPage) {
          return of(cachedPage);
        }

        return this.compareWithinTrainingCodingResults(workspaceId, trainingId, options).pipe(
          tap(page => {
            const cacheEntry = cached && cached.freshness.version === freshness.version ?
              cached :
              {
                freshness,
                pages: new Map<string, WithinTrainingCodingComparisonPageDto>()
              };
            cacheEntry.pages.set(pageCacheKey, page);
            this.withinTrainingComparisonCache.set(cacheKey, cacheEntry);
          })
        );
      })
    );
  }

  saveDiscussionResult(
    workspaceId: number,
    trainingId: number,
    responseId: number,
    code: number | null,
    score: number | null,
    notes?: string | null
  ): Observable<{
      success: boolean;
      code: number | null;
      score: number | null;
      notes: string | null;
      source: 'manual' | 'auto_agreement' | null;
      managerUserId: number | null;
      managerName: string | null;
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/discussion-result`;
    return this.http.post<{
      success: boolean;
      code: number | null;
      score: number | null;
      notes: string | null;
      source: 'manual' | 'auto_agreement' | null;
      managerUserId: number | null;
      managerName: string | null;
    }>(
      url,
      {
        responseId, code, score, notes
      },
      { headers: this.authHeader }
    ).pipe(
      tap(() => this.invalidateWithinTrainingComparisonCache(workspaceId, trainingId))
    );
  }

  previewApplyDiscussionResults(
    workspaceId: number,
    trainingId: number,
    source: TrainingDiscussionApplySource
  ): Observable<TrainingDiscussionApplyPreviewDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/apply-discussion-results-preview`;
    return this.http.post<TrainingDiscussionApplyPreviewDto>(
      url,
      { source },
      { headers: this.authHeader }
    );
  }

  applyDiscussionResults(
    workspaceId: number,
    trainingId: number,
    request: ApplyTrainingDiscussionResultsRequestDto
  ): Observable<ApplyTrainingDiscussionResultsResultDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/apply-discussion-results`;
    return this.http.post<ApplyTrainingDiscussionResultsResultDto>(
      url,
      request,
      { headers: this.authHeader }
    ).pipe(
      tap(() => this.invalidateWithinTrainingComparisonCache(workspaceId, trainingId))
    );
  }

  getCodingJobsForTraining(
    workspaceId: number,
    trainingId: number
  ): Observable<CodingJobForTraining[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/jobs`;
    return this.http.get<CodingJobForTraining[]>(url, { headers: this.authHeader });
  }

  getTrainingCohensKappa(
    workspaceId: number,
    trainingId: number,
    weightedMean: boolean = true,
    level: 'code' | 'score' = 'code',
    selectedJobIds?: number[]
  ): Observable<TrainingKappaStatisticsDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/interrater-reliability`;
    let params = new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('level', level);
    if (selectedJobIds !== undefined) {
      params = params.set('jobIds', selectedJobIds.join(','));
    }
    return this.http.get<TrainingKappaStatisticsDto>(url, { headers: this.authHeader, params });
  }

  exportTrainingReliabilityAsCsv(
    workspaceId: number,
    trainingId: number,
    weightedMean: boolean = true,
    level: 'code' | 'score' = 'code',
    selectedJobIds?: number[]
  ): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/interrater-reliability/export/csv`;
    let params = new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('level', level);
    if (selectedJobIds !== undefined) {
      params = params.set('jobIds', selectedJobIds.join(','));
    }
    return this.http.get(url, {
      headers: this.authHeader,
      params,
      responseType: 'blob'
    });
  }
}
