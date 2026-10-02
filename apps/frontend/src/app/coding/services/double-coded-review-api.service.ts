import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ApplyDoubleCodedResolutionsRequestDto,
  DoubleCodedManagerDecisionDto,
  DoubleCodedResolutionResponseDto,
  DoubleCodedReviewQuery,
  DoubleCodedReviewResponseDto,
  SaveDoubleCodedReviewDraftDto
} from '../../../../../../api-dto/coding/double-coded-review.dto';
import { SERVER_URL } from '../../injection-tokens';

@Injectable({ providedIn: 'root' })
export class DoubleCodedReviewApiService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);

  getDoubleCodedVariablesForReview(
    workspaceId: number,
    query: DoubleCodedReviewQuery = {}
  ): Observable<DoubleCodedReviewResponseDto> {
    const {
      page = 1,
      limit = 50,
      onlyConflicts = false,
      excludeTrainings = false,
      search,
      coderId,
      statusFilter,
      resolvedFilter,
      agreementFilter,
      sortBy = 'unitVariable',
      sortDirection = 'asc',
      jobDefinitionIds,
      coderTrainingIds
    } = query;
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString())
      .set('onlyConflicts', onlyConflicts.toString())
      .set('excludeTrainings', excludeTrainings.toString())
      .set('sortBy', sortBy)
      .set('sortDirection', sortDirection);

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
    dto: ApplyDoubleCodedResolutionsRequestDto
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
