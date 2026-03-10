import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FileService } from './file.service';
import { TestResultService } from '../test-result/test-result.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('FileService', () => {
  let service: FileService;
  let httpMock: HttpTestingController;
  let testResultServiceMock: jest.Mocked<TestResultService>;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    testResultServiceMock = {
      invalidateCache: jest.fn()
    } as unknown as jest.Mocked<TestResultService>;

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        FileService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: TestResultService, useValue: testResultServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(FileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getFilesList', () => {
    it('should get files list with parameters', () => {
      const mockResponse = {
        data: [], total: 0, page: 1, limit: 10, fileTypes: []
      };

      service.getFilesList(mockWorkspaceId, 1, 10, 'xml', '100', 'test').subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` &&
        request.params.get('page') === '1' &&
        request.params.get('limit') === '10' &&
        request.params.get('fileType') === 'xml' &&
        request.params.get('fileSize') === '100' &&
        request.params.get('searchText') === 'test'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('deleteFiles', () => {
    it('should batch delete requests', () => {
      // Create 150 IDs
      const fileIds = Array.from({ length: 150 }, (_, i) => i + 1);

      service.deleteFiles(mockWorkspaceId, fileIds).subscribe(result => {
        expect(result).toBe(true);
      });

      // Sequential requests:
      // First batch (0-100)
      const req1 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      const firstBatchIds = req1.request.params.get('fileIds');
      expect(firstBatchIds?.split(',').length).toBe(100);
      req1.flush({});

      // Second batch (100-150) - Only appears after first one resolves
      const req2 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      const secondBatchIds = req2.request.params.get('fileIds');
      expect(secondBatchIds?.split(',').length).toBe(50);
      req2.flush({});
    });
  });

  describe('uploadTestFiles', () => {
    it('should upload FormData', () => {
      const file = new File(['content'], 'test.xml', { type: 'text/xml' });
      const fileList = {
        0: file,
        length: 1,
        item: () => file
      } as unknown as FileList;

      service.uploadTestFiles(mockWorkspaceId, fileList).subscribe();

      const req = httpMock.expectOne(request => request.url.includes('/upload'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      expect(req.request.body.has('files')).toBe(true);
      req.flush({});
    });
  });
});
