import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

/**
 * Base class for validation services providing common functionality
 * for creating, polling, and retrieving validation task results.
 */
export abstract class BaseValidationService<TResult> {
  protected abstract validationType: string;

  protected validationService = inject(ValidationService);
  protected validationTaskStateService = inject(ValidationTaskStateService);
  protected appService = inject(AppService);

  /**
   * Creates a validation task on the backend
   */
  protected createTask(
    type: string,
    page?: number,
    limit?: number,
    additionalData?: Record<string, unknown>
  ): Observable<ValidationTaskDto> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService.createValidationTask(
      workspaceId,
      type as 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses',
      page,
      limit,
      additionalData
    );
  }

  /**
   * Polls a validation task until completion
   */
  protected pollTask(taskId: number, pollInterval: number = 2000): Observable<ValidationTaskDto> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService.pollValidationTask(workspaceId, taskId, pollInterval);
  }

  /**
   * Retrieves the results of a completed validation task
   */
  protected getResults(taskId: number): Observable<TResult> {
    const workspaceId = this.appService.selectedWorkspaceId;
    return this.validationService.getValidationResults(workspaceId, taskId) as Observable<TResult>;
  }

  /**
   * Saves validation results to the state service
   */
  protected saveResult(result: TResult): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.validationTaskStateService.setValidationResult(
      workspaceId,
      this.validationType as 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses',
      {
        status: this.calculateStatus(result),
        timestamp: Date.now(),
        details: result
      }
    );
  }

  /**
   * Calculates the validation status based on the result
   */
  protected abstract calculateStatus(result: TResult): 'success' | 'failed' | 'not-run';

  /**
   * Stores the task ID in the state service
   */
  protected storeTaskId(taskId: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.validationTaskStateService.setTaskId(
      workspaceId,
      this.validationType as 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses',
      taskId
    );
  }

  /**
   * Removes the task ID from the state service
   */
  protected removeTaskId(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.validationTaskStateService.removeTaskId(
      workspaceId,
      this.validationType as 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'
    );
  }

  /**
   * Abstract method to be implemented by concrete validation services
   */
  abstract validate(...args: unknown[]): Observable<TResult>;
}
