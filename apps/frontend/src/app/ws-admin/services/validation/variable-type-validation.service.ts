import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap, map } from 'rxjs/operators';
import { BaseValidationService } from './base-validation.service';
import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

interface VariableTypesValidationResult {
  data: InvalidVariableDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Service for validating variable types.
 * Checks if variable values match their expected types (string, integer, number, boolean, json).
 */
@Injectable({
  providedIn: 'root'
})
export class VariableTypeValidationService extends BaseValidationService<VariableTypesValidationResult> {
  protected validationType = 'variableTypes';

  /**
   * Validates variable types by creating a validation task and retrieving results
   */
  validate(page: number = 1, limit: number = 10): Observable<VariableTypesValidationResult> {
    return this.createTask(this.validationType, page, limit).pipe(
      tap((task: ValidationTaskDto) => this.storeTaskId(task.id)),
      switchMap((task: ValidationTaskDto) => this.pollTask(task.id)),
      switchMap(completedTask => this.getResults(completedTask.id)),
      tap(result => {
        this.saveResult(result);
        this.removeTaskId();
      })
    );
  }

  /**
   * Deletes selected invalid variable type responses
   */
  deleteSelected(responseIds: number[]): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService.createDeleteResponsesTask(workspaceId, responseIds).pipe(
      tap((task: ValidationTaskDto) => this.storeTaskId(task.id)),
      switchMap((task: ValidationTaskDto) => this.pollTask(task.id)),
      tap(() => this.removeTaskId()),
      map(() => undefined)
    );
  }

  /**
   * Deletes all invalid variable type responses
   */
  deleteAll(): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService.createDeleteAllResponsesTask(workspaceId, this.validationType as 'variableTypes').pipe(
      tap((task: ValidationTaskDto) => this.storeTaskId(task.id)),
      switchMap((task: ValidationTaskDto) => this.pollTask(task.id)),
      tap(() => this.removeTaskId()),
      map(() => undefined)
    );
  }

  /**
   * Gets the current validation status
   */
  getValidationStatus(): 'not-run' | 'running' | 'success' | 'failed' {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);

    if (taskIds.variableTypes) {
      return 'running';
    }

    return results.variableTypes?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(result: VariableTypesValidationResult): 'success' | 'failed' | 'not-run' {
    return result.total > 0 ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): VariableTypesValidationResult | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (results.variableTypes?.details as unknown as VariableTypesValidationResult) || null;
  }
}
