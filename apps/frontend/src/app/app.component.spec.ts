import { LocationStrategy } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { KEYCLOAK_EVENT_SIGNAL, KeycloakEvent, KeycloakEventType } from 'keycloak-angular';
import { of, Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { AppService } from './core/services/app.service';
import { AuthService } from './core/services/auth.service';
import { AuthSessionActivityService } from './core/services/auth-session-activity.service';
import { LogoService } from './core/services/logo.service';
import { SystemNotificationService } from './core/services/system-notification.service';
import { SERVER_URL } from './injection-tokens';

describe('AppComponent session event coordination', () => {
  let fixture: ComponentFixture<AppComponent>;
  let appService: AppService;
  let authenticated: boolean;
  const keycloakEvent = signal<KeycloakEvent>({ type: KeycloakEventType.Ready, args: true });
  const activity = { start: jest.fn(), restart: jest.fn(), stop: jest.fn() };

  beforeEach(async () => {
    authenticated = true;
    keycloakEvent.set({ type: KeycloakEventType.Ready, args: true });
    Object.values(activity).forEach(mock => mock.mockClear());
    // Exercise the constructor effects with the real AppService, without bootstrapping a login request.
    jest.spyOn(AppComponent.prototype, 'ngOnInit').mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        { provide: Router, useValue: { url: '/coding', events: new Subject() } },
        { provide: LocationStrategy, useValue: {} },
        { provide: AuthService, useValue: { isLoggedIn: () => authenticated } },
        { provide: MatSnackBar, useValue: {} },
        { provide: AuthSessionActivityService, useValue: activity },
        { provide: SystemNotificationService, useValue: { stopPolling: jest.fn() } },
        { provide: KEYCLOAK_EVENT_SIGNAL, useValue: keycloakEvent }
      ]
    }).overrideComponent(AppComponent, {
      set: { template: '', imports: [], providers: [] }
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    appService = TestBed.inject(AppService);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
    sessionStorage.clear();
  });

  it('does not replay AuthSuccess when reauthentication is required later', async () => {
    keycloakEvent.set({ type: KeycloakEventType.AuthSuccess });
    await fixture.whenStable();

    appService.requireReAuthentication('/coding');
    await fixture.whenStable();

    expect(appService.needsReAuthentication).toBe(true);
    expect(appService.reAuthenticationReturnUrl).toBe('/coding');
    expect(activity.restart).toHaveBeenCalled();
  });

  it('updates session activity when authentication is expired and restored without another Keycloak event', async () => {
    activity.start.mockClear();
    activity.restart.mockClear();
    appService.requireReAuthentication('/coding');
    await fixture.whenStable();
    expect(activity.restart).toHaveBeenCalledTimes(1);
    expect(activity.start).not.toHaveBeenCalled();

    appService.completeBackendLogin();
    await fixture.whenStable();
    expect(appService.needsReAuthentication).toBe(false);
    expect(activity.start).toHaveBeenCalledTimes(1);
  });

  it('does not replay a refresh failure after backend authentication is restored', async () => {
    const requireAuthentication = jest.spyOn(appService, 'requireReAuthentication');
    keycloakEvent.set({ type: KeycloakEventType.AuthRefreshError });
    await fixture.whenStable();
    expect(appService.needsReAuthentication).toBe(true);
    expect(requireAuthentication).toHaveBeenCalledTimes(1);

    appService.completeBackendLogin();
    await fixture.whenStable();
    expect(appService.needsReAuthentication).toBe(false);
    expect(requireAuthentication).toHaveBeenCalledTimes(1);
  });

  it('keeps reauthentication required after a successful token refresh until a new login', async () => {
    appService.requireReAuthentication('/coding');
    await fixture.whenStable();
    keycloakEvent.set({ type: KeycloakEventType.AuthRefreshSuccess });
    await fixture.whenStable();
    expect(appService.needsReAuthentication).toBe(true);
    expect(appService.reAuthenticationReturnUrl).toBe('/coding');

    keycloakEvent.set({ type: KeycloakEventType.AuthSuccess });
    await fixture.whenStable();
    expect(appService.needsReAuthentication).toBe(false);
    expect(appService.reAuthenticationReturnUrl).toBeUndefined();
  });

  it('processes explicit logout once and starts activity again on the next login', async () => {
    const consumeLogout = jest.spyOn(appService, 'consumeExplicitLogoutInProgress');
    const requireAuthentication = jest.spyOn(appService, 'requireReAuthentication');
    appService.markExplicitLogoutInProgress();
    authenticated = false;
    keycloakEvent.set({ type: KeycloakEventType.AuthLogout });
    await fixture.whenStable();
    expect(consumeLogout).toHaveBeenCalledTimes(1);
    expect(requireAuthentication).not.toHaveBeenCalled();
    expect(appService.needsReAuthentication).toBe(false);

    activity.start.mockClear();
    authenticated = true;
    keycloakEvent.set({ type: KeycloakEventType.AuthSuccess });
    await fixture.whenStable();
    expect(activity.start).toHaveBeenCalledTimes(1);
    expect(consumeLogout).toHaveBeenCalledTimes(1);
  });
});
