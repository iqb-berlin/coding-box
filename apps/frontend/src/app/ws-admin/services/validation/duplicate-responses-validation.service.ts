import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap, map } from 'rxjs/operators';
import { BaseValidationService } from './base-validation.service';
import { DuplicateResponsesResultDto } from '../../../../../../../api-dto/files/duplicate-response.dto';

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
   * Validates duplicate responses by creating a validation task and retrieving results
   */
  validate(page: number = 1, limit: number = 10): Observable<DuplicateResponsesResultDto> {
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
   * Resolves a duplicate response group by keeping the selected response and deleting others
   */
  resolveDuplicateGroup(responseIdsToDelete: number[]): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.backendService.createDeleteResponsesTask(workspaceId, responseIdsToDelete).pipe(
      tap(task => this.storeTaskId(task.id)),
      switchMap(task => this.pollTask(task.id)),
      tap(() => this.removeTaskId()),
      map(() => undefined)
    );
  }

  /**
   * Resolves all duplicate responses automatically using a smart selection algorithm
   */
  resolveAllDuplicates(): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.backendService.createDeleteAllResponsesTask(workspaceId, this.validationType as 'duplicateResponses').pipe(
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

    if (taskIds.duplicateResponses) {
      return 'running';
    }

    return results.duplicateResponses?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(result: DuplicateResponsesResultDto): 'success' | 'failed' | 'not-run' {
    return result.total > 0 ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): DuplicateResponsesResultDto | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (results.duplicateResponses?.details as unknown as DuplicateResponsesResultDto) || null;
  }
}
