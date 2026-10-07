import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { TestResultCacheService } from './test-result-cache.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('TestResultCacheService', () => {
  let service: TestResultCacheService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        TestResultCacheService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(TestResultCacheService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTestResults', () => {
    it('should fetch and cache results', () => {
      const mockResponse = {
        data: [{
          id: 1,
          code: 'P1',
          group: 'G1',
          login: 'person-1',
          uploaded_at: '2026-10-02T08:00:00.000Z'
        }],
        total: 1
      };

      // 1. First call - network
      service.getTestResults(1, 1, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
      req.flush(mockResponse);

      // 2. Second call - cache (no request)
      service.getTestResults(1, 1, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
    });

    it('should cache a successful empty result', () => {
      const mockResponse = { data: [], total: 0 };
      const firstResult = jest.fn();
      service.getTestResults(1, 1, 10).subscribe(firstResult);

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`).flush(mockResponse);
      expect(firstResult).toHaveBeenCalledWith(mockResponse);

      const cachedResult = jest.fn();
      service.getTestResults(1, 1, 10).subscribe(cachedResult);

      expect(cachedResult).toHaveBeenCalledWith(mockResponse);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
    });

    it('should propagate HTTP errors and retry the next request instead of caching an empty result', () => {
      const next = jest.fn();
      const error = jest.fn();
      service.getTestResults(1, 1, 10).subscribe({ next, error });

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`)
        .flush({ message: 'Temporary failure' }, { status: 500, statusText: 'Internal Server Error' });

      expect(next).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));

      const mockResponse = {
        data: [{
          id: 1,
          code: 'P1',
          group: 'G1',
          login: 'person-1',
          uploaded_at: '2026-10-02T08:00:00.000Z'
        }],
        total: 1
      };
      const retriedResult = jest.fn();
      service.getTestResults(1, 1, 10).subscribe(retriedResult);

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`).flush(mockResponse);
      expect(retriedResult).toHaveBeenCalledWith(mockResponse);

      const cachedResult = jest.fn();
      service.getTestResults(1, 1, 10).subscribe(cachedResult);

      expect(cachedResult).toHaveBeenCalledWith(mockResponse);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
    });
  });

  describe('invalidateWorkspaceCache', () => {
    it('should clear cache for workspace', () => {
      const mockResponse = { data: [], total: 0 };
      service.getTestResults(1, 1, 10).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
      req.flush(mockResponse);

      service.invalidateWorkspaceCache(1);

      service.getTestResults(1, 1, 10).subscribe();
      const req2 = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
      req2.flush(mockResponse);
    });
  });
});
