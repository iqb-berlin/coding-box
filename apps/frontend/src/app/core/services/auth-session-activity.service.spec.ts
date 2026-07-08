import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import Keycloak from 'keycloak-js';
import { Observable, Subject, of } from 'rxjs';
import { AuthSessionActivityService } from './auth-session-activity.service';
import { AppService } from './app.service';
import {
  AUTH_SESSION_IDLE_TIMEOUT_MS,
  AUTH_SESSION_WARNING_DELAY_MS
} from './auth-session.config';
import { WorkspaceSettingsService } from '../../ws-admin/services/workspace-settings.service';

describe('AuthSessionActivityService', () => {
  let service: AuthSessionActivityService;
  let keycloak: { authenticated: boolean; updateToken: jest.Mock };
  let appService: {
    selectedWorkspaceId: number;
    selectedWorkspaceId$: Observable<number>;
    needsReAuthentication: boolean;
    sessionExpiryWarning: boolean;
    setSessionExpiryWarning: jest.Mock;
    requireReAuthentication: jest.Mock;
  };
  let workspaceSettingsService: {
    getAuthSessionIdleTimeoutMinutes: jest.Mock;
    authSessionIdleTimeoutChanged$: Observable<{
      workspaceId: number;
      timeoutMinutes: number;
    }>;
  };
  let authSessionIdleTimeoutChangedSubject: Subject<{
    workspaceId: number;
    timeoutMinutes: number;
  }>;
  let selectedWorkspaceIdSubject: Subject<number>;

  beforeEach(() => {
    keycloak = {
      authenticated: true,
      updateToken: jest.fn().mockResolvedValue(true)
    };
    selectedWorkspaceIdSubject = new Subject();
    appService = {
      selectedWorkspaceId: 1,
      selectedWorkspaceId$: selectedWorkspaceIdSubject.asObservable(),
      needsReAuthentication: false,
      sessionExpiryWarning: false,
      setSessionExpiryWarning: jest.fn((showWarning: boolean) => {
        appService.sessionExpiryWarning = showWarning;
      }),
      requireReAuthentication: jest.fn()
    };
    authSessionIdleTimeoutChangedSubject = new Subject();
    workspaceSettingsService = {
      getAuthSessionIdleTimeoutMinutes: jest.fn().mockReturnValue(of(30)),
      authSessionIdleTimeoutChanged$: authSessionIdleTimeoutChangedSubject.asObservable()
    };

    TestBed.configureTestingModule({
      providers: [
        AuthSessionActivityService,
        { provide: Keycloak, useValue: keycloak },
        { provide: AppService, useValue: appService },
        { provide: WorkspaceSettingsService, useValue: workspaceSettingsService },
        { provide: Router, useValue: { url: '/coding' } }
      ]
    });

    service = TestBed.inject(AuthSessionActivityService);
  });

  afterEach(() => {
    service.stop();
  });

  it('should show an idle warning before the session expires', fakeAsync(() => {
    service.start();

    tick(AUTH_SESSION_WARNING_DELAY_MS);

    expect(appService.setSessionExpiryWarning).toHaveBeenLastCalledWith(true);
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    service.stop();
  }));

  it('should require reauthentication after the idle timeout', fakeAsync(() => {
    service.start();

    tick(AUTH_SESSION_IDLE_TIMEOUT_MS);

    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
    expect(appService.setSessionExpiryWarning).toHaveBeenLastCalledWith(false);
  }));

  it('should use the workspace auth-session idle timeout setting', fakeAsync(() => {
    workspaceSettingsService.getAuthSessionIdleTimeoutMinutes.mockReturnValue(of(10));
    service.start();

    tick((10 * 60 * 1000) - 1);
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();

    tick(1);

    expect(workspaceSettingsService.getAuthSessionIdleTimeoutMinutes).toHaveBeenCalledWith(1);
    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
  }));

  it('should reload workspace timeout settings when the selected workspace changes', fakeAsync(() => {
    workspaceSettingsService.getAuthSessionIdleTimeoutMinutes.mockImplementation(
      (workspaceId: number) => of(workspaceId === 2 ? 5 : 30)
    );
    service.start();

    appService.selectedWorkspaceId = 2;
    selectedWorkspaceIdSubject.next(2);

    tick((5 * 60 * 1000) - 1);
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();

    tick(1);
    expect(workspaceSettingsService.getAuthSessionIdleTimeoutMinutes).toHaveBeenCalledWith(2);
    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
  }));

  it('should apply auth-session idle timeout changes for the current workspace', fakeAsync(() => {
    service.start();

    authSessionIdleTimeoutChangedSubject.next({
      workspaceId: 1,
      timeoutMinutes: 5
    });

    tick((5 * 60 * 1000) - 1);
    expect(appService.requireReAuthentication).not.toHaveBeenCalled();

    tick(1);
    expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
  }));

  it('should reset warning timers on user activity', fakeAsync(() => {
    service.start();

    tick(AUTH_SESSION_WARNING_DELAY_MS - 1000);
    window.dispatchEvent(new Event('click'));
    tick(1000);

    expect(appService.sessionExpiryWarning).toBe(false);

    tick(AUTH_SESSION_WARNING_DELAY_MS - 2000);
    expect(appService.sessionExpiryWarning).toBe(false);

    tick(2000);
    expect(appService.sessionExpiryWarning).toBe(true);
    service.stop();
  }));

  it('should reset idle timers on activity from another tab', fakeAsync(() => {
    service.start();

    tick(AUTH_SESSION_IDLE_TIMEOUT_MS - 1000);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'coding-box-auth-session-activity',
      newValue: JSON.stringify({ source: 'other-tab', timestamp: Date.now() })
    }));
    tick(1000);

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
    service.stop();
  }));

  it('should force a token refresh when the user returns after the warning', fakeAsync(() => {
    service.start();
    tick(AUTH_SESSION_WARNING_DELAY_MS);

    window.dispatchEvent(new Event('mousemove'));

    expect(keycloak.updateToken).toHaveBeenCalledWith(-1);
    expect(appService.sessionExpiryWarning).toBe(false);
    service.stop();
  }));
});
