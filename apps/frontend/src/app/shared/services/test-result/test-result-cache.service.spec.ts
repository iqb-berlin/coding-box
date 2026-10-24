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
    it('translates zero-based table indices into one-based API pages with separate cache entries', () => {
      for (const page of [0, 1, 2]) {
        const next = jest.fn();
        service.getTestResults(1, page, 50, ' G1 ').subscribe(next);
        const request = httpMock.expectOne(req => req.url.endsWith('/test-results/') &&
          req.params.get('page') === String(page + 1));
        expect(request.request.params.get('limit')).toBe('50');
        expect(request.request.params.get('searchText')).toBe('G1');
        const response = { data: [], total: page + 1 };
        request.flush(response);
        expect(next).toHaveBeenCalledWith(response);
      }
      const cached = jest.fn();
      service.getTestResults(1, 1, 50, ' G1 ').subscribe(cached);
      expect(cached).toHaveBeenCalledWith({ data: [], total: 2 });
      httpMock.expectNone(req => req.url.endsWith('/test-results/'));
    });

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
      service.getTestResults(1, 0, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
      req.flush(mockResponse);

      // 2. Second call - cache (no request)
      service.getTestResults(1, 0, 10).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
    });

    it('should cache a successful empty result', () => {
      const mockResponse = { data: [], total: 0 };
      const firstResult = jest.fn();
      service.getTestResults(1, 0, 10).subscribe(firstResult);

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`).flush(mockResponse);
      expect(firstResult).toHaveBeenCalledWith(mockResponse);

      const cachedResult = jest.fn();
      service.getTestResults(1, 0, 10).subscribe(cachedResult);

      expect(cachedResult).toHaveBeenCalledWith(mockResponse);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
    });

    it('should propagate HTTP errors and retry the next request instead of caching an empty result', () => {
      const next = jest.fn();
      const error = jest.fn();
      service.getTestResults(1, 0, 10).subscribe({ next, error });

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
      service.getTestResults(1, 0, 10).subscribe(retriedResult);

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`).flush(mockResponse);
      expect(retriedResult).toHaveBeenCalledWith(mockResponse);

      const cachedResult = jest.fn();
      service.getTestResults(1, 0, 10).subscribe(cachedResult);

      expect(cachedResult).toHaveBeenCalledWith(mockResponse);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
    });
  });

  describe('request ordering and invalidation', () => {
    const listUrl = (workspaceId = 1) => `${mockServerUrl}admin/workspace/${workspaceId}/test-results/?page=1&limit=10`;
    const response = (id: number) => ({
      data: [{
        id, code: `P${id}`, group: 'G1', login: `person-${id}`, uploaded_at: '2026-10-16T08:00:00.000Z'
      }],
      total: 1
    });

    it.each(['workspace', 'all'])('does not refill the %s cache from a request invalidated while pending', scope => {
      service.getTestResults(1, 0, 10).subscribe();
      const oldRequest = httpMock.expectOne(listUrl());
      if (scope === 'workspace') service.invalidateWorkspaceCache(1);
      else service.clearCache();
      oldRequest.flush(response(1));

      const next = jest.fn();
      service.getTestResults(1, 0, 10).subscribe(next);
      const freshRequests = httpMock.match(listUrl());
      freshRequests.forEach(request => request.flush(response(2)));
      expect(freshRequests).toHaveLength(1);
      expect(next).toHaveBeenCalledWith(response(2));
    });

    it('keeps the newest response cached when an older request completes afterwards', () => {
      service.getTestResults(1, 0, 10).subscribe();
      const oldRequest = httpMock.expectOne(listUrl());
      service.getTestResults(1, 0, 10).subscribe();
      const currentRequest = httpMock.expectOne(listUrl());
      currentRequest.flush(response(2));
      oldRequest.flush(response(1));

      const cached = jest.fn();
      service.getTestResults(1, 0, 10).subscribe(cached);
      httpMock.expectNone(listUrl());
      expect(cached).toHaveBeenCalledWith(response(2));
    });

    it('does not cache an older success after the latest request fails', () => {
      service.getTestResults(1, 0, 10).subscribe();
      const oldRequest = httpMock.expectOne(listUrl());
      const failure = jest.fn();
      service.getTestResults(1, 0, 10).subscribe({ error: failure });
      const latestRequest = httpMock.expectOne(listUrl());
      latestRequest.flush({}, { status: 500, statusText: 'Temporary failure' });
      oldRequest.flush(response(1));

      const next = jest.fn();
      service.getTestResults(1, 0, 10).subscribe(next);
      const freshRequests = httpMock.match(listUrl());
      freshRequests.forEach(request => request.flush(response(2)));
      expect(failure).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
      expect(freshRequests).toHaveLength(1);
      expect(next).toHaveBeenCalledWith(response(2));
    });

    it('rechecks the cache when an observable is subscribed after invalidation', () => {
      service.getTestResults(1, 0, 10).subscribe();
      httpMock.expectOne(listUrl()).flush(response(1));
      const deferred = service.getTestResults(1, 0, 10);
      service.invalidateWorkspaceCache(1);
      const next = jest.fn();
      deferred.subscribe(next);
      const freshRequests = httpMock.match(listUrl());
      freshRequests.forEach(request => request.flush(response(2)));
      expect(freshRequests).toHaveLength(1);
      expect(next).toHaveBeenCalledWith(response(2));
    });

    it('also prevents invalidated person details from refilling the cache', () => {
      const url = `${mockServerUrl}admin/workspace/1/test-results/7`;
      service.getPersonTestResults(1, 7).subscribe();
      const oldRequest = httpMock.expectOne(url);
      service.invalidateWorkspaceCache(1);
      oldRequest.flush([{ name: 'old-booklet' }]);
      const next = jest.fn();
      service.getPersonTestResults(1, 7).subscribe(next);
      const freshRequests = httpMock.match(url);
      freshRequests.forEach(request => request.flush([{ name: 'new-booklet' }]));
      expect(freshRequests).toHaveLength(1);
      expect(next).toHaveBeenCalledWith([{ name: 'new-booklet' }]);
    });

    it('preserves workspace 10 when invalidating workspace 1', () => {
      service.getTestResults(10, 0, 10).subscribe();
      httpMock.expectOne(listUrl(10)).flush(response(10));
      service.invalidateWorkspaceCache(1);
      const cached = jest.fn();
      service.getTestResults(10, 0, 10).subscribe(cached);
      const unexpectedRequests = httpMock.match(listUrl(10));
      unexpectedRequests.forEach(request => request.flush(response(10)));
      expect(unexpectedRequests).toHaveLength(0);
      expect(cached).toHaveBeenCalledWith(response(10));
    });
  });

  describe('invalidateWorkspaceCache', () => {
    it('should clear cache for workspace', () => {
      const mockResponse = { data: [], total: 0 };
      service.getTestResults(1, 0, 10).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
      req.flush(mockResponse);

      service.invalidateWorkspaceCache(1);

      service.getTestResults(1, 0, 10).subscribe();
      const req2 = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/test-results/?page=1&limit=10`);
      req2.flush(mockResponse);
    });
  });
});
