import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ResponseStatusValidationService } from './response-status-validation.service';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ValidationTaskStateService } from '../../../services/validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('ResponseStatusValidationService', () => {
  let service: ResponseStatusValidationService;
  let backendServiceMock: {
    createValidationTask: jest.Mock;
    pollValidationTask: jest.Mock;
    getValidationResults: jest.Mock;
    createDeleteResponsesTask: jest.Mock;
    createDeleteAllResponsesTask: jest.Mock;
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
    validation_type: 'responseStatus',
    created_at: new Date(),
    updated_at: new Date()
  };
  const mockResult = {
    data: [],
    total: 0,
    page: 1,
    limit: 10
  };

  beforeEach(() => {
    backendServiceMock = {
      createValidationTask: jest.fn(),
      pollValidationTask: jest.fn(),
      getValidationResults: jest.fn(),
      createDeleteResponsesTask: jest.fn(),
      createDeleteAllResponsesTask: jest.fn()
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
        ResponseStatusValidationService,
        { provide: BackendService, useValue: backendServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock }
      ]
    });

    service = TestBed.inject(ResponseStatusValidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('validate', () => {
    it('should coordinate the validation process', done => {
      backendServiceMock.createValidationTask.mockReturnValue(of(mockTask));
      backendServiceMock.pollValidationTask.mockReturnValue(of(mockTask));
      backendServiceMock.getValidationResults.mockReturnValue(of(mockResult));

      service.validate(1, 10).subscribe(result => {
        expect(result).toEqual(mockResult);
        expect(backendServiceMock.createValidationTask).toHaveBeenCalledWith(workspaceId, 'responseStatus', 1, 10, undefined);
        done();
      });
    });
  });
  const calculateStatus = 'calculateStatus';

  describe('calculateStatus', () => {
    it('should return "failed" if there are errors', () => {
      const result = { ...mockResult, total: 5 };
      expect(service[calculateStatus](result)).toBe('failed');
    });

    it('should return "success" if there are no errors', () => {
      const result = { ...mockResult, total: 0 };
      expect(service[calculateStatus](result)).toBe('success');
    });
  });
});
