import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap, map } from 'rxjs/operators';
import { BaseValidationService } from './base-validation.service';
import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

interface VariablesValidationResult {
  data: InvalidVariableDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Service for validating variables.
 * Checks if variables in responses are defined in the corresponding Unit.xml files.
 */
@Injectable({
  providedIn: 'root'
})
export class VariableValidationService extends BaseValidationService<VariablesValidationResult> {
  protected validationType = 'variables';

  /**
   * Deletes selected invalid variable responses
   */
  deleteSelected(responseIds: number[]): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService
      .createDeleteResponsesTask(workspaceId, responseIds)
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
   * Deletes all invalid variable responses
   */
  deleteAll(): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService
      .createDeleteAllResponsesTask(
        workspaceId,
        this.validationType as 'variables'
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

    if (taskIds.variables) {
      return 'running';
    }

    return results.variables?.status || 'not-run';
  }

  /**
   * Fetches a specific page of validation results using the direct API (no task creation).
   * Used for pagination after the initial validation has been run.
   */
  fetchPage(
    page: number = 1,
    limit: number = 10
  ): Observable<VariablesValidationResult> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService
      .validateVariables(workspaceId, page, limit)
      .pipe(tap(result => this.saveResult(result)));
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(
    result: VariablesValidationResult
  ): 'success' | 'failed' | 'not-run' {
    return result.total > 0 ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): VariablesValidationResult | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (
      (results.variables?.details as unknown as VariablesValidationResult) ||
      null
    );
  }
}
