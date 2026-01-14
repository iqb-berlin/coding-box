import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
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
  });
});
