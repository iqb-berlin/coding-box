import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { injectUiTranslator } from '../../shared/utils/ui-translator';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';

export interface ValidationProgress {
  status: 'idle' | 'loading' | 'processing' | 'completed' | 'error';
  progress: number; // 0-100
  message: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ValidationStateService {
  private readonly uiTranslate = injectUiTranslator();

  private validationResultsSubject = new BehaviorSubject<ValidateCodingCompletenessResponseDto | null>(null);
  private validationProgressSubject = new BehaviorSubject<ValidationProgress>({
    status: 'idle',
    progress: 0,
    message: ''
  });

  // Expose observables for components to subscribe to
  validationResults$ = this.validationResultsSubject.asObservable();
  validationProgress$ = this.validationProgressSubject.asObservable();

  /**
   * Get current validation results
   */
  getValidationResults(): ValidateCodingCompletenessResponseDto | null {
    return this.validationResultsSubject.getValue();
  }

  /**
   * Get current validation progress
   */
  getValidationProgress(): ValidationProgress {
    return this.validationProgressSubject.getValue();
  }

  /**
   * Start validation process
   */
  startValidation(): void {
    this.validationProgressSubject.next({
      status: 'loading',
      progress: 0,
      message: this.uiTranslate('ui-text.validation-state.processing-excel')
    });
  }

  /**
   * Update validation progress
   */
  updateProgress(progress: number, message: string): void {
    this.validationProgressSubject.next({
      status: 'processing',
      progress,
      message
    });
  }

  /**
   * Set validation results and mark as completed
   */
  setValidationResults(results: ValidateCodingCompletenessResponseDto): void {
    this.validationResultsSubject.next(results);
    this.validationProgressSubject.next({
      status: 'completed',
      progress: 100,
      message: this.uiTranslate('coding-management-manual.success.validation-completed', { missing: results.missing, total: results.total })
    });
  }

  /**
   * Set validation error
   */
  setValidationError(error: string): void {
    this.validationProgressSubject.next({
      status: 'error',
      progress: 0,
      message: this.uiTranslate('coding-management-manual.errors.validation-failed'),
      error
    });
  }

  /**
   * Reset validation state
   */
  resetValidation(): void {
    this.validationResultsSubject.next(null);
    this.validationProgressSubject.next({
      status: 'idle',
      progress: 0,
      message: ''
    });
  }
}
