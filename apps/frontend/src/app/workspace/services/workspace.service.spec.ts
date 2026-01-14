import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { WorkspaceService } from './workspace.service';
import { SERVER_URL } from '../../injection-tokens';
import { AccessRightsMatrixDto } from '../../../../../../api-dto/workspaces/access-rights-matrix-dto';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
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
        WorkspaceService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(WorkspaceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('markTestTakersAsExcluded', () => {
    it('should post excluded logins and return true', () => {
      service.markTestTakersAsExcluded(mockWorkspaceId, ['user1']).subscribe(res => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/persons/exclude`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ logins: ['user1'] });
      req.flush(true);
    });

    it('should return false if invalid args', () => {
      service.markTestTakersAsExcluded(mockWorkspaceId, []).subscribe(res => {
        expect(res).toBe(false);
      });
      httpMock.expectNone(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/persons/exclude`);
    });
  });

  describe('getAccessRightsMatrix', () => {
    it('should fetch matrix and cache it', () => {
      const mockMatrix: AccessRightsMatrixDto = { levels: [], categories: [] };

      // First call - http request
      service.getAccessRightsMatrix().subscribe(res => {
        expect(res).toEqual(mockMatrix);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/access-rights-matrix`);
      req.flush(mockMatrix);

      // Second call - should be cached
      service.getAccessRightsMatrix().subscribe(res => {
        expect(res).toEqual(mockMatrix);
      });

      httpMock.expectNone(`${mockServerUrl}admin/workspace/access-rights-matrix`);
    });
  });
});
