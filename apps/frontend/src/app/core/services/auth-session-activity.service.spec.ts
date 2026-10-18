import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { AuthSessionActivityService } from './auth-session-activity.service';
import { AppService } from './app.service';
import { AuthService } from './auth.service';
import {
  AUTH_SESSION_IDLE_TIMEOUT_MS,
  AUTH_SESSION_WARNING_DELAY_MS
} from './auth-session.config';
import { WorkspaceSettingsService } from '../../ws-admin/services/workspace-settings.service';

describe('AuthSessionActivityService', () => {
  let service: AuthSessionActivityService;
  let authService: {
    isLoggedIn: jest.Mock; getValidToken: jest.Mock; getSessionGeneration: jest.Mock; getRefreshToken: jest.Mock;
  };
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
    authService = {
      isLoggedIn: jest.fn().mockReturnValue(true),
      getValidToken: jest.fn().mockResolvedValue('token'),
      getSessionGeneration: jest.fn().mockReturnValue(0),
      getRefreshToken: jest.fn().mockReturnValue('refresh-token')
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
        { provide: AuthService, useValue: authService },
        { provide: AppService, useValue: appService },
        { provide: WorkspaceSettingsService, useValue: workspaceSettingsService },
        { provide: Router, useValue: { url: '/coding' } }
      ]
    });

    service = TestBed.inject(AuthSessionActivityService);
  });

  afterEach(() => {
    service?.stop();
  });

  it('does not expire a new session when an older activity refresh is discarded', async () => {
    let finishRefresh!: (token: string | undefined) => void;
    authService.getValidToken.mockReturnValue(new Promise(resolve => { finishRefresh = resolve; }));
    service.start();
    appService.sessionExpiryWarning = true;
    window.dispatchEvent(new Event('keydown'));
    authService.getSessionGeneration.mockReturnValue(1);
    authService.getRefreshToken.mockReturnValue('new-refresh-token');

    finishRefresh(undefined);
    await Promise.resolve();

    expect(appService.requireReAuthentication).not.toHaveBeenCalled();
  });

  it('should show an idle warning before the session expires', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();

      await jest.advanceTimersByTimeAsync(AUTH_SESSION_WARNING_DELAY_MS);

      expect(appService.setSessionExpiryWarning).toHaveBeenLastCalledWith(true);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();
      service.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should require reauthentication after the idle timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();

      await jest.advanceTimersByTimeAsync(AUTH_SESSION_IDLE_TIMEOUT_MS);

      expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
      expect(appService.setSessionExpiryWarning).toHaveBeenLastCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should use the workspace auth-session idle timeout setting', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      workspaceSettingsService.getAuthSessionIdleTimeoutMinutes.mockReturnValue(of(10));
      service.start();

      await jest.advanceTimersByTimeAsync((10 * 60 * 1000) - 1);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);

      expect(workspaceSettingsService.getAuthSessionIdleTimeoutMinutes).toHaveBeenCalledWith(1);
      expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should reload workspace timeout settings when the selected workspace changes', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      workspaceSettingsService.getAuthSessionIdleTimeoutMinutes.mockImplementation(
        (workspaceId: number) => of(workspaceId === 2 ? 5 : 30)
      );
      service.start();

      appService.selectedWorkspaceId = 2;
      selectedWorkspaceIdSubject.next(2);

      await jest.advanceTimersByTimeAsync((5 * 60 * 1000) - 1);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(workspaceSettingsService.getAuthSessionIdleTimeoutMinutes).toHaveBeenCalledWith(2);
      expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should apply auth-session idle timeout changes for the current workspace', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();

      authSessionIdleTimeoutChangedSubject.next({
        workspaceId: 1,
        timeoutMinutes: 5
      });

      await jest.advanceTimersByTimeAsync((5 * 60 * 1000) - 1);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should reset warning timers on user activity', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();

      await jest.advanceTimersByTimeAsync(AUTH_SESSION_WARNING_DELAY_MS - 1000);
      window.dispatchEvent(new Event('click'));
      await jest.advanceTimersByTimeAsync(1000);

      expect(appService.sessionExpiryWarning).toBe(false);

      await jest.advanceTimersByTimeAsync(AUTH_SESSION_WARNING_DELAY_MS - 2000);
      expect(appService.sessionExpiryWarning).toBe(false);

      await jest.advanceTimersByTimeAsync(2000);
      expect(appService.sessionExpiryWarning).toBe(true);
      service.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should reset idle timers on activity from another tab', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();

      await jest.advanceTimersByTimeAsync(AUTH_SESSION_IDLE_TIMEOUT_MS - 1000);
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'coding-box-auth-session-activity',
        newValue: JSON.stringify({ source: 'other-tab', timestamp: Date.now() })
      }));
      await jest.advanceTimersByTimeAsync(1000);

      expect(appService.requireReAuthentication).not.toHaveBeenCalled();
      service.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should validate the OIDC session on activity from another tab after the warning', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();
      await jest.advanceTimersByTimeAsync(AUTH_SESSION_WARNING_DELAY_MS);

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'coding-box-auth-session-activity',
        newValue: JSON.stringify({ source: 'other-tab', timestamp: Date.now() })
      }));
      await jest.advanceTimersByTimeAsync(0);

      expect(authService.getValidToken).toHaveBeenCalledWith(0);
      expect(appService.sessionExpiryWarning).toBe(false);
      expect(appService.requireReAuthentication).not.toHaveBeenCalled();
      service.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should expire an invalid OIDC session after activity from another tab', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      authService.getValidToken.mockResolvedValue(undefined);
      service.start();
      await jest.advanceTimersByTimeAsync(AUTH_SESSION_WARNING_DELAY_MS);

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'coding-box-auth-session-activity',
        newValue: JSON.stringify({ source: 'other-tab', timestamp: Date.now() })
      }));
      await jest.advanceTimersByTimeAsync(0);

      expect(appService.requireReAuthentication).toHaveBeenCalledWith('/coding');
      service.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should keep the session active when the user returns with a valid token after the warning', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      service.start();
      await jest.advanceTimersByTimeAsync(AUTH_SESSION_WARNING_DELAY_MS);

      window.dispatchEvent(new Event('mousemove'));

      expect(authService.getValidToken).toHaveBeenCalledWith(0);
      expect(appService.sessionExpiryWarning).toBe(false);
      service.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
