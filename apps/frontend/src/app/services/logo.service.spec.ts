import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { LogoService } from './logo.service';
import { SERVER_URL } from '../injection-tokens';
import { AppLogoDto } from '../../../../../api-dto/app-logo-dto';

describe('LogoService', () => {
  let service: LogoService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api';

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        LogoService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(LogoService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('uploadLogo', () => {
    it('should post file', () => {
      const file = new File([''], 'logo.png');
      service.uploadLogo(file).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/admin/logo/upload`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush({});
    });
  });

  describe('saveLogoSettings', () => {
    it('should put settings', () => {
      const settings: AppLogoDto = { data: '', alt: '', bodyBackground: '10' };
      service.saveLogoSettings(settings).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}/admin/logo/settings`);
      expect(req.request.method).toBe('PUT');
      req.flush({});
    });
  });
});
