import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ValidationService } from './validation.service';
import { SERVER_URL } from '../../../injection-tokens';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

describe('ValidationService', () => {
  let service: ValidationService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        ValidationService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ValidationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('validateVariables', () => {
    it('should fetch variables validation results', () => {
      const mockResponse = {
        data: [], total: 0, page: 1, limit: 10
      };

      service.validateVariables(mockWorkspaceId, 1, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-variables?page=1&limit=10`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('validateVariableTypes', () => {
    it('should fetch variable types validation results', () => {
      const mockResponse = {
        data: [], total: 0, page: 1, limit: 10
      };
      service.validateVariableTypes(mockWorkspaceId, 1, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-variable-types?page=1&limit=10`);
      req.flush(mockResponse);
    });

    it('should return default on error', () => {
      service.validateVariableTypes(mockWorkspaceId, 1, 10).subscribe(res => {
        expect(res.total).toBe(0);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-variable-types?page=1&limit=10`);
      req.error(new ErrorEvent('Network error'));
    });
  });

  describe('validateResponseStatus', () => {
    it('should fetch response status validation results', () => {
      const mockResponse = {
        data: [], total: 0, page: 1, limit: 10
      };
      service.validateResponseStatus(mockWorkspaceId, 1, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-response-status?page=1&limit=10`);
      req.flush(mockResponse);
    });
  });

  describe('validateTestTakers', () => {
    it('should fetch test takers validation results', () => {
      const mockResponse = { testTakersFound: true, missingPersons: [] };
      service.validateTestTakers(mockWorkspaceId).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-testtakers`);
      req.flush(mockResponse);
    });
  });

  describe('validateGroupResponses', () => {
    it('should fetch group responses validation results', () => {
      const mockResponse = { total: 0, allGroupsHaveResponses: true };
      service.validateGroupResponses(mockWorkspaceId).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-group-responses?page=1&limit=10`);
      req.flush(mockResponse);
    });
  });

  describe('validateDuplicateResponses', () => {
    it('should fetch duplicate responses validation results', () => {
      const mockResponse = { data: [], total: 0 };
      service.validateDuplicateResponses(mockWorkspaceId).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/validate-duplicate-responses?page=1&limit=10`);
      req.flush(mockResponse);
    });
  });

  describe('resolveDuplicateResponses', () => {
    it('should post resolution data', () => {
      const mockResponse = { success: true, resolvedCount: 1 };
      service.resolveDuplicateResponses(mockWorkspaceId, { resolutionMap: {} }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/responses/resolve-duplicates`);
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });

  describe('deleteInvalidResponses', () => {
    it('should send delete request with ids', () => {
      service.deleteInvalidResponses(mockWorkspaceId, [1, 2]).subscribe(res => {
        expect(res).toBe(2);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/invalid-responses?responseIds=1,2`);
      expect(req.request.method).toBe('DELETE');
      req.flush(2);
    });
  });

  describe('deleteAllInvalidResponses', () => {
    it('should send delete all request with type', () => {
      service.deleteAllInvalidResponses(mockWorkspaceId, 'variables').subscribe(res => {
        expect(res).toBe(10);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/files/all-invalid-responses?validationType=variables`);
      expect(req.request.method).toBe('DELETE');
      req.flush(10);
    });
  });

  describe('getValidationTask', () => {
    it('should fetch single task', () => {
      const mockTask = { id: 123 };
      service.getValidationTask(mockWorkspaceId, 123).subscribe(res => {
        expect(res).toEqual(mockTask);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/123`);
      req.flush(mockTask);
    });
  });

  describe('getValidationTasks', () => {
    it('should fetch all tasks', () => {
      const mockTasks = [{ id: 1 }];
      service.getValidationTasks(mockWorkspaceId).subscribe(res => {
        expect(res).toEqual(mockTasks);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks`);
      req.flush(mockTasks);
    });
  });

  describe('createValidationTask', () => {
    it('should create task with parameters and additional data', () => {
      const mockTask = { id: 1, status: 'pending' } as ValidationTaskDto;
      const additionalData = { list: [1, 2], single: 'test' };

      service.createValidationTask(mockWorkspaceId, 'deleteResponses', undefined, undefined, additionalData)
        .subscribe(res => {
          expect(res).toEqual(mockTask);
        });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks` &&
        request.params.get('type') === 'deleteResponses' &&
        request.params.get('list') === '1,2' &&
        request.params.get('single') === 'test'
      );
      expect(req.request.method).toBe('POST');
      req.flush(mockTask);
    });
  });

  describe('pollValidationTask', () => {
    it('should poll until completed', fakeAsync(() => {
      const taskId = 100;

      // Sequence of task states
      const taskPending = { id: taskId, status: 'pending' } as ValidationTaskDto;
      const taskProcessing = { id: taskId, status: 'processing', progress: 50 } as ValidationTaskDto;
      const taskCompleted = { id: taskId, status: 'completed' } as ValidationTaskDto;

      service.pollValidationTask(mockWorkspaceId, taskId, 1000).subscribe(() => {
      });

      // Initial tick (0s) - No request yet because interval waits
      tick(0);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/${taskId}`);

      // First tick (1s) - First Request
      tick(1000);
      const req1 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/${taskId}`);
      req1.flush(taskPending);

      // Second tick (2s) - Second Request
      tick(1000);
      const req2 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/${taskId}`);
      req2.flush(taskProcessing);

      // Third tick (3s) - Third Request
      tick(1000);
      const req3 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/${taskId}`);
      req3.flush(taskCompleted);

      // Since it completed, no more requests should happen.
      tick(1000);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/${taskId}`);
    }));
  });

  describe('getLastValidationResults', () => {
    it('should fetch tasks and results for completed items', () => {
      const mockTasks = [
        {
          id: 1, validation_type: 'variables', status: 'completed', created_at: '2023-01-01'
        },
        {
          id: 2, validation_type: 'variables', status: 'completed', created_at: '2023-01-02'
        } // newer
      ] as unknown as ValidationTaskDto[];

      const mockResult = { items: [] };

      service.getLastValidationResults(mockWorkspaceId).subscribe(res => {
        expect(res.variables).toBeDefined();
        expect(res.variables.task.id).toBe(2);
        expect(res.variables.result).toEqual(mockResult);
      });

      // 1. Get Tasks
      const reqTasks = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks`);
      reqTasks.flush(mockTasks);

      // 2. Get Results for the latest task (ID 2)
      const reqResult = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks/2/results`);
      reqResult.flush(mockResult);
    });

    it('should handle empty tasks list', () => {
      service.getLastValidationResults(mockWorkspaceId).subscribe(res => {
        expect(res).toEqual({});
      });
      const reqTasks = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/validation-tasks`);
      reqTasks.flush([]);
    });
  });
});
