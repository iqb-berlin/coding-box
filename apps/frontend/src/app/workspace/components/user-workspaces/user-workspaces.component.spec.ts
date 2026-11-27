import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { UserWorkspacesComponent } from './user-workspaces.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppService } from '../../../core/services/app.service';

const mockAuthService = {
  isLoggedIn: jest.fn().mockReturnValue(true),
  login: jest.fn()
};

const mockAppService = {
  authDataFailureStatus: null as number | null,
  authDataFailureCode: null as string | null,
  reAuthenticationReturnUrl: '/coding',
  needsReAuthentication: false,
  retryAuthDataLoad: jest.fn().mockReturnValue(of(false))
};

describe('UserWorkspacesComponent', () => {
  let component: UserWorkspacesComponent;
  let fixture: ComponentFixture<UserWorkspacesComponent>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.isLoggedIn.mockReturnValue(true);
    mockAppService.needsReAuthentication = false;
    mockAppService.authDataFailureStatus = null;
    mockAppService.authDataFailureCode = null;
    mockAppService.retryAuthDataLoad.mockReturnValue(of(false));

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
        { provide: AppService, useValue: mockAppService }
      ],
      imports: [TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(UserWorkspacesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('workspaces', []);
    fixture.detectChanges();
  });

  function getButtonByText(text: string): HTMLButtonElement {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const button = buttons.find(candidate => candidate.textContent?.includes(text));
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a backend rejection separately from a session expiry', () => {
    mockAppService.authDataFailureStatus = 401;
    fixture.componentRef.setInput('authBootstrapStatus', 'auth-data-failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('error.backend_auth_rejected_message');
    expect(fixture.nativeElement.textContent).not.toContain('ui-text.user-workspaces.session-ended');
  });

  it('should login with a pending reauthentication return URL', () => {
    component.login();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it.each([
    ['configuration-error', 'error.auth_configuration_error_message'],
    ['provider-unavailable', 'error.auth_provider_unavailable_message']
  ])('shows appropriate bootstrap recovery for %s', (code, message) => {
    mockAppService.authDataFailureCode = code;
    fixture.componentRef.setInput('authBootstrapStatus', 'auth-data-failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(message);
    expect(fixture.nativeElement.textContent).not.toContain('ui-text.user-workspaces.session-ended');
    expect(getButtonByText('home.retry-auth-data')).toBeDefined();
  });

  it('should show a loading state until auth data is available', () => {
    fixture.componentRef.setInput('authBootstrapStatus', 'backend-login-running');
    fixture.componentRef.setInput('authDataLoaded', false);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.loading-user-workspaces');
    expect(fixture.nativeElement.textContent).not.toContain('home.no-user-workspaces');
  });

  it('should show an auth data retry action after auth data loading failed', () => {
    fixture.componentRef.setInput('authBootstrapStatus', 'auth-data-failed');
    fixture.componentRef.setInput('authDataLoaded', false);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.auth-data-load-error');
    expect(fixture.nativeElement.textContent).toContain('home.retry-auth-data');
    expect(fixture.nativeElement.textContent).toContain('home.relogin');

    getButtonByText('home.retry-auth-data').click();

    expect(mockAppService.retryAuthDataLoad).toHaveBeenCalled();
  });

  it('should offer reauthentication after auth data loading failed', () => {
    fixture.componentRef.setInput('authBootstrapStatus', 'auth-data-failed');
    fixture.componentRef.setInput('authDataLoaded', false);

    fixture.detectChanges();

    getButtonByText('home.relogin').click();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show reauthentication instead of loading when the session expires while Keycloak is still authenticated', () => {
    fixture.componentRef.setInput('authBootstrapStatus', 'session-expired');
    fixture.componentRef.setInput('authDataLoaded', false);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('ui-text.user-workspaces.session-ended');
    expect(fixture.nativeElement.textContent).not.toContain('home.loading-user-workspaces');

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show a retry action when auth bootstrap is ready but auth data is still missing', () => {
    fixture.componentRef.setInput('authBootstrapStatus', 'ready');
    fixture.componentRef.setInput('authDataLoaded', false);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.auth-data-load-error');
    expect(fixture.nativeElement.textContent).not.toContain('home.loading-user-workspaces');
  });

  it('should only show empty workspaces after auth data has loaded', () => {
    fixture.componentRef.setInput('authBootstrapStatus', 'ready');
    fixture.componentRef.setInput('authDataLoaded', true);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.no-user-workspaces');
  });

  it('should show reauthentication inline when logged out after an expired session', () => {
    mockAuthService.isLoggedIn.mockReturnValue(false);
    mockAppService.needsReAuthentication = true;
    fixture.componentRef.setInput('authBootstrapStatus', 'session-expired');

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('ui-text.user-workspaces.sign-in-again');
    expect(fixture.nativeElement.textContent).toContain('ui-text.user-workspaces.session-ended');
    expect(fixture.nativeElement.textContent).not.toContain('ui-text.user-workspaces.login-required');
  });

  it('filters workspace names case-insensitively and restores the original order when cleared', () => {
    // This test exercises filtering with the search open. Browser tests cover viewport geometry.
    Reflect.get(component, 'needsSearch').set(true);
    fixture.componentRef.setInput('authDataLoaded', true);
    fixture.componentRef.setInput('workspaces', [
      { id: 7, name: 'VERA Deutsch' },
      { id: 2, name: 'Mathematik Pilotierung' },
      { id: 3 }
    ]);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    const workspaceLinks = () => Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace'),
      link => link.getAttribute('href')
    );
    const search = (query: string) => {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    };

    search('  deutsch  ');
    expect(workspaceLinks()).toEqual(['/workspace-admin/7']);

    const translations = TestBed.inject(TranslateService);
    translations.setTranslation('de', { 'ui-text': { 'user-workspaces': { unnamed: 'Arbeitsbereich {{id}}' } } });
    translations.use('de');
    search('Arbeitsbereich 3');
    expect(workspaceLinks()).toEqual(['/workspace-admin/3']);

    search('Englisch');
    expect(workspaceLinks()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('ui-text.user-workspaces.no-matches');

    search('');
    expect(workspaceLinks()).toEqual(['/workspace-admin/7', '/workspace-admin/2', '/workspace-admin/3']);
  });
});
