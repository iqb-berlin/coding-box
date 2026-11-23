import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  HttpEvent, HttpEventType, provideHttpClient, withInterceptorsFromDi
} from '@angular/common/http';
import { FileBackendService } from './file-backend.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('FileBackendService', () => {
  let service: FileBackendService;
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
        FileBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(FileBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getVocs', () => {
    it('should fetch vocs list', () => {
      service.getVocs(1, 'type').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/vocs/type`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('downloadWorkspaceFilesAsZip', () => {
    it('should post request for zip download', () => {
      service.downloadWorkspaceFilesAsZip(1, ['xml']).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/files/download-zip`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ fileTypes: ['xml'] });
      req.flush(new Blob());
    });

    it('should post request for zip download with progress events', () => {
      const receivedEventTypes: number[] = [];
      service
        .downloadWorkspaceFilesAsZipWithProgress(1, ['xml'])
        .subscribe(event => {
          receivedEventTypes.push(event.type);
        });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/files/download-zip?segmented=true`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ fileTypes: ['xml'] });
      expect(req.request.reportProgress).toBe(true);
      expect(req.request.responseType).toBe('blob');

      req.event({
        type: HttpEventType.DownloadProgress,
        loaded: 50,
        total: 100
      });
      req.flush(new Blob(['zip']));

      expect(receivedEventTypes).toContain(HttpEventType.DownloadProgress);
      expect(receivedEventTypes).toContain(HttpEventType.Response);
    });

    it('combines ZIP segments and reports progress across the entire archive', () => {
      const events: HttpEvent<Blob>[] = [];
      const url = `${mockServerUrl}admin/workspace/1/files/download-zip`;
      service.downloadWorkspaceFilesAsZipWithProgress(1).subscribe(event => events.push(event));

      httpMock.expectOne(`${url}?segmented=true`).flush(new Blob(['abc']), {
        headers: { 'X-Archive-Range': 'bytes 0-2/5', 'X-Archive-Id': 'archive' }
      });
      const last = httpMock.expectOne(`${url}/archive?offset=3`);
      expect(last.request.method).toBe('GET');
      last.event({ type: HttpEventType.DownloadProgress, loaded: 1 });
      last.flush(new Blob(['de']), {
        headers: { 'X-Archive-Range': 'bytes 3-4/5', 'X-Archive-Id': 'archive' }
      });

      expect(events).toContainEqual({ type: HttpEventType.DownloadProgress, loaded: 4, total: 5 });
      const responses = events.filter(event => event.type === HttpEventType.Response);
      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({ status: 200, body: { size: 5, type: 'application/zip' } });
    });
  });
});
