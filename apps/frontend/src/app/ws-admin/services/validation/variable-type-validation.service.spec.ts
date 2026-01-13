import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VariableTypeValidationService } from './variable-type-validation.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('VariableTypeValidationService', () => {
  let service: VariableTypeValidationService;
  let validationServiceMock: {
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
    validation_type: 'variableTypes',
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
    validationServiceMock = {
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
        VariableTypeValidationService,
        { provide: ValidationService, useValue: validationServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock }
      ]
    });

    service = TestBed.inject(VariableTypeValidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('validate', () => {
    it('should coordinate the validation process', done => {
      validationServiceMock.createValidationTask.mockReturnValue(of(mockTask));
      validationServiceMock.pollValidationTask.mockReturnValue(of(mockTask));
      validationServiceMock.getValidationResults.mockReturnValue(of(mockResult));

      service.validate(1, 10).subscribe(result => {
        expect(result).toEqual(mockResult);
        expect(validationServiceMock.createValidationTask).toHaveBeenCalledWith(workspaceId, 'variableTypes', 1, 10, undefined);
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
