import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ResponseService } from './response.service';
import { TestResultService } from '../test-result/test-result.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('ResponseService', () => {
  let service: ResponseService;
  let httpMock: HttpTestingController;
  let testResultServiceMock: jest.Mocked<TestResultService>;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    testResultServiceMock = {
      invalidateCache: jest.fn()
    } as unknown as jest.Mocked<TestResultService>;

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        ResponseService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: TestResultService, useValue: testResultServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ResponseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('deleteMultipleResponses', () => {
    it('should batch delete and invalidate cache on success', () => {
      const responseIds = [1, 2];
      const mockResult = { success: true, report: { deletedResponse: 1, warnings: [] } };

      service.deleteMultipleResponses(mockWorkspaceId, responseIds).subscribe(res => {
        expect(res.success).toBe(true);
      });

      const req1 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/responses/1`);
      const req2 = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/responses/2`);

      req1.flush(mockResult);
      req2.flush(mockResult);

      // Should have been called because at least one succeeded
      expect(testResultServiceMock.invalidateCache).toHaveBeenCalledWith(mockWorkspaceId);
    });
  });

  describe('searchResponses', () => {
    it('should build query params correctly', () => {
      const searchParams = { version: 'v1' as const, value: 'test' };
      const mockResponse = { data: [], total: 0 };

      service.searchResponses(mockWorkspaceId, searchParams).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/responses/search` &&
        request.params.get('version') === 'v1' &&
        request.params.get('value') === 'test'
      );
      req.flush(mockResponse);
    });
  });
});
