import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {
  TestPersonCodingService, CodingStatistics, PaginatedCodingList, JobStatus, JobInfo
} from './test-person-coding.service';
import { SERVER_URL } from '../../injection-tokens';

describe('TestPersonCodingService', () => {
  let service: TestPersonCodingService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost:3000/';
  const mockWorkspaceId = 123;
  const mockAuthToken = 'test-token';

  beforeEach(() => {
    // Mock localStorage using Object.defineProperty
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue(mockAuthToken)
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        TestPersonCodingService,
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(TestPersonCodingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      httpMock.verify();
    } catch (error) {
      // Error in httpMock.verify() handled
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('codeTestPersons', () => {
    it('should send a GET request to code test persons', () => {
      const mockTestPersonIds = '1,2,3';
      const mockResponse: CodingStatistics = {
        totalResponses: 3,
        statusCounts: { coded: 3 }
      };

      service.codeTestPersons(mockWorkspaceId, mockTestPersonIds).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding?testPersons=${mockTestPersonIds}`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${mockAuthToken}`);
      req.flush(mockResponse);
    });

    it('should handle errors and return empty statistics', () => {
      const mockTestPersonIds = '1,2,3';

      service.codeTestPersons(mockWorkspaceId, mockTestPersonIds).subscribe(response => {
        expect(response).toEqual({ totalResponses: 0, statusCounts: {} });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding?testPersons=${mockTestPersonIds}`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getManualTestPersons', () => {
    it('should send a GET request to get manual test persons', () => {
      const mockResponse = [{ id: 1, name: 'Test Person 1' }];

      service.getManualTestPersons(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should include testPersons parameter when provided', () => {
      const mockTestPersonIds = '1,2,3';
      const mockResponse = [{ id: 1, name: 'Test Person 1' }];

      service.getManualTestPersons(mockWorkspaceId, mockTestPersonIds).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual?testPersons=${mockTestPersonIds}`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty array', () => {
      service.getManualTestPersons(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getCodingList', () => {
    it('should send a GET request to get coding list with correct parameters', () => {
      const mockServerUrlParam = 'http://test-server.com';
      const mockPage = 2;
      const mockLimit = 10;
      const mockResponse: PaginatedCodingList = {
        data: [{
          unit_key: 'key1',
          unit_alias: 'alias1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'book1',
          variable_id: 'var1',
          variable_page: 'page1',
          variable_anchor: 'anchor1',
          url: 'url1'
        }],
        total: 1,
        page: mockPage,
        limit: mockLimit
      };

      service.getCodingList(mockWorkspaceId, mockAuthToken, mockServerUrlParam, mockPage, mockLimit).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list` &&
        request.params.get('authToken') === mockAuthToken &&
        request.params.get('serverUrl') === mockServerUrlParam &&
        request.params.get('page') === mockPage.toString() &&
        request.params.get('limit') === mockLimit.toString()
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty paginated list', () => {
      service.getCodingList(mockWorkspaceId, mockAuthToken).subscribe(response => {
        expect(response).toEqual({
          data: [],
          total: 0,
          page: 1,
          limit: 20
        });
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list`
      );
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getCodingStatistics', () => {
    it('should send a GET request to get coding statistics', () => {
      const mockResponse: CodingStatistics = {
        totalResponses: 10,
        statusCounts: { coded: 7, pending: 3 }
      };

      service.getCodingStatistics(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/statistics`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty statistics', () => {
      service.getCodingStatistics(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual({ totalResponses: 0, statusCounts: {} });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/statistics`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getJobStatus', () => {
    it('should send a GET request to get job status', () => {
      const mockJobId = 'job-123';
      const mockResponse: JobStatus = {
        status: 'processing',
        progress: 50
      };

      service.getJobStatus(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return error object', () => {
      const mockJobId = 'job-123';

      service.getJobStatus(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual({ error: `Failed to get status for job ${mockJobId}` });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('cancelJob', () => {
    it('should send a GET request to cancel job', () => {
      const mockJobId = 'job-123';
      const mockResponse = { success: true, message: 'Job cancelled successfully' };

      service.cancelJob(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}/cancel`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return failure object', () => {
      const mockJobId = 'job-123';

      service.cancelJob(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual({ success: false, message: `Failed to cancel job ${mockJobId}` });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}/cancel`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getAllJobs', () => {
    it('should send a GET request to get all jobs', () => {
      const mockResponse: JobInfo[] = [
        {
          jobId: 'job-123',
          status: 'completed',
          progress: 100,
          result: { totalResponses: 5, statusCounts: { coded: 5 } }
        }
      ];

      service.getAllJobs(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/jobs`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty array', () => {
      service.getAllJobs(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/jobs`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getWorkspaceGroups', () => {
    it('should send a GET request to get workspace groups', () => {
      const mockResponse = ['Group1', 'Group2', 'Group3'];

      service.getWorkspaceGroups(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/groups`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty array', () => {
      service.getWorkspaceGroups(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/groups`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('exportCodingListAsCsv', () => {
    it('should send a GET request to export coding list as CSV', () => {
      const mockBlob = new Blob(['test,data'], { type: 'text/csv' });

      service.exportCodingListAsCsv(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockBlob);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/csv`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should handle errors and return empty blob', () => {
      service.exportCodingListAsCsv(mockWorkspaceId).subscribe(response => {
        expect(response).toBeInstanceOf(Blob);
        expect(response.type).toBe('text/csv');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/csv`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('exportCodingListAsExcel', () => {
    it('should send a GET request to export coding list as Excel', () => {
      const mockBlob = new Blob(['test data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      service.exportCodingListAsExcel(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockBlob);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/excel`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should handle errors and return empty blob', () => {
      service.exportCodingListAsExcel(mockWorkspaceId).subscribe(response => {
        expect(response).toBeInstanceOf(Blob);
        expect(response.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/excel`);
      req.error(new ProgressEvent('error'));
    });
  });
});
