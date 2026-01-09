import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VariableValidationService } from './variable-validation.service';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ValidationTaskStateService } from '../../../services/validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('VariableValidationService', () => {
  let service: VariableValidationService;
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
    validation_type: 'variables',
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
        VariableValidationService,
        { provide: BackendService, useValue: backendServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock }
      ]
    });

    service = TestBed.inject(VariableValidationService);
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
        expect(backendServiceMock.createValidationTask).toHaveBeenCalledWith(workspaceId, 'variables', 1, 10, undefined);
        done();
      });
    });
  });

  describe('deleteSelected', () => {
    it('should coordinate deletion of selected responses', done => {
      const responseIds = [1, 2, 3];
      const deleteMockTask = { ...mockTask, validation_type: 'deleteResponses' as const };
      backendServiceMock.createDeleteResponsesTask.mockReturnValue(of(deleteMockTask));
      backendServiceMock.pollValidationTask.mockReturnValue(of(deleteMockTask));

      service.deleteSelected(responseIds).subscribe(() => {
        expect(backendServiceMock.createDeleteResponsesTask).toHaveBeenCalledWith(workspaceId, responseIds);
        expect(stateServiceMock.setTaskId).toHaveBeenCalledWith(workspaceId, 'variables', mockTask.id);
        expect(stateServiceMock.removeTaskId).toHaveBeenCalledWith(workspaceId, 'variables');
        done();
      });
    });
  });

  describe('deleteAll', () => {
    it('should coordinate deletion of all invalid responses', done => {
      const deleteMockTask = { ...mockTask, validation_type: 'deleteAllResponses' as const };
      backendServiceMock.createDeleteAllResponsesTask.mockReturnValue(of(deleteMockTask));
      backendServiceMock.pollValidationTask.mockReturnValue(of(deleteMockTask));

      service.deleteAll().subscribe(() => {
        expect(backendServiceMock.createDeleteAllResponsesTask).toHaveBeenCalledWith(workspaceId, 'variables');
        expect(stateServiceMock.setTaskId).toHaveBeenCalledWith(workspaceId, 'variables', mockTask.id);
        done();
      });
    });
  });

  describe('getValidationStatus', () => {
    it('should return "running" if task exists', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({ variables: 123 });
      expect(service.getValidationStatus()).toBe('running');
    });

    it('should return status from state', () => {
      stateServiceMock.getAllTaskIds.mockReturnValue({});
      stateServiceMock.getAllValidationResults.mockReturnValue({
        variables: { status: 'failed', timestamp: 0, details: mockResult }
      });
      expect(service.getValidationStatus()).toBe('failed');
    });
  });
});
