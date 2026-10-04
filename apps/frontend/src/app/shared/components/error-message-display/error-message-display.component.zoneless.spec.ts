/* eslint-disable max-classes-per-file -- Separate route and shell hosts keep the warning component alive during navigation. */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';
import { LogoService } from '../../../core/services/logo.service';
import { SERVER_URL } from '../../../injection-tokens';
import { ErrorMessageDisplayComponent } from './error-message-display.component';

@Component({ selector: 'test-warning-route', template: 'Route' })
class WarningRouteComponent {}

@Component({
  selector: 'test-warning-shell',
  imports: [RouterOutlet, ErrorMessageDisplayComponent],
  template: '<router-outlet /><app-error-message-display />'
})
class WarningShellComponent {}

describe('Global authentication messages on navigation without Zone.js', () => {
  let fixture: ComponentFixture<WarningShellComponent>;
  let appService: AppService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WarningShellComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'home', component: WarningRouteComponent },
          { path: 'coding', component: WarningRouteComponent },
          { path: 'start', redirectTo: 'home', pathMatch: 'full' },
          { path: 'blocked', component: WarningRouteComponent, canActivate: [() => false] }
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        { provide: AuthService, useValue: { getValidToken: jest.fn().mockResolvedValue('token') } }
      ]
    }).compileComponents();
    router = TestBed.inject(Router);
    appService = TestBed.inject(AppService);
  });

  afterEach(() => fixture?.destroy());

  it.each([
    { needsAuthentication: false, selector: '.session-expiry-warning' },
    { needsAuthentication: true, selector: '.re-authentication' }
  ])('updates $selector in both directions without changing the authentication state', async ({ needsAuthentication, selector }) => {
    await router.navigateByUrl('/home');
    appService.setSessionExpiryWarning(true);
    appService.setNeedsReAuthentication(needsAuthentication);
    fixture = TestBed.createComponent(WarningShellComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(selector)).toBeNull();

    await router.navigateByUrl('/coding');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(selector)).not.toBeNull();
    expect(appService.sessionExpiryWarning).toBe(true);
    expect(appService.needsReAuthentication).toBe(needsAuthentication);

    await router.navigateByUrl('/home?auth=session-expired');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(selector)).toBeNull();
    expect(appService.sessionExpiryWarning).toBe(true);
    expect(appService.needsReAuthentication).toBe(needsAuthentication);
  });

  it('uses the final redirected URL and ignores a cancelled navigation', async () => {
    await router.navigateByUrl('/coding');
    appService.setSessionExpiryWarning(true);
    fixture = TestBed.createComponent(WarningShellComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).not.toBeNull();

    expect(await router.navigateByUrl('/blocked')).toBe(false);
    await fixture.whenStable();
    expect(router.url).toBe('/coding');
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).not.toBeNull();

    await router.navigateByUrl('/start');
    await fixture.whenStable();
    expect(router.url).toBe('/home');
    expect(fixture.nativeElement.querySelector('.session-expiry-warning')).toBeNull();
    expect(appService.sessionExpiryWarning).toBe(true);
  });
});
