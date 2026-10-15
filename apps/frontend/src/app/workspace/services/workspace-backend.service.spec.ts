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
      const mockList = {
        data: [], total: 0, page: 1, limit: 0
      };
      service.getAllWorkspacesList().subscribe(res => {
        expect(res).toEqual(mockList as unknown);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace`);
      expect(req.request.method).toBe('GET');
      req.flush(mockList);
    });
  });

  it('propagates workspace list failures for access-rights selection', () => {
    const error = jest.fn();
    const next = jest.fn();
    service.getAllWorkspacesListOrFail().subscribe({ next, error });
    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace`);
    expect(req.request.method).toBe('GET');
    req.flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
  });

  describe('complete workspace list', () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Workspace ${index + 1}` }));

    it('emits all workspaces only after the final page, including string pagination metadata', () => {
      const next = jest.fn();
      service.getAllWorkspacesListOrFail().subscribe(next);
      httpMock.expectOne(`${mockServerUrl}admin/workspace`).flush({
        data: firstPage, total: 21, page: '1', limit: '20'
      });
      expect(next).not.toHaveBeenCalled();
      httpMock.expectOne(`${mockServerUrl}admin/workspace?page=2&limit=20`).flush({
        data: [{ id: 21, name: 'Workspace 21' }], total: 21, page: 2, limit: 20
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0].data.map((workspace: { id: number }) => workspace.id))
        .toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    });

    it('propagates a later page failure without emitting partial rights choices', () => {
      const next = jest.fn();
      const error = jest.fn();
      service.getAllWorkspacesListOrFail().subscribe({ next, error });
      httpMock.expectOne(`${mockServerUrl}admin/workspace`).flush({
        data: firstPage, total: 21, page: 1, limit: 20
      });
      httpMock.expectOne(`${mockServerUrl}admin/workspace?page=2&limit=20`)
        .flush('Unavailable', { status: 503, statusText: 'Unavailable' });
      expect(next).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
    });

    it.each([
      {
        data: [{ id: 21, name: 'Last' }], total: 21, page: 1, limit: 20
      },
      {
        data: [{ id: 21, name: 'Last' }], total: 22, page: 2, limit: 20
      },
      {
        data: [{ id: 1, name: 'Duplicate' }], total: 21, page: 2, limit: 20
      }
    ])('rejects inconsistent pagination or duplicate workspaces: %j', response => {
      const next = jest.fn();
      const error = jest.fn();
      service.getAllWorkspacesListOrFail().subscribe({ next, error });
      httpMock.expectOne(`${mockServerUrl}admin/workspace`).flush({
        data: firstPage, total: 21, page: 1, limit: 20
      });
      httpMock.expectOne(`${mockServerUrl}admin/workspace?page=2&limit=20`).flush(response);
      expect(next).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });

    it('rejects a truncated final page without emitting a partial list', () => {
      const next = jest.fn();
      const error = jest.fn();
      service.getAllWorkspacesListOrFail().subscribe({ next, error });
      httpMock.expectOne(`${mockServerUrl}admin/workspace`).flush({
        data: firstPage, total: 21, page: 1, limit: 20
      });
      httpMock.expectOne(`${mockServerUrl}admin/workspace?page=2&limit=20`).flush({
        data: [], total: 21, page: 2, limit: 20
      });
      expect(next).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
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
    it('should return the created workspace id', () => {
      const mockDto = { name: 'New' };
      service.addWorkspace(mockDto as CreateWorkspaceDto).subscribe(res => {
        expect(res).toBe(17);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockDto);
      req.flush(17);
    });

    it('should return null when workspace creation fails', () => {
      service.addWorkspace({ name: 'New' } as CreateWorkspaceDto).subscribe(res => {
        expect(res).toBeNull();
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace`);
      req.flush('failed', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('workspace mutations', () => {
    it.each([
      { method: 'deleteWorkspace', httpMethod: 'DELETE' },
      { method: 'changeWorkspace', httpMethod: 'PATCH' }
    ] as const)('should return false when $method fails', ({ method, httpMethod }) => {
      const request$ = method === 'deleteWorkspace' ?
        service.deleteWorkspace([3]) :
        service.changeWorkspace({ id: 3, name: 'Renamed' });

      request$.subscribe(res => {
        expect(res).toBe(false);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace`);
      expect(req.request.method).toBe(httpMethod);
      req.flush('failed', { status: 500, statusText: 'Server Error' });
    });
  });
});
