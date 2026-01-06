import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { TestResultService } from './test-result.service';
import { TestResultCacheService } from './test-result-cache.service';
import { SERVER_URL } from '../injection-tokens';

describe('TestResultService', () => {
  let service: TestResultService;
  let httpMock: HttpTestingController;
  let cacheServiceMock: jest.Mocked<TestResultCacheService>;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    cacheServiceMock = {
      getTestResults: jest.fn(),
      getPersonTestResults: jest.fn(),
      invalidateWorkspaceCache: jest.fn()
    } as unknown as jest.Mocked<TestResultCacheService>;

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
        group: 'group1'
      };

      service.getFlatResponses(mockWorkspaceId, options).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/test-results/flat-responses` &&
        request.params.get('page') === '1' &&
        request.params.get('code') === 'code1'
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
