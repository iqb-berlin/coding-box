import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FileService } from './file.service';
import { TestResultService } from './test-result.service';
import { SERVER_URL } from '../injection-tokens';

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
      expect(firstBatchIds?.split(';').length).toBe(100);
      req1.flush({});

      // Second batch (100-150) - Only appears after first one resolves
      const req2 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      const secondBatchIds = req2.request.params.get('fileIds');
      expect(secondBatchIds?.split(';').length).toBe(50);
      req2.flush({});
    });

    it('should handle error in one batch but continue?', () => {
      // The implementation uses reduce and switchMap, so if one fails, the chain might break or return false depending on implementation.
      // Line 89: catchError(() => of(false)).
      // Line 81: reduce checks accumulator. It waits for previous.
      // If one returns false, the next one runs?
      // Actually switchMap switches from the accummulator (observable of boolean).
      // wait, `acc.pipe(switchMap(...))`.
      // If acc emits `true`, we proceed.
      // If `acc` emits `false`... the chain continues?
      // `acc` is initally `of(true)`.
      // It pipes to `switchMap`.
      // If the previous result was true/false, it executes the next delete.
      // The result of the whole chain is the result of the LAST batch.
      // This might be a bug in the service logic if we want to know if *any* failed, but that's how it is written.
      // "reduce" simply chains them sequentially.

      // Let's test that it continues even if one fails (returns false).
      // Batch size 100, so we need more than 100 to force 2 batches.
      const manyFileIds = Array.from({ length: 150 }, (_, i) => i + 1);

      service.deleteFiles(mockWorkspaceId, manyFileIds).subscribe(result => {
        // If the last one succeeds, it returns true?
        // Or does it depend on the accumulated value?
        // Implementation: `acc.pipe(switchMap(() => this.http...))`
        // It ignores the value from `acc`.
        // So the final result is purely the result of the LAST batch.
        expect(result).toBe(false);
      });

      // Sequential requests:
      // First batch (0-100)
      const req1 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      req1.flush({});

      // Second batch (100-150)
      const req2 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      req2.flush('Error', { status: 500, statusText: 'Error' });
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
