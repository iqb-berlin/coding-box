import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { TestTakersValidationService } from './test-takers-validation.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { TestTakersValidationDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('TestTakersValidationService', () => {
  let service: TestTakersValidationService;
  let validationServiceMock: {
    createValidationTask: jest.Mock;
    pollValidationTask: jest.Mock;
    getValidationResults: jest.Mock;
  };
  let appServiceMock: Partial<AppService>;
  let stateServiceMock: {
    setTaskId: jest.Mock;
    removeTaskId: jest.Mock;
    setValidationResult: jest.Mock;
    getAllTaskIds: jest.Mock;
    getAllValidationResults: jest.Mock;
  };

  const workspaceId = 1;
  const mockTask: ValidationTaskDto = {
    id: 123,
    workspace_id: workspaceId,
    status: 'completed',
    validation_type: 'testTakers',
    created_at: new Date(),
    updated_at: new Date()
  };
  const mockResult: TestTakersValidationDto = {
    testTakersFound: true,
    totalGroups: 10,
    totalLogins: 100,
    totalBookletCodes: 50,
    missingPersons: []
  };

  beforeEach(() => {
    validationServiceMock = {
      createValidationTask: jest.fn(),
      pollValidationTask: jest.fn(),
      getValidationResults: jest.fn()
    };
    appServiceMock = {
      selectedWorkspaceId: workspaceId
    };
    stateServiceMock = {
      setTaskId: jest.fn(),
      removeTaskId: jest.fn(),
      setValidationResult: jest.fn(),
      getAllTaskIds: jest.fn(),
      getAllValidationResults: jest.fn()
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        TestTakersValidationService,
        { provide: ValidationService, useValue: validationServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock }
      ]
    });

    service = TestBed.inject(TestTakersValidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('validate', () => {
    it('should coordinate the validation process', done => {
      validationServiceMock.createValidationTask.mockReturnValue(of(mockTask));
      validationServiceMock.pollValidationTask.mockReturnValue(of(mockTask));
      validationServiceMock.getValidationResults.mockReturnValue(of(mockResult));

      service.validate().subscribe(result => {
        expect(result).toEqual(mockResult);
        expect(validationServiceMock.createValidationTask).toHaveBeenCalledWith(workspaceId, 'testTakers', undefined, undefined, undefined);
        expect(stateServiceMock.setTaskId).toHaveBeenCalledWith(workspaceId, 'testTakers', mockTask.id);
        expect(stateServiceMock.setValidationResult).toHaveBeenCalled();
        expect(stateServiceMock.removeTaskId).toHaveBeenCalledWith(workspaceId, 'testTakers');
        done();
      });
    });

    it('should handle errors in validation process', done => {
      validationServiceMock.createValidationTask.mockReturnValue(throwError(() => new Error('Error')));

      service.validate().subscribe({
        error: err => {
          expect(err.message).toBe('Error');
          done();
        }
      });
    });
  });

  describe('getValidationStatus', () => {
    it('should return "running" if task exists', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({ testTakers: 123 });
      expect(service.getValidationStatus()).toBe('running');
    });

    it('should return "not-run" if no results', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({});
      stateServiceMock.getAllValidationResults.mockReturnValue({});
      expect(service.getValidationStatus()).toBe('not-run');
    });

    it('should return "success" if result is clean', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({});
      stateServiceMock.getAllValidationResults.mockReturnValue({
        testTakers: { status: 'success', timestamp: 0, details: mockResult }
      });
      expect(service.getValidationStatus()).toBe('success');
    });

    it('should return "failed" if result has errors', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({});
      stateServiceMock.getAllValidationResults.mockReturnValue({
        testTakers: { status: 'failed', timestamp: 0, details: { ...mockResult, testTakersFound: false } }
      });
      expect(service.getValidationStatus()).toBe('failed');
    });
  });

  describe('getCachedResult', () => {
    it('should return cached result from state', () => {
      stateServiceMock.getAllValidationResults.mockReturnValue({
        testTakers: { status: 'success', timestamp: 0, details: mockResult }
      });
      expect(service.getCachedResult() as unknown as TestTakersValidationDto).toEqual(mockResult);
    });

    it('should return null if no cached result', () => {
      stateServiceMock.getAllValidationResults.mockReturnValue({});
      expect(service.getCachedResult()).toBeNull();
    });
  });
});
