import { TestBed } from '@angular/core/testing';
import { LocationStrategy } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { AppComponent } from './app.component';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';

describe('AppComponent', () => {
  let authService: {
    exchangeLoginCode: jest.Mock;
    setToken: jest.Mock;
    setIdToken: jest.Mock;
    setRefreshToken: jest.Mock;
    isLoggedIn: jest.Mock;
    getLoggedUser: jest.Mock;
    getRoles: jest.Mock;
  };
  let appService: {
    appLogo: { bodyBackground: string; data: string; alt: string };
    dataLoading: boolean;
    authData$: Observable<AuthDataDto>;
    processMessagePost: jest.Mock;
    refreshAuthData: jest.Mock;
    setAuthBootstrapStatus: jest.Mock;
    normalizeInternalRoute: jest.Mock;
    isLoggedIn: boolean;
    loggedUser?: unknown;
  };
  let router: {
    events: Subject<NavigationEnd>;
    url: string;
    navigateByUrl: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      exchangeLoginCode: jest.fn().mockReturnValue(of({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: 'id-token',
        refresh_token: 'refresh-token'
      })),
      setToken: jest.fn(),
      setIdToken: jest.fn(),
      setRefreshToken: jest.fn(),
      isLoggedIn: jest.fn().mockReturnValue(true),
      getLoggedUser: jest.fn().mockReturnValue({ sub: 'oidc-user-id', preferred_username: 'tester' }),
      getRoles: jest.fn().mockReturnValue([])
    };
    appService = {
      appLogo: { bodyBackground: '', data: '', alt: '' },
      dataLoading: false,
      authData$: of(AppService.defaultAuthData),
      processMessagePost: jest.fn(),
      refreshAuthData: jest.fn(),
      setAuthBootstrapStatus: jest.fn(),
      normalizeInternalRoute: jest.fn((returnUrl?: string) => (
        returnUrl &&
        returnUrl.startsWith('/') &&
        !returnUrl.startsWith('//') &&
        returnUrl !== '/' &&
        !returnUrl.startsWith('/home') ?
          returnUrl :
          undefined
      )),
      isLoggedIn: false
    };
    router = {
      events: new Subject<NavigationEnd>(),
      url: '/home?auth=session-expired&returnUrl=%2Fworkspace-admin%2F1%2Ftest-results',
      navigateByUrl: jest.fn().mockResolvedValue(true)
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
        { provide: LocationStrategy, useValue: { path: jest.fn().mockReturnValue('/') } }
      ]
    })
      .overrideComponent(AppComponent, {
        set: { template: '' }
      })
      .compileComponents();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('exchanges auth_code callbacks and restores the protected return URL without duplicating the hash', async () => {
    window.history.replaceState(
      null,
      '',
      '/?auth_code=exchange-code#/home?auth=session-expired&returnUrl=%2Fworkspace-admin%2F1%2Ftest-results'
    );

    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.ngOnInit();

    expect(authService.exchangeLoginCode).toHaveBeenCalledWith('exchange-code');
    expect(authService.setToken).toHaveBeenCalledWith('access-token');
    expect(authService.setIdToken).toHaveBeenCalledWith('id-token');
    expect(authService.setRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(appService.refreshAuthData).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace-admin/1/test-results');
    expect(window.location.href).toBe('http://localhost/#/workspace-admin/1/test-results');
    expect(window.location.href).not.toContain('auth_code=');
    expect(window.location.href).not.toContain('#/#');
  });
});
