import { Injectable } from '@angular/core';
import { BaseValidationService } from './base-validation.service';
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
   * Gets the current validation status
   */
  getValidationStatus(): 'not-run' | 'running' | 'success' | 'failed' {
    const workspaceId = this.appService.selectedWorkspaceId;
    const taskIds = this.validationTaskStateService.getAllTaskIds(workspaceId);
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);

    if (taskIds.testTakers) {
      return 'running';
    }

    return results.testTakers?.status || 'not-run';
  }

  /**
   * Calculates the validation status based on the result
   */
  protected calculateStatus(
    result: TestTakersValidationDto
  ): 'success' | 'failed' | 'not-run' {
    return !result.testTakersFound || result.missingPersons.length > 0 ?
      'failed' :
      'success';
  }

  /**
   * Gets the cached validation result
   */
  getCachedResult(): TestTakersValidationDto | null {
    const workspaceId = this.appService.selectedWorkspaceId;
    const results =
      this.validationTaskStateService.getAllValidationResults(workspaceId);
    return (
      (results.testTakers?.details as unknown as TestTakersValidationDto) ||
      null
    );
  }
}
