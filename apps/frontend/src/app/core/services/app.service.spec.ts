import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { KeycloakTokenParsed } from 'keycloak-js';
import { AppService } from './app.service';
import { LogoService } from '../../services/logo.service';
import { SERVER_URL } from '../../injection-tokens';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';

describe('AppService', () => {
  let service: AppService;
  let httpMock: HttpTestingController;
  let logoServiceMock: jest.Mocked<LogoService>;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    logoServiceMock = {
      getLogoSettings: jest.fn().mockReturnValue(of(null))
    } as unknown as jest.Mocked<LogoService>;

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token'),
        setItem: jest.fn()
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        AppService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: LogoService, useValue: logoServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(AppService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('refreshAuthData', () => {
    it('should refresh data if user is logged in', () => {
      service.loggedUser = { sub: 'user1' } as KeycloakTokenParsed;
      const mockAuthData = { userId: 1 } as unknown as AuthDataDto;

      service.refreshAuthData();

      const req = httpMock.expectOne(`${mockServerUrl}auth-data?identity=user1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockAuthData);
    });
  });
});
