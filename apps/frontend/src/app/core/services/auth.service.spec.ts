import { TestBed } from '@angular/core/testing';
import Keycloak from 'keycloak-js';
import { AuthService } from './auth.service';
import { AppService } from './app.service';

describe('AuthService', () => {
  let service: AuthService;
  let keycloak: {
    authenticated?: boolean;
    idTokenParsed?: unknown;
    token?: string;
    realmAccess?: { roles: string[] };
    login: jest.Mock;
    logout: jest.Mock;
    loadUserProfile: jest.Mock;
    accountManagement: jest.Mock;
  };
  let appService: jest.Mocked<AppService>;

  beforeEach(() => {
    keycloak = {
      authenticated: false,
      idTokenParsed: { sub: 'user-1' },
      token: 'keycloak-token',
      realmAccess: { roles: ['user'] },
      login: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockResolvedValue(undefined),
      loadUserProfile: jest.fn().mockResolvedValue({ username: 'test' }),
      accountManagement: jest.fn().mockResolvedValue(undefined)
    };

    appService = {
      reAuthenticationReturnUrl: '/coding',
      createLoginRedirectUri: jest.fn().mockReturnValue('http://localhost/#/coding'),
      markExplicitLogoutInProgress: jest.fn(),
      clearAuthState: jest.fn()
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Keycloak, useValue: keycloak },
        { provide: AppService, useValue: appService }
      ]
    });

    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should pass a sanitized return URL as Keycloak redirect URI', async () => {
    await service.login('/workspace-admin/1');

    expect(appService.createLoginRedirectUri).toHaveBeenCalledWith('/workspace-admin/1');
    expect(keycloak.login).toHaveBeenCalledWith({ redirectUri: 'http://localhost/#/coding' });
  });

  it('should fall back to the stored reauthentication return URL during login', async () => {
    await service.login();

    expect(appService.createLoginRedirectUri).toHaveBeenCalledWith('/coding');
  });

  it('should login without options when there is no return URL', async () => {
    appService.reAuthenticationReturnUrl = undefined;
    appService.createLoginRedirectUri.mockReturnValue(undefined);

    await service.login();

    expect(keycloak.login).toHaveBeenCalledWith(undefined);
  });

  it('should mark explicit logout and clear local auth state before Keycloak logout', async () => {
    await service.logout();

    expect(appService.markExplicitLogoutInProgress).toHaveBeenCalled();
    expect(appService.clearAuthState).toHaveBeenCalledWith({ clearReAuthentication: true });
    expect(keycloak.logout).toHaveBeenCalledWith({ redirectUri: window.location.origin });
  });
});
