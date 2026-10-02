import {
  Component, computed, inject, provideZonelessChangeDetection
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AppService, AuthBootstrapStatus } from './app.service';
import { LogoService } from './logo.service';
import { SERVER_URL } from '../../injection-tokens';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';

@Component({
  template: '<p>{{ app.authBootstrapStatus }} / {{ app.authData.userName }} / {{ app.userId }}</p>'
})
class AuthStateHostComponent {
  readonly app = inject(AppService);
}

describe('AppService auth state without Zone.js', () => {
  let service: AppService;
  let http: HttpTestingController;
  const authData: AuthDataDto = { ...AppService.defaultAuthData, userId: 7, userName: 'Delayed user' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AuthStateHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(), provideHttpClientTesting(),
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        { provide: SERVER_URL, useValue: '/api/' }
      ]
    });
    service = TestBed.inject(AppService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps signal reads current inside synchronous observable notifications', () => {
    const userId = computed(() => service.userId);
    const status = computed(() => service.authBootstrapStatus);
    const users: number[] = [];
    const statuses: AuthBootstrapStatus[] = [];
    const userSubscription = service.authData$.subscribe(data => {
      expect(service.authData).toBe(data);
      expect(userId()).toBe(data.userId);
      users.push(data.userId);
    });
    const statusSubscription = service.authBootstrapStatus$.subscribe(value => {
      expect(status()).toBe(value);
      statuses.push(value);
    });
    service.setAuthBootstrapStatus('backend-login-running');
    service.updateAuthData(authData);
    service.setAuthBootstrapStatus('ready');
    service.clearAuthState();
    expect(users).toEqual([0, 7, 0]);
    expect(statuses).toEqual(['checking', 'backend-login-running', 'ready', 'ready']);
    userSubscription.unsubscribe();
    statusSubscription.unsubscribe();
  });

  it('replays the current auth state to late subscribers', () => {
    service.updateAuthData(authData);
    service.setAuthBootstrapStatus('auth-data-failed');
    const receiveAuth = jest.fn();
    const receiveStatus = jest.fn();
    const authSubscription = service.authData$.subscribe(receiveAuth);
    const statusSubscription = service.authBootstrapStatus$.subscribe(receiveStatus);
    expect(receiveAuth).toHaveBeenCalledWith(authData);
    expect(receiveStatus).toHaveBeenCalledWith('auth-data-failed');
    authSubscription.unsubscribe();
    statusSubscription.unsubscribe();
  });

  it('renders delayed auth data and logout automatically', async () => {
    const fixture = TestBed.createComponent(AuthStateHostComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    service.loadAuthenticatedUser('identity').subscribe();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('backend-login-running');
    http.expectOne('/api/auth-data?identity=identity').flush(authData);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('ready / Delayed user / 7');
    service.clearAuthState();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Delayed user');
    expect(fixture.nativeElement.textContent).toContain('/ 0');
  });

  it('finishes global auth loading after the retrying view unsubscribes', async () => {
    const fixture = TestBed.createComponent(AuthStateHostComponent);
    fixture.autoDetectChanges();
    service.loadAuthenticatedUser('identity').subscribe();
    http.expectOne('/api/auth-data?identity=identity').flush({}, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('auth-data-failed');
    const receive = jest.fn();
    const subscription = service.retryAuthDataLoad().subscribe(receive);
    const request = http.expectOne('/api/auth-data?identity=identity');
    subscription.unsubscribe();
    expect(request.cancelled).toBe(false);
    request.flush(authData);
    await fixture.whenStable();
    expect(receive).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('ready / Delayed user / 7');
  });

  it('does not restore auth data when a pending retry finishes after logout', async () => {
    const fixture = TestBed.createComponent(AuthStateHostComponent);
    fixture.autoDetectChanges();
    service.loadAuthenticatedUser('identity').subscribe();
    http.expectOne('/api/auth-data?identity=identity').flush({}, { status: 400, statusText: 'Bad Request' });
    const subscription = service.retryAuthDataLoad().subscribe();
    const request = http.expectOne('/api/auth-data?identity=identity');
    service.clearAuthState();
    request.flush(authData);
    await fixture.whenStable();
    expect(service.authData).toEqual(AppService.defaultAuthData);
    expect(fixture.nativeElement.textContent).not.toContain('Delayed user');
    subscription.unsubscribe();
  });
});
