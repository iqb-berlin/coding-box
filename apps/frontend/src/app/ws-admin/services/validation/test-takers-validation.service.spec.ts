import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TestTakersValidationService } from './test-takers-validation.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('TestTakersValidationService', () => {
  let service: TestTakersValidationService;
  let validationServiceMock: jest.Mocked<ValidationService>;
  let stateServiceMock: jest.Mocked<ValidationTaskStateService>;
  let appServiceMock: jest.Mocked<AppService>;

  beforeEach(() => {
    validationServiceMock = {
      createValidationTask: jest.fn(),
      pollValidationTask: jest.fn(),
      getValidationResults: jest.fn()
    } as unknown as jest.Mocked<ValidationService>;

    stateServiceMock = {
      setTaskId: jest.fn(),
      removeTaskId: jest.fn(),
      setValidationResult: jest.fn(),
      getAllTaskIds: jest.fn().mockReturnValue({}),
      getAllValidationResults: jest.fn().mockReturnValue({})
    } as unknown as jest.Mocked<ValidationTaskStateService>;

    appServiceMock = {
      selectedWorkspaceId: 1
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        TestTakersValidationService,
        { provide: ValidationService, useValue: validationServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock },
        { provide: AppService, useValue: appServiceMock }
      ]
    });

    service = TestBed.inject(TestTakersValidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('validate', () => {
    it('should create task, poll, and save results', done => {
      const mockTask = { id: 100, status: 'completed' } as ValidationTaskDto;
      const mockResult = { testTakersFound: true, missingPersons: [] };

      validationServiceMock.createValidationTask.mockReturnValue(of(mockTask));
      validationServiceMock.pollValidationTask.mockReturnValue(of(mockTask));
      validationServiceMock.getValidationResults.mockReturnValue(of(mockResult));

      service.validate().subscribe(result => {
        expect(result).toEqual(mockResult);
        expect(validationServiceMock.createValidationTask).toHaveBeenCalledWith(1, 'testTakers', undefined, undefined, undefined);
        expect(stateServiceMock.setTaskId).toHaveBeenCalledWith(1, 'testTakers', 100);
        expect(stateServiceMock.setValidationResult).toHaveBeenCalledWith(1, 'testTakers', expect.objectContaining({ status: 'success' }));
        expect(stateServiceMock.removeTaskId).toHaveBeenCalledWith(1, 'testTakers');
        done();
      });
    });
  });

  describe('getValidationStatus', () => {
    it('should return "running" if taskId exists', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({ testTakers: 100 });
      expect(service.getValidationStatus()).toBe('running');
    });

    it('should return result status if no taskId exists', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({});
      stateServiceMock.getAllValidationResults.mockReturnValue({ testTakers: { status: 'failed', timestamp: 123 } });
      expect(service.getValidationStatus()).toBe('failed');
    });

    it('should return "not-run" if no taskId and no result exists', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({});
      stateServiceMock.getAllValidationResults.mockReturnValue({});
      expect(service.getValidationStatus()).toBe('not-run');
    });
  });

  describe('getCachedResult', () => {
    it('should return result details from state', () => {
      const mockResult = { testTakersFound: true };
      stateServiceMock.getAllValidationResults.mockReturnValue({ testTakers: { status: 'success', timestamp: 123, details: mockResult } });
      expect(service.getCachedResult()).toEqual(mockResult);
    });

    it('should return null if no result exists', () => {
      stateServiceMock.getAllValidationResults.mockReturnValue({});
      expect(service.getCachedResult()).toBeNull();
    });
  });
});
