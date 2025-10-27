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

  /**
   * Translates a backend message to German if a matching translation key exists.
   * Returns the translated message or the original message if no translation is found.
   *
   * @param backendMessage The raw message from the backend API
   * @returns The translated message or original message if no translation exists
   */
  translateMessage(backendMessage: string): string {
    if (!backendMessage || backendMessage.trim() === '') {
      return backendMessage;
    }

    // Check if message exists in the mapping
    const translationKey = this.messageMap[backendMessage.trim()];

    if (translationKey) {
      // Try to get the translation
      const translated = this.translateService.instant(translationKey);

      // Return translated message if it's different from the key (meaning translation was found)
      // If translation fails, it returns the key itself, so we check for that
      return translated !== translationKey ? translated : backendMessage;
    }

    // Check for dynamic messages (e.g., "Job X cancelled successfully")
    const dynamicTranslation = this.translateDynamicMessage(backendMessage);
    if (dynamicTranslation) {
      return dynamicTranslation;
    }

    // If no translation found, return original message
    return backendMessage;
  }

  /**
   * Attempts to translate messages with dynamic content like "Job {id} cancelled successfully"
   */
  private translateDynamicMessage(message: string): string | null {
    // Check for job-related messages with IDs
    const jobCancelledMatch = message.match(/^Job (.+) cancelled successfully$/i);
    if (jobCancelledMatch) {
      return this.translateService.instant('test-person-coding.job-cancelled-by-id', { id: jobCancelledMatch[1] });
    }

    const jobDeletedMatch = message.match(/^Job (.+) deleted successfully$/i);
    if (jobDeletedMatch) {
      return this.translateService.instant('test-person-coding.job-deleted-by-id', { id: jobDeletedMatch[1] });
    }

    // Add more dynamic patterns as needed

    return null;
  }

  /**
   * Returns a fallback translated message if backend message is empty or null
   */
  getTranslatedMessageOrFallback(backendMessage: string | undefined, fallbackKey: string): string {
    if (!backendMessage || backendMessage.trim() === '') {
      return this.translateService.instant(fallbackKey);
    }

    const translated = this.translateMessage(backendMessage);
    return translated || this.translateService.instant(fallbackKey);
  }
}
