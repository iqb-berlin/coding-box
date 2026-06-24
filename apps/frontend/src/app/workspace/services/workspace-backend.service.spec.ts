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

  describe('getWorkspaceUsers', () => {
    it('should fetch workspace users with pagination parameters', () => {
      const mockResponse = {
        data: [{
          workspaceId: 1, userId: 7, accessLevel: 3, canCode: false
        }],
        total: 1,
        page: 2,
        limit: 50
      };

      service.getWorkspaceUsers(1, { page: 2, limit: 50 }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/users?page=2&limit=50`
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should fetch all workspace users across pages', () => {
      service.getAllWorkspaceUsers(1).subscribe(res => {
        expect(res).toEqual([
          {
            workspaceId: 1, userId: 1, accessLevel: 3, canCode: false
          },
          {
            workspaceId: 1, userId: 2, accessLevel: 1, canCode: true
          }
        ]);
      });

      const firstRequest = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/users?page=1&limit=500`
      );
      expect(firstRequest.request.method).toBe('GET');
      firstRequest.flush({
        data: [{
          workspaceId: 1, userId: 1, accessLevel: 3, canCode: false
        }],
        total: 2,
        page: '1',
        limit: '1'
      });

      const secondRequest = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/users?page=2&limit=500`
      );
      expect(secondRequest.request.method).toBe('GET');
      secondRequest.flush({
        data: [{
          workspaceId: 1, userId: 2, accessLevel: 1, canCode: true
        }],
        total: 2,
        page: 2,
        limit: 1
      });
    });

    it('should fail when loading all workspace users cannot fetch a later page', () => {
      const errorHandler = jest.fn();
      const nextHandler = jest.fn();

      service.getAllWorkspaceUsers(1).subscribe({
        next: nextHandler,
        error: errorHandler
      });

      const firstRequest = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/users?page=1&limit=500`
      );
      firstRequest.flush({
        data: [{
          workspaceId: 1, userId: 1, accessLevel: 3, canCode: false
        }],
        total: 2,
        page: 1,
        limit: 1
      });

      const secondRequest = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/users?page=2&limit=500`
      );
      secondRequest.flush('server error', { status: 500, statusText: 'Server Error' });

      expect(nextHandler).not.toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalled();
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
