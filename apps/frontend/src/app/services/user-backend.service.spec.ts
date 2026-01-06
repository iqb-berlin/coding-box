import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { UserBackendService } from './user-backend.service';
import { SERVER_URL } from '../injection-tokens';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';

describe('UserBackendService', () => {
  let service: UserBackendService;
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
        UserBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(UserBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getUsersFull', () => {
    it('should fetch full user list', () => {
      const mockUsers = [{ id: 1, email: 'a@b.com' }];
      service.getUsersFull().subscribe(res => {
        expect(res).toEqual(mockUsers as unknown);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/users/full`);
      expect(req.request.method).toBe('GET');
      req.flush(mockUsers);
    });
  });

  describe('addUser', () => {
    it('should add user', () => {
      service.addUser(({}) as CreateUserDto).subscribe(res => {
        expect(res).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}admin/users`);
      expect(req.request.method).toBe('POST');
      req.flush(true);
    });
  });
});
