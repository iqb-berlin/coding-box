import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ResourcePackageService } from './resource-package.service';
import { SERVER_URL } from '../injection-tokens';

describe('ResourcePackageService', () => {
  let service: ResourcePackageService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        ResourcePackageService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ResourcePackageService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('deleteResourcePackages', () => {
    it('should send delete request with ids', () => {
      service.deleteResourcePackages(mockWorkspaceId, [1, 2]).subscribe(res => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/resource-packages` &&
        request.params.get('id') === '1,2' &&
        request.params.get('workspaceId') === String(mockWorkspaceId)
      );
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('uploadResourcePackage', () => {
    it('should upload file as FormData', () => {
      const file = new File(['content'], 'test.zip');
      service.uploadResourcePackage(mockWorkspaceId, file).subscribe(res => {
        expect(res).toBe(123);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/resource-packages`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush(123);
    });
  });
});
