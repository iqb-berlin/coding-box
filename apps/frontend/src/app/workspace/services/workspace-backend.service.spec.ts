import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { WorkspaceBackendService } from './workspace-backend.service';
import { SERVER_URL } from '../../injection-tokens';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';

describe('WorkspaceBackendService', () => {
  let service: WorkspaceBackendService;
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
        WorkspaceBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(WorkspaceBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getAllWorkspacesList', () => {
    it('should fetch list', () => {
      const mockList = { data: [], total: 0 };
      service.getAllWorkspacesList().subscribe(res => {
        expect(res).toEqual(mockList as unknown);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace`);
      expect(req.request.method).toBe('GET');
      req.flush(mockList);
    });
  });

  describe('addWorkspace', () => {
    it('should populate headers and body', () => {
      const mockDto = { name: 'New' };
      service.addWorkspace(mockDto as CreateWorkspaceDto).subscribe(res => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockDto);
      req.flush(true);
    });
  });
});
