import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
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
   * Validates group responses by creating a validation task and retrieving results
   */
  validate(page: number = 1, limit: number = 10): Observable<GroupResponsesValidationResult> {
    return this.createTask(this.validationType, page, limit).pipe(
      tap(task => this.storeTaskId(task.id)),
      switchMap(task => this.pollTask(task.id)),
      switchMap(completedTask => this.getResults(completedTask.id)),
      tap(result => {
        this.saveResult(result);
        this.removeTaskId();
      })
    );
  }

  /**
   * Gets the current validation status
   */
  getValidationStatus(): 'not-run' | 'running' | 'success' | 'failed' {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);

    if (taskIds.groupResponses) {
      return 'running';
    }

    return results.groupResponses?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(result: GroupResponsesValidationResult): 'success' | 'failed' | 'not-run' {
    return (!result.testTakersFound || !result.allGroupsHaveResponses) ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): GroupResponsesValidationResult | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (results.groupResponses?.details as unknown as GroupResponsesValidationResult) || null;
  }
}
