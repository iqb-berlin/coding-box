import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionDecisionDto,
  DoubleCodedResolutionResultDto,
  DoubleCodedReviewCodeDto,
  SaveDoubleCodedReviewDraftDto
} from '../../../../../../api-dto/coding/double-coded-review.dto';
import { SERVER_URL } from '../../injection-tokens';

export interface DoubleCodedReviewCoderResult {
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
}

export interface DoubleCodedReviewItemDto {
  responseId: number;
  sourceUnitId: number;
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
  availableCodes: DoubleCodedReviewCodeDto[];
  managerDrafts: DoubleCodedManagerDecisionDto[];
  managerHistory: DoubleCodedManagerDecisionDto[];
  coderResults: DoubleCodedReviewCoderResult[];
}

export interface DoubleCodedReviewResponseDto {
  data: DoubleCodedReviewItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface DoubleCodedResolutionResponseDto {
  success: boolean;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  message: string;
  results: DoubleCodedResolutionResultDto[];
}

@Injectable({ providedIn: 'root' })
export class DoubleCodedReviewApiService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);

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
  ): Observable<DoubleCodedReviewResponseDto> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString())
      .set('onlyConflicts', onlyConflicts.toString())
      .set('excludeTrainings', excludeTrainings.toString());

    if (search?.trim()) {
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

    return this.http.get<DoubleCodedReviewResponseDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review`,
      { params }
    );
  }

  applyDoubleCodedResolutions(
    workspaceId: number,
    dto: { decisions: DoubleCodedResolutionDecisionDto[] }
  ): Observable<DoubleCodedResolutionResponseDto> {
    return this.http.post<DoubleCodedResolutionResponseDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/apply-resolutions`,
      dto
    );
  }

  saveDoubleCodedReviewDraft(
    workspaceId: number,
    responseId: number,
    draft: SaveDoubleCodedReviewDraftDto
  ): Observable<DoubleCodedManagerDecisionDto> {
    return this.http.put<DoubleCodedManagerDecisionDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/${responseId}/draft`,
      draft
    );
  }

  deleteDoubleCodedReviewDraft(
    workspaceId: number,
    responseId: number
  ): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/double-coded-review/${responseId}/draft`
    );
  }
}
