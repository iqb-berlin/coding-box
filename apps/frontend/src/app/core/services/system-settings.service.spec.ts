import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { SERVER_URL } from '../../injection-tokens';
import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsService', () => {
  let service: SystemSettingsService;
  let httpMock: HttpTestingController;

  const serverUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SystemSettingsService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: serverUrl }
      ]
    });

    service = TestBed.inject(SystemSettingsService);
    httpMock = TestBed.inject(HttpTestingController);
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('token');
  });

  afterEach(() => {
    httpMock.verify();
    jest.restoreAllMocks();
  });

  it('reads the public legal notice', () => {
    service.getLegalNotice().subscribe();

    const req = httpMock.expectOne(`${serverUrl}legal-notice`);
    expect(req.request.method).toBe('GET');
    req.flush({ html: '<p>Text</p>', isDefault: false });
  });

  it('updates the legal notice with the stored auth token', () => {
    service.updateLegalNotice({ html: '<p>Updated</p>' }).subscribe();

    const req = httpMock.expectOne(`${serverUrl}legal-notice`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token');
    expect(req.request.body).toEqual({ html: '<p>Updated</p>' });
    req.flush({ html: '<p>Updated</p>', isDefault: false });
  });

  it('resets the legal notice with the stored auth token', () => {
    service.resetLegalNotice().subscribe();

    const req = httpMock.expectOne(`${serverUrl}legal-notice`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token');
    req.flush({ html: '<p>Default</p>', isDefault: true });
  });
});
