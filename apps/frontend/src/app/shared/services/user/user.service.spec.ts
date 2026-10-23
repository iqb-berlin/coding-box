import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { UserService } from './user.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('UserService', () => {
  let service: UserService;
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
        UserService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getUsers', () => {
    it('should fetch users for workspace', () => {
      const mockUsers = [{ id: 1, name: 'User 1' }];
      service.getUsers(1).subscribe(res => {
        expect(res).toEqual(mockUsers as unknown);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/users/access/1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockUsers);
    });
  });

  describe('deleteUsers', () => {
    it('should delete users', () => {
      service.deleteUsers([1, 2, 3]).subscribe(res => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/users/1;2;3`);
      expect(req.request.method).toBe('DELETE');
      req.flush(true);
    });
  });

  describe('workspace access mutations', () => {
    it('should save detailed workspace access rights', () => {
      const users = [{ id: 7, accessLevel: 3, canCode: false }];

      service.saveUsers(3, users).subscribe(res => {
        expect(res).toBe(true);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/users/access/3`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(users);
      req.flush(true);
    });

    it('should return false when changing workspace assignments fails', () => {
      service.setUserWorkspaceAccessRight(7, [3]).subscribe(res => {
        expect(res).toBe(false);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/users/7/workspaces/`);
      req.flush('failed', { status: 500, statusText: 'Server Error' });
    });
  });
  describe.each(['addUser', 'changeUserData', 'deleteUsers'] as const)('%s outcome', operation => {
    it.each([200, 400, 403, 500, 0])('reports the actual outcome for HTTP %s', status => {
      const operations = {
        addUser: () => service.addUser({ username: 'new-user' }),
        changeUserData: () => service.changeUserData(7, { id: 7, username: 'updated' }),
        deleteUsers: () => service.deleteUsers([7])
      };
      const request$ = operations[operation]();
      const received: boolean[] = [];
      request$.subscribe(result => received.push(result));
      const request = httpMock.expectOne(`${mockServerUrl}admin/users${operation === 'addUser' ? '' : '/7'}`);
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush(null, { status, statusText: status === 200 ? 'OK' : 'Failed' });
      expect(received).toEqual([status === 200]);
    });
  });
});
