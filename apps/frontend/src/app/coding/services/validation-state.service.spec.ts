import { TestBed } from '@angular/core/testing';
import { ValidationStateService } from './validation-state.service';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';

describe('ValidationStateService', () => {
  let service: ValidationStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ValidationStateService]
    });
    service = TestBed.inject(ValidationStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Validation Flow', () => {
    it('should start validation', () => {
      service.startValidation();
      const progress = service.getValidationProgress();
      expect(progress.status).toBe('loading');
    });

    it('should update progress', () => {
      service.updateProgress(50, 'Halfway');
      const progress = service.getValidationProgress();
      expect(progress.progress).toBe(50);
      expect(progress.message).toBe('Halfway');
    });

    it('should set results', () => {
      const results = { missing: 1, total: 10 } as ValidateCodingCompletenessResponseDto;
      service.setValidationResults(results);

      expect(service.getValidationResults()).toEqual(results);
      const progress = service.getValidationProgress();
      expect(progress.status).toBe('completed');
    });

    it('should reset', () => {
      service.startValidation();
      service.resetValidation();
      expect(service.getValidationResults()).toBeNull();
      expect(service.getValidationProgress().status).toBe('idle');
    });
  });
});
