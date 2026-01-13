import { TestBed } from '@angular/core/testing';
import { ValidationTaskStateService, ValidationResult } from './validation-task-state.service';

describe('ValidationTaskStateService', () => {
  let service: ValidationTaskStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ValidationTaskStateService]
    });
    service = TestBed.inject(ValidationTaskStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('setBatchState', () => {
    it('should update and emit batch state', done => {
      service.observeBatchState(1).subscribe(state => {
        if (state.status === 'running') {
          expect(state.startedAt).toBeGreaterThan(0);
          done();
        }
      });

      service.setBatchState(1, { status: 'running', startedAt: Date.now() });
    });
  });

  describe('setTaskId', () => {
    it('should store task id', () => {
      service.setTaskId(1, 'variables', 100);
      expect(service.getAllTaskIds(1)).toEqual({ variables: 100 });

      service.removeTaskId(1, 'variables');
      expect(service.getAllTaskIds(1)).toEqual({});
    });
  });

  describe('setValidationResult', () => {
    it('should store and retrieve results', () => {
      const result: ValidationResult = { status: 'success', timestamp: 123 };
      service.setValidationResult(1, 'variables', result);
      expect(service.getAllValidationResults(1).variables).toEqual(result);
    });
  });
});
