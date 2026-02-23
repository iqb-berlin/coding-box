import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root'
})
export class BackendMessageTranslatorService {
  private translateService = inject(TranslateService);

  // Mapping of common backend messages to German translation keys
  private messageMap: { [key: string]: string } = {
    // Test person coding messages
    'Test persons coding started successfully': 'test-person-coding.coding-started',
    'Test persons coding completed successfully': 'test-person-coding.coding-completed',
    'All test persons were coded successfully': 'test-person-coding.all-coded-successfully',
    'Failed to start test persons coding': 'test-person-coding.coding-start-failed',
    'Test persons coding failed': 'test-person-coding.coding-failed',
    'No test persons found for coding': 'test-person-coding.no-test-persons',
    'Invalid test person IDs': 'test-person-coding.invalid-test-person-ids',

    // Job management messages
    'Job cancelled successfully': 'test-person-coding.job-cancelled',
    'Job deleted successfully': 'test-person-coding.job-deleted',
    'Job restarted successfully': 'test-person-coding.job-restarted',
    'Failed to cancel job': 'test-person-coding.job-cancel-error',
    'Failed to delete job': 'test-person-coding.job-delete-error',
    'Failed to restart job': 'test-person-coding.job-restart-error',

    // Generic success messages
    'Operation completed successfully': 'backend-messages.operation-completed',
    'Process completed': 'backend-messages.process-completed',
    Success: 'backend-messages.success',

    // Error messages
    'Operation failed': 'backend-messages.operation-failed',
    'Process failed': 'backend-messages.process-failed',
    Error: 'backend-messages.error',
    'Unexpected error occurred': 'backend-messages.unexpected-error',
    'Invalid request': 'backend-messages.invalid-request',
    'Access denied': 'backend-messages.access-denied',
    'Not found': 'backend-messages.not-found',
    'Internal server error': 'backend-messages.internal-server-error'
  };

  translateMessage(backendMessage: string): string {
    if (!backendMessage || backendMessage.trim() === '') {
      return backendMessage;
    }

    const translationKey = this.messageMap[backendMessage.trim()];

    if (translationKey) {
      const translated = this.translateService.instant(translationKey);

      return translated !== translationKey ? translated : backendMessage;
    }

    const dynamicTranslation = this.translateDynamicMessage(backendMessage);
    if (dynamicTranslation) {
      return dynamicTranslation;
    }

    return backendMessage;
  }

  private translateDynamicMessage(message: string): string | null {
    const jobCancelledMatch = message.match(/^Job (.+) cancelled successfully$/i);
    if (jobCancelledMatch) {
      return this.translateService.instant('test-person-coding.job-cancelled-by-id', { id: jobCancelledMatch[1] });
    }

    const jobDeletedMatch = message.match(/^Job (.+) deleted successfully$/i);
    if (jobDeletedMatch) {
      return this.translateService.instant('test-person-coding.job-deleted-by-id', { id: jobDeletedMatch[1] });
    }

    const trainingCreatedMatch = message.match(/^Successfully created (\d+) coder training jobs?$/i);
    if (trainingCreatedMatch) {
      return this.translateService.instant('coding.trainings.create.success', { count: trainingCreatedMatch[1] });
    }

    const trainingUpdatedMatch = message.match(/^Successfully updated coder training label to "(.+)"$/i);
    if (trainingUpdatedMatch) {
      return this.translateService.instant('coding.trainings.update.success', { label: trainingUpdatedMatch[1] });
    }

    const trainingDeletedMatch = message.match(/^Successfully deleted coder training "(.+)" with (\d+) associated jobs?$/i);
    if (trainingDeletedMatch) {
      return this.translateService.instant('coding.trainings.delete.success', {
        label: trainingDeletedMatch[1],
        count: trainingDeletedMatch[2]
      });
    }

    const trainingCreateErrorMatch = message.match(/^Error creating coder training jobs: (.+)$/i);
    if (trainingCreateErrorMatch) {
      return this.translateService.instant('coding.trainings.create.error.generic', { error: trainingCreateErrorMatch[1] });
    }

    const trainingUpdateErrorMatch = message.match(/^Error updating coder training label: (.+)$/i);
    if (trainingUpdateErrorMatch) {
      return this.translateService.instant('coding.trainings.update.error.generic', { error: trainingUpdateErrorMatch[1] });
    }

    const trainingNotFoundMatch = message.match(/^Coder training with ID (\d+) not found in workspace (\d+)$/i);
    if (trainingNotFoundMatch) {
      return this.translateService.instant('coding.trainings.update.error.not-found', {
        trainingId: trainingNotFoundMatch[1],
        workspaceId: trainingNotFoundMatch[2]
      });
    }

    const trainingDeleteErrorMatch = message.match(/^Error deleting coder training: (.+)$/i);
    if (trainingDeleteErrorMatch) {
      return this.translateService.instant('coding.trainings.delete.error.generic', { error: trainingDeleteErrorMatch[1] });
    }

    const processingBackgroundMatch = message.match(/^Processing (\d+) test persons in the background\. Check job status with jobId: (.+)$/i);
    if (processingBackgroundMatch) {
      return this.translateService.instant('test-person-coding.background-processing', {
        count: processingBackgroundMatch[1],
        jobId: processingBackgroundMatch[2]
      });
    }

    return null;
  }
}
