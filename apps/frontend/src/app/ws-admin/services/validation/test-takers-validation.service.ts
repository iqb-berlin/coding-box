import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { BaseValidationService } from './base-validation.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { TestTakersValidationDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';

/**
 * Service for validating test takers.
 * Checks if all test persons in the database have corresponding entries in TestTakers XML files.
 */
@Injectable({
  providedIn: 'root'
})
export class TestTakersValidationService extends BaseValidationService<TestTakersValidationDto> {
  protected validationType = 'testTakers';

  /**
   * Validates test takers by creating a validation task and retrieving results
   */
  validate(): Observable<TestTakersValidationDto> {
    return this.createTask(this.validationType).pipe(
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
   * Gets the current validation status
   */
  getValidationStatus(): 'not-run' | 'running' | 'success' | 'failed' {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);

    if (taskIds.testTakers) {
      return 'running';
    }

    return results.testTakers?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(result: TestTakersValidationDto): 'success' | 'failed' | 'not-run' {
    return (!result.testTakersFound || result.missingPersons.length > 0) ? 'failed' : 'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): TestTakersValidationDto | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results = this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (results.testTakers?.details as unknown as TestTakersValidationDto) || null;
  }
}
