import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap, map } from 'rxjs/operators';
import { BaseValidationService } from './base-validation.service';
import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';

interface ResponseStatusValidationResult {
  data: InvalidVariableDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Service for validating response status.
 * Checks if response status values are valid according to Unit.xml definitions.
 */
@Injectable({
  providedIn: 'root'
})
export class ResponseStatusValidationService extends BaseValidationService<ResponseStatusValidationResult> {
  protected validationType = 'responseStatus';

  /**
   * Validates response status by creating a validation task and retrieving results
   */
  validate(page: number = 1, limit: number = 10): Observable<ResponseStatusValidationResult> {
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
   * Deletes selected invalid response status responses
   */
  deleteSelected(responseIds: number[]): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.backendService.createDeleteResponsesTask(workspaceId, responseIds).pipe(
      tap(task => this.storeTaskId(task.id)),
      switchMap(task => this.pollTask(task.id)),
      tap(() => this.removeTaskId()),
      map(() => undefined)
    );
  }

  /**
   * Deletes all invalid response status responses
   */
  deleteAll(): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.backendService.createDeleteAllResponsesTask(workspaceId, this.validationType as 'responseStatus').pipe(
      tap(task => this.storeTaskId(task.id)),
      switchMap(task => this.pollTask(task.id)),
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

    if (taskIds.responseStatus) {
      return 'running';
    }

    return results.responseStatus?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(result: ResponseStatusValidationResult): 'success' | 'failed' | 'not-run' {
    return result.total > 0 ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): ResponseStatusValidationResult | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (results.responseStatus?.details as unknown as ResponseStatusValidationResult) || null;
  }
}
