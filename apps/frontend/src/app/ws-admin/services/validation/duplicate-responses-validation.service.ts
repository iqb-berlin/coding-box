import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap, map } from 'rxjs/operators';
import { BaseValidationService } from './base-validation.service';
import { DuplicateResponsesResultDto } from '../../../../../../../api-dto/files/duplicate-response.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

/**
 * Service for validating duplicate responses.
 * Checks if there are duplicate responses for the same variable, unit, and test person.
 */
@Injectable({
  providedIn: 'root'
})
export class DuplicateResponsesValidationService extends BaseValidationService<DuplicateResponsesResultDto> {
  protected validationType = 'duplicateResponses';

  /**
   * Resolves a duplicate response group by keeping the selected response and deleting others
   */
  resolveDuplicateGroup(responseIdsToDelete: number[]): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService
      .createDeleteResponsesTask(workspaceId, responseIdsToDelete)
      .pipe(
        tap((task: ValidationTaskDto) => this.storeTaskId(task)),
        switchMap((task: ValidationTaskDto) => this.handleTaskResult(task)),
        tap(() => {
          this.removeTaskId();
          this.invalidateWorkspaceValidationCache();
        }),
        map(() => undefined)
      );
  }

  /**
   * Resolves all duplicate responses automatically using backend selection rules
   */
  resolveAllDuplicates(): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService
      .createDeleteAllResponsesTask(
        workspaceId,
        this.validationType as 'duplicateResponses'
      )
      .pipe(
        tap((task: ValidationTaskDto) => this.storeTaskId(task)),
        switchMap((task: ValidationTaskDto) => this.handleTaskResult(task)),
        tap(() => {
          this.removeTaskId();
          this.invalidateWorkspaceValidationCache();
        }),
        map(() => undefined)
      );
  }

  /**
   * Gets the current validation status
   */
  getValidationStatus(): 'not-run' | 'running' | 'success' | 'failed' {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);

    if (taskIds.duplicateResponses) {
      return 'running';
    }

    return results.duplicateResponses?.status || 'not-run';
  }

  /**
   * Fetches a specific page of validation results using the direct API (no task creation).
   * Used for pagination after the initial validation has been run.
   */
  fetchPage(
    page: number = 1,
    limit: number = 10
  ): Observable<DuplicateResponsesResultDto> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService
      .validateDuplicateResponses(workspaceId, page, limit)
      .pipe(tap(result => this.saveResult(result)));
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(
    result: DuplicateResponsesResultDto
  ): 'success' | 'failed' | 'not-run' {
    return result.total > 0 ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): DuplicateResponsesResultDto | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (
      (results.duplicateResponses
        ?.details as unknown as DuplicateResponsesResultDto) || null
    );
  }
}
