import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { AuthenticationService } from './authentication.service';
import { SERVER_URL } from '../../injection-tokens';

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        AuthenticationService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(AuthenticationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('authenticate', () => {
    it('should post login credentials', () => {
      const mockResponse = { success: true, token: 'abc' };
      const creds = {
        username: 'u', password: 'p', server: 's', url: 'l'
      };

      service.authenticate(creds.username, creds.password, creds.server, creds.url)
        .subscribe(res => {
          expect(res).toEqual(mockResponse);
        });

      const req = httpMock.expectOne(`${mockServerUrl}tc_authentication`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(creds);
      req.flush(mockResponse);
    });
  });
});
