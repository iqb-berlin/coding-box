import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthSessionActivityService } from './auth-session-activity.service';
import { AppService } from './app.service';
import { AuthService } from './auth.service';
import {
  AUTH_SESSION_IDLE_TIMEOUT_MS,
  AUTH_SESSION_WARNING_DELAY_MS
} from './auth-session.config';

describe('AuthSessionActivityService', () => {
  let service: AuthSessionActivityService;
  let authService: { isLoggedIn: jest.Mock; getValidToken: jest.Mock };
  let appService: {
    needsReAuthentication: boolean;
    sessionExpiryWarning: boolean;
    setSessionExpiryWarning: jest.Mock;
    requireReAuthentication: jest.Mock;
  };

  beforeEach(() => {
    authService = {
      isLoggedIn: jest.fn().mockReturnValue(true),
      getValidToken: jest.fn().mockResolvedValue('token')
    };
    appService = {
      needsReAuthentication: false,
      sessionExpiryWarning: false,
      setSessionExpiryWarning: jest.fn((showWarning: boolean) => {
        appService.sessionExpiryWarning = showWarning;
      }),
      requireReAuthentication: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        AuthSessionActivityService,
        { provide: AuthService, useValue: authService },
        { provide: AppService, useValue: appService },
        { provide: Router, useValue: { url: '/coding' } }
      ]
    });

    service = TestBed.inject(AuthSessionActivityService);
  });

  afterEach(() => {
    service?.stop();
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

  it('should keep the session active when the user returns with a valid token after the warning', fakeAsync(() => {
    service.start();
    tick(AUTH_SESSION_WARNING_DELAY_MS);

    window.dispatchEvent(new Event('mousemove'));

    expect(authService.getValidToken).toHaveBeenCalledWith(0);
    expect(appService.sessionExpiryWarning).toBe(false);
    service.stop();
  }));
});
