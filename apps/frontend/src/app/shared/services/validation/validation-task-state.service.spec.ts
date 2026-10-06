import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ValidationTaskStateService,
  ValidationResult
} from './validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

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

  it('updates derived state without mutating previous workspace snapshots', () => {
    const count = computed(() => Object.keys(service.getAllTaskIds(1)).length);
    const status = computed(() => service.getBatchState(1).status);
    const complete = computed(() => service.hasCompleteValidationResults(1));
    expect(count()).toBe(0);
    expect(status()).toBe('idle');
    expect(complete()).toBe(false);

    const task = { id: 100 } as unknown as ValidationTaskDto;
    service.setTaskId(1, 'variables', task);
    const tasks = service.getAllTaskIds(1);
    expect(count()).toBe(1);
    service.setTaskId(1, 'testTakers', task);
    expect(count()).toBe(2);
    expect(tasks).toEqual({ variables: task });
    service.removeTaskId(1, 'variables');
    expect(count()).toBe(1);
    expect(tasks).toEqual({ variables: task });

    service.setBatchState(1, { status: 'running' });
    expect(status()).toBe('running');
    const result: ValidationResult = { status: 'success', timestamp: 123 };
    service.setValidationResult(1, 'variables', result);
    const results = service.getAllValidationResults(1);
    service.setValidationResult(1, 'testTakers', result);
    expect(results).toEqual({ variables: result });
    service.setValidationResult(1, 'variableTypes', result);
    service.setValidationResult(1, 'responseStatus', result);
    service.setValidationResult(1, 'duplicateResponses', result);
    service.setValidationResult(1, 'groupResponses', result);
    expect(complete()).toBe(true);

    service.setTaskId(2, 'variables', task);
    service.invalidateWorkspace(1);
    expect(count()).toBe(0);
    expect(status()).toBe('idle');
    expect(complete()).toBe(false);
    expect(service.getAllTaskIds(2)).toEqual({ variables: task });
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
    it('should store task', () => {
      const mockTask = { id: 100 } as unknown as ValidationTaskDto;
      service.setTaskId(1, 'variables', mockTask);
      expect(service.getAllTaskIds(1)).toEqual({ variables: mockTask });

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
