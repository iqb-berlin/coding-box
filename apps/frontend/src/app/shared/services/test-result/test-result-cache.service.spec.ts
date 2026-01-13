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
      const mockResponse = { data: [], total: 0 };

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
