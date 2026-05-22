import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { TestResultService } from './test-result.service';
import { TestResultCacheService } from './test-result-cache.service';
import { SERVER_URL } from '../../../injection-tokens';
import { ValidationTaskStateService } from '../validation/validation-task-state.service';

describe('TestResultService', () => {
  let service: TestResultService;
  let httpMock: HttpTestingController;
  let cacheServiceMock: jest.Mocked<TestResultCacheService>;
  let validationTaskStateServiceMock: { invalidateWorkspace: jest.Mock };

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    cacheServiceMock = {
      getTestResults: jest.fn(),
      getPersonTestResults: jest.fn(),
      invalidateWorkspaceCache: jest.fn()
    } as unknown as jest.Mocked<TestResultCacheService>;
    validationTaskStateServiceMock = {
      invalidateWorkspace: jest.fn()
    };

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        TestResultService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: TestResultCacheService, useValue: cacheServiceMock },
        {
          provide: ValidationTaskStateService,
          useValue: validationTaskStateServiceMock
        },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(TestResultService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTestResults', () => {
    it('should delegate to cache service', () => {
      const mockResponse = { data: [], total: 0 };
      cacheServiceMock.getTestResults.mockReturnValue(of(mockResponse));

      service.getTestResults(mockWorkspaceId, 1, 10, 'search').subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      expect(cacheServiceMock.getTestResults).toHaveBeenCalledWith(mockWorkspaceId, 1, 10, 'search');
    });
  });

  describe('getFlatResponses', () => {
    it('should fetch flat responses with parameters', () => {
      const mockResponse = {
        data: [], total: 0, page: 1, limit: 10
      };
      const options = {
        page: 1,
        limit: 10,
        code: 'code1',
        group: 'group1',
        logAnomalies: 'critical',
        includeLogAnomalies: 'true'
      };

      service.getFlatResponses(mockWorkspaceId, options).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/flat-responses` &&
        request.params.get('page') === '1' &&
        request.params.get('code') === 'code1' &&
        request.params.get('logAnomalies') === 'critical' &&
        request.params.get('includeLogAnomalies') === 'true'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors', () => {
      const options = { page: 1, limit: 10 };

      service.getFlatResponses(mockWorkspaceId, options).subscribe(res => {
        expect(res).toEqual({
          data: [], total: 0, page: 1, limit: 10
        });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/flat-responses?page=1&limit=10`);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getLogAnomalySummary', () => {
    it('should fetch log anomaly summary with threshold parameters', () => {
      const mockResponse = {
        totalBooklets: 10,
        affectedBooklets: 2,
        criticalBooklets: 1,
        warningBooklets: 1,
        infoBooklets: 0,
        totalAnomalyRules: 3,
        totalAnomalyEvents: 4,
        byCode: { controller_error: 1 }
      };

      service.getLogAnomalySummary(mockWorkspaceId, {
        longLoadingThresholdMs: '8000'
      }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/log-anomaly-summary` &&
        request.params.get('longLoadingThresholdMs') === '8000'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should propagate summary load errors', done => {
      service.getLogAnomalySummary(mockWorkspaceId).subscribe({
        next: () => {
          throw new Error('Expected log anomaly summary request to fail');
        },
        error: error => {
          expect(error.status).toBe(500);
          done();
        }
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/log-anomaly-summary`
      );
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getLogAnomalyDetails', () => {
    it('should fetch log anomaly details with limit parameter', () => {
      const mockResponse = {
        total: 1,
        data: []
      };

      service.getLogAnomalyDetails(mockWorkspaceId, {
        limit: '20'
      }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/log-anomaly-details` &&
        request.params.get('limit') === '20'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should propagate details load errors', done => {
      service.getLogAnomalyDetails(mockWorkspaceId).subscribe({
        next: () => {
          throw new Error('Expected log anomaly details request to fail');
        },
        error: error => {
          expect(error.status).toBe(500);
          done();
        }
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/log-anomaly-details`
      );
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('requestFlatResponseFilters', () => {
    it('should emit forced log anomaly table requests', done => {
      service.flatResponseFilterRequests$.subscribe(request => {
        expect(request).toEqual({
          workspaceId: mockWorkspaceId,
          filters: { logAnomalies: 'any' },
          forceShowLogAnomalies: true
        });
        done();
      });

      service.requestFlatResponseFilters(
        mockWorkspaceId,
        { logAnomalies: 'any' },
        { forceShowLogAnomalies: true }
      );
    });
  });

  describe('quickSearch', () => {
    it('should fetch quick search results', () => {
      const mockResponse = {
        query: 'unit',
        limit: 8,
        persons: [],
        booklets: [],
        units: [{
          kind: 'unit' as const,
          id: 4,
          label: 'Unit 1',
          unitId: 4
        }],
        responses: [],
        totals: {
          person: 0,
          booklet: 0,
          unit: 1,
          response: 0
        }
      };

      service.quickSearch(mockWorkspaceId, 'unit', 8).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/quick-search` &&
        request.params.get('q') === 'unit' &&
        request.params.get('limit') === '8'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('invalidateCache', () => {
    it('should call cache service and emit subject', () => {
      let emittedId: number | undefined;
      service.workspaceCacheInvalidated$.subscribe(id => {
        emittedId = id;
      });

      service.invalidateCache(mockWorkspaceId);

      expect(cacheServiceMock.invalidateWorkspaceCache).toHaveBeenCalledWith(mockWorkspaceId);
      expect(emittedId).toBe(mockWorkspaceId);
    });
  });
});
