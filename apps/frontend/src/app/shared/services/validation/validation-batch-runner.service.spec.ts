import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ValidationBatchRunnerService } from './validation-batch-runner.service';
import { ValidationService } from './validation.service';
import { ValidationTaskStateService } from './validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('ValidationBatchRunnerService', () => {
  let service: ValidationBatchRunnerService;
  let validationServiceMock: {
    createValidationTask: jest.Mock;
    pollValidationTask: jest.Mock;
    getValidationResults: jest.Mock;
    getValidationTask: jest.Mock;
  };
  let stateServiceMock: jest.Mocked<ValidationTaskStateService>;

  beforeEach(() => {
    validationServiceMock = {
      createValidationTask: jest.fn(),
      pollValidationTask: jest.fn(),
      getValidationResults: jest.fn(),
      getValidationTask: jest.fn()
    };

    stateServiceMock = {
      getBatchState: jest.fn().mockReturnValue({ status: 'idle' }),
      setBatchState: jest.fn(),
      setTaskId: jest.fn(),
      getAllTaskIds: jest.fn().mockReturnValue({}),
      getAllValidationResults: jest.fn().mockReturnValue({}),
      removeTaskId: jest.fn(),
      setValidationResult: jest.fn()
    } as unknown as jest.Mocked<ValidationTaskStateService>;

    TestBed.configureTestingModule({
      providers: [
        ValidationBatchRunnerService,
        { provide: ValidationService, useValue: validationServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock }
      ]
    });

    service = TestBed.inject(ValidationBatchRunnerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startBatch', () => {
    it('should run all steps sequentially', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        const mockTaskId = 123;
        validationServiceMock.createValidationTask.mockReturnValue(
          of({ id: mockTaskId } as ValidationTaskDto)
        );
        validationServiceMock.pollValidationTask.mockReturnValue(
          of({ id: mockTaskId, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationTask.mockReturnValue(
          of({ id: mockTaskId, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationResults.mockReturnValue(
          of({ total: 0 })
        );

        service.startBatch(1);
        await jest.advanceTimersByTimeAsync(500 * 6); // Trigger all 6 steps intervals
        await jest.advanceTimersByTimeAsync(0);

        // All 6 steps should be called
        expect(validationServiceMock.createValidationTask).toHaveBeenCalledTimes(
          6
        );
        expect(stateServiceMock.setBatchState).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ status: 'running' })
        );
        expect(stateServiceMock.setBatchState).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ status: 'completed' })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should handle step failure and set batch state to failed', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        validationServiceMock.createValidationTask.mockReturnValue(
          throwError(() => new Error('Step failed'))
        );

        service.startBatch(1);
        await jest.advanceTimersByTimeAsync(0);

        expect(stateServiceMock.setBatchState).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ status: 'failed', error: 'Step failed' })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not start if already running (batch state status is running)', () => {
      stateServiceMock.getBatchState.mockReturnValue({ status: 'running' });
      service.startBatch(1);
      expect(validationServiceMock.createValidationTask).not.toHaveBeenCalled();
    });

    it('should skip step if results exist and not forced', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        stateServiceMock.getAllValidationResults.mockReturnValue({
          testTakers: { status: 'success', timestamp: 123 }
        });

        // Should skip testTakers, but run others
        validationServiceMock.createValidationTask.mockReturnValue(
          of({ id: 1 } as ValidationTaskDto)
        );
        validationServiceMock.pollValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationResults.mockReturnValue(
          of({ total: 0 })
        );

        service.startBatch(1);
        await jest.advanceTimersByTimeAsync(500 * 5); // 5 steps
        await jest.advanceTimersByTimeAsync(0);

        // 6 steps total, 1 skipped = 5 called
        expect(validationServiceMock.createValidationTask).toHaveBeenCalledTimes(
          5
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should run step if results exist but forced', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        stateServiceMock.getAllValidationResults.mockReturnValue({
          testTakers: { status: 'success', timestamp: 123 }
        });

        validationServiceMock.createValidationTask.mockReturnValue(
          of({ id: 1 } as ValidationTaskDto)
        );
        validationServiceMock.pollValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationResults.mockReturnValue(
          of({ total: 0 })
        );

        service.startBatch(1, { force: true });
        await jest.advanceTimersByTimeAsync(500 * 6);
        await jest.advanceTimersByTimeAsync(0);

        expect(validationServiceMock.createValidationTask).toHaveBeenCalledTimes(
          6
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should handle failed task from polling', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        const mockTaskId = 123;
        validationServiceMock.createValidationTask.mockReturnValue(
          of({ id: mockTaskId } as ValidationTaskDto)
        );
        validationServiceMock.pollValidationTask.mockReturnValue(
          of({
            id: mockTaskId,
            status: 'failed',
            error: 'Task error'
          } as ValidationTaskDto)
        );
        validationServiceMock.getValidationTask.mockReturnValue(
          of({
            id: mockTaskId,
            status: 'failed',
            error: 'Task error'
          } as ValidationTaskDto)
        );

        service.startBatch(1);
        await jest.advanceTimersByTimeAsync(500); // Trigger first interval
        await jest.advanceTimersByTimeAsync(0);

        expect(stateServiceMock.setValidationResult).toHaveBeenCalledWith(
          1,
          'testTakers',
          expect.objectContaining({ status: 'failed' })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should evaluate variables result as failed if total > 0', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        validationServiceMock.createValidationTask.mockReturnValue(
          of({ id: 1 } as ValidationTaskDto)
        );
        validationServiceMock.pollValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationResults.mockReturnValue(
          of({ total: 5 })
        );

        // We only want to test one step, but startBatch runs all.
        // We can check if setValidationResult was called with 'failed' for 'variables'
        service.startBatch(1);
        await jest.advanceTimersByTimeAsync(500 * 2); // testTakers + variables
        await jest.advanceTimersByTimeAsync(0);

        expect(stateServiceMock.setValidationResult).toHaveBeenCalledWith(
          1,
          'variables',
          expect.objectContaining({ status: 'failed' })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should evaluate testTakers result as failed if testTakersFound is false', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        validationServiceMock.createValidationTask.mockReturnValue(
          of({ id: 1 } as ValidationTaskDto)
        );
        validationServiceMock.pollValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationTask.mockReturnValue(
          of({ id: 1, status: 'completed' } as ValidationTaskDto)
        );
        validationServiceMock.getValidationResults.mockReturnValue(
          of({ testTakersFound: false })
        );

        service.startBatch(1);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(0);

        expect(stateServiceMock.setValidationResult).toHaveBeenCalledWith(
          1,
          'testTakers',
          expect.objectContaining({ status: 'failed' })
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
