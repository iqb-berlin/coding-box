import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ValidationService } from './validation.service';
import { SERVER_URL } from '../injection-tokens';
import { ValidationTaskDto } from '../models/validation-task.dto';

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
        // We only receive responses while the condition is true (pending or processing) OR the final one?
        // takeWhile(..., true) emits the value that caused the condition to break.
        // So we expect: pending -> processing -> completed.
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
  });
});
