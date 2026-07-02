import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletName: string;
  testPerson: string;
  coders: Array<{
    trainingId: number;
    trainingLabel: string;
    coderId: number;
    coderName: string;
    code: string | null;
    score: number | null;
    notes: string | null;
    codingIssueOption: number | null;
  }>;
}

export interface WithinTrainingCodingResult {
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletName: string;
  testPerson: string;
  givenAnswer: string;
  replayCode: number | null;
  replayScore: number | null;
  discussionCode: number | null;
  discussionScore: number | null;
  discussionNotes: string | null;
  discussionManagerUserId: number | null;
  discussionManagerName: string | null;
  discussionSource: 'manual' | 'auto_agreement' | null;
  coders: Array<{
    jobId: number;
    coderName: string;
    code: string | null;
    score: number | null;
    notes: string | null;
    codingIssueOption: number | null;
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

interface WithinTrainingComparisonCacheEntry {
  freshness: TrainingComparisonFreshnessDto;
  data: WithinTrainingCodingResult[];
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
        shareReplay({ bufferSize: 1, refCount: false })
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

  getTrainingComparisonFreshness(
    workspaceId: number,
    trainingId: number
  ): Observable<TrainingComparisonFreshnessDto> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/comparison-freshness`;
    return this.http.get<TrainingComparisonFreshnessDto>(url, { headers: this.authHeader });
  }

  getCachedWithinTrainingCodingResults(
    workspaceId: number,
    trainingId: number
  ): Observable<WithinTrainingCodingResult[]> {
    const cacheKey = this.getWithinTrainingComparisonCacheKey(workspaceId, trainingId);

    return this.getTrainingComparisonFreshness(workspaceId, trainingId).pipe(
      catchError(() => of(null)),
      switchMap(freshness => {
        if (!freshness) {
          return this.compareWithinTrainingCodingResults(workspaceId, trainingId);
        }

        const cached = this.withinTrainingComparisonCache.get(cacheKey);
        if (cached && cached.freshness.version === freshness.version) {
          return of(cached.data);
        }

        return this.compareWithinTrainingCodingResults(workspaceId, trainingId).pipe(
          tap(data => {
            this.withinTrainingComparisonCache.set(cacheKey, {
              freshness,
              data
            });
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
    level: 'code' | 'score' = 'code'
  ): Observable<{
      variables: Array<{
        unitName: string;
        variableId: string;
        meanKappa: number | null;
        meanAgreement: number | null;
        caseCount: number;
        validPairCount: number;
        coderPairCount: number;
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
        weightingMethod: 'weighted' | 'unweighted';
        calculationLevel: 'code' | 'score';
      };
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/cohens-kappa?weightedMean=${weightedMean}&level=${level}`;
    return this.http.get<{
      variables: Array<{
        unitName: string;
        variableId: string;
        meanKappa: number | null;
        meanAgreement: number | null;
        caseCount: number;
        validPairCount: number;
        coderPairCount: number;
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
        weightingMethod: 'weighted' | 'unweighted';
        calculationLevel: 'code' | 'score';
      };
    }>(url, { headers: this.authHeader });
  }
}
