import { Injectable } from '@angular/core';
import { BaseValidationService } from './base-validation.service';

interface GroupResponsesValidationResult {
  testTakersFound: boolean;
  groupsWithResponses: { group: string; hasResponse: boolean }[];
  allGroupsHaveResponses: boolean;
  total: number;
  page: number;
  limit: number;
}

/**
 * Service for validating group responses.
 * Checks if all test person groups have at least one response.
 */
@Injectable({
  providedIn: 'root'
})
export class GroupResponsesValidationService extends BaseValidationService<GroupResponsesValidationResult> {
  protected validationType = 'groupResponses';

  /**
   * Gets the current validation status
   */
  getValidationStatus(): 'not-run' | 'running' | 'success' | 'failed' {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);

    if (taskIds.groupResponses) {
      return 'running';
    }

    return results.groupResponses?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(
    result: GroupResponsesValidationResult
  ): 'success' | 'failed' | 'not-run' {
    return !result.testTakersFound || !result.allGroupsHaveResponses ?
      'failed' :
      'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): GroupResponsesValidationResult | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (
      (results.groupResponses
        ?.details as unknown as GroupResponsesValidationResult) || null
    );
  }
}
