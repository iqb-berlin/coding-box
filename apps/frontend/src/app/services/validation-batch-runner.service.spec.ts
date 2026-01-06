import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ValidationBatchRunnerService } from './validation-batch-runner.service';
import { BackendService } from './backend.service';
import { ValidationTaskStateService } from './validation-task-state.service';
import { ValidationTaskDto } from '../models/validation-task.dto';

describe('ValidationBatchRunnerService', () => {
  let service: ValidationBatchRunnerService;
  let backendServiceMock: jest.Mocked<BackendService>;
  let stateServiceMock: jest.Mocked<ValidationTaskStateService>;

  beforeEach(() => {
    backendServiceMock = {
      createValidationTask: jest.fn(),
      pollValidationTask: jest.fn(),
      getValidationResults: jest.fn()
    } as unknown as jest.Mocked<BackendService>;

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
        { provide: BackendService, useValue: backendServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock }
      ]
    });

    service = TestBed.inject(ValidationBatchRunnerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startBatch', () => {
    it('should run steps sequentially', () => {
      // Mock step 1: testTakers
      backendServiceMock.createValidationTask.mockReturnValue(of({ id: 1 } as ValidationTaskDto));
      backendServiceMock.pollValidationTask.mockReturnValue(of({ id: 1, status: 'completed' } as ValidationTaskDto));
      backendServiceMock.getValidationResults.mockReturnValue(of({ testTakersFound: true }));

      service.startBatch(1);

      expect(stateServiceMock.setBatchState).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'running' }));
      // At least one create task called
      expect(backendServiceMock.createValidationTask).toHaveBeenCalled();

      // Since it's observable pipeline, we verify subscriptions implicitly by effect
      // But startBatch subscribes immediately
    });

    it('should not start if already running', () => {
      stateServiceMock.getBatchState.mockReturnValue({ status: 'running' });
      service.startBatch(1);
      expect(backendServiceMock.createValidationTask).not.toHaveBeenCalled();
    });
  });
});
