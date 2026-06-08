import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { UserWorkspacesComponent } from './user-workspaces.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppService } from '../../../core/services/app.service';

const mockKeycloak = {
  idTokenParsed: { sub: 'test-user-id', preferred_username: 'test-user' },
  token: 'mock-token',
  authenticated: true,
  loadUserProfile: jest.fn().mockResolvedValue({ username: 'test-user' }),
  login: jest.fn(),
  logout: jest.fn(),
  accountManagement: jest.fn(),
  realmAccess: { roles: ['user'] }
};

const mockAuthService = {
  isLoggedIn: jest.fn().mockReturnValue(true),
  login: jest.fn()
};

const mockAppService = {
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
    mockAppService.retryAuthDataLoad.mockReturnValue(of(false));

    await TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AppService, useValue: mockAppService },
        { provide: 'Keycloak', useValue: mockKeycloak }
      ],
      imports: [TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(UserWorkspacesComponent);
    component = fixture.componentInstance;
    component.workspaces = [];
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

  it('should login with a pending reauthentication return URL', () => {
    component.login();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show a loading state until auth data is available', () => {
    component.authBootstrapStatus = 'backend-login-running';
    component.authDataLoaded = false;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.loading-user-workspaces');
    expect(fixture.nativeElement.textContent).not.toContain('home.no-user-workspaces');
  });

  it('should show an auth data retry action after auth data loading failed', () => {
    component.authBootstrapStatus = 'auth-data-failed';
    component.authDataLoaded = false;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.auth-data-load-error');
    expect(fixture.nativeElement.textContent).toContain('home.retry-auth-data');
    expect(fixture.nativeElement.textContent).toContain('home.relogin');

    getButtonByText('home.retry-auth-data').click();

    expect(mockAppService.retryAuthDataLoad).toHaveBeenCalled();
  });

  it('should offer reauthentication after auth data loading failed', () => {
    component.authBootstrapStatus = 'auth-data-failed';
    component.authDataLoaded = false;

    fixture.detectChanges();

    getButtonByText('home.relogin').click();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show reauthentication instead of loading when the session expires while Keycloak is still authenticated', () => {
    component.authBootstrapStatus = 'session-expired';
    component.authDataLoaded = false;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_message');
    expect(fixture.nativeElement.textContent).not.toContain('home.loading-user-workspaces');

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show a retry action when auth bootstrap is ready but auth data is still missing', () => {
    component.authBootstrapStatus = 'ready';
    component.authDataLoaded = false;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.auth-data-load-error');
    expect(fixture.nativeElement.textContent).not.toContain('home.loading-user-workspaces');
  });

  it('should only show empty workspaces after auth data has loaded', () => {
    component.authBootstrapStatus = 'ready';
    component.authDataLoaded = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('home.no-user-workspaces');
  });

  it('should show reauthentication inline when logged out after an expired session', () => {
    mockAuthService.isLoggedIn.mockReturnValue(false);
    mockAppService.needsReAuthentication = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_title');
    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_message');
  });
});
