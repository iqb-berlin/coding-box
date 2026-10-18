import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { appConfig } from './app.config';
import { SERVER_URL } from './injection-tokens';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';

jest.mock('./app.routes', () => ({ routes: [] }));

describe('application providers with shared Codebook translations and OIDC', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  let authService: {
    getToken: jest.Mock;
    getRefreshToken: jest.Mock;
    getSessionGeneration: jest.Mock;
    getValidToken: jest.Mock;
  };

  beforeEach(() => {
    authService = {
      getToken: jest.fn().mockReturnValue('oidc-access-token'),
      getRefreshToken: jest.fn().mockReturnValue('oidc-refresh-token'),
      getSessionGeneration: jest.fn().mockReturnValue(0),
      getValidToken: jest.fn().mockResolvedValue('oidc-access-token')
    };
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: 'api/' },
        { provide: AuthService, useValue: authService },
        { provide: AppService, useValue: { serverUrl: 'api/', needsReAuthentication: false } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => requests.verify());

  it('loads shared Codebook labels through the application loader without sending an access token', async () => {
    const translate = TestBed.inject(TranslateService);
    const loaded = firstValueFrom(translate.use('de'));
    const request = requests.expectOne(req => req.url.startsWith('./assets/i18n/de.json?v='));
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(authService.getValidToken).not.toHaveBeenCalled();
    request.flush({ applicationOnly: 'Anwendung', codebook: { export: 'Herunterladen' } });
    await loaded;
    expect(translate.instant('applicationOnly')).toBe('Anwendung');
    expect(translate.instant('codebook.export')).toBe('Herunterladen');
    expect(translate.instant('codebook.dialogs.cancel')).toBe('Abbrechen');
  });

  it('authenticates backend requests with the current OIDC session', async () => {
    const loaded = firstValueFrom(http.get('api/admin/workspace/42'));
    await Promise.resolve();
    const request = requests.expectOne('api/admin/workspace/42');
    expect(authService.getValidToken).toHaveBeenCalledTimes(1);
    expect(request.request.headers.get('Authorization')).toBe('Bearer oidc-access-token');
    expect(request.request.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{32,36}$/i);
    request.flush({ id: 42 });
    await expect(loaded).resolves.toEqual({ id: 42 });
  });

  it('exchanges a login code without attaching or refreshing an access token', async () => {
    const body = { code: 'one-time-code', browser_verifier: 'browser-verifier' };
    const loaded = firstValueFrom(http.post('api/auth/exchange', body));
    const request = requests.expectOne('api/auth/exchange');
    expect(request.request.body).toEqual(body);
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(authService.getValidToken).not.toHaveBeenCalled();
    request.flush({ access_token: 'new-oidc-token' });
    await expect(loaded).resolves.toEqual({ access_token: 'new-oidc-token' });
  });
});
