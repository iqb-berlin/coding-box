import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
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
  needsReAuthentication: false
};

describe('UserWorkspacesComponent', () => {
  let component: UserWorkspacesComponent;
  let fixture: ComponentFixture<UserWorkspacesComponent>;
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.isLoggedIn.mockReturnValue(true);
    mockAppService.needsReAuthentication = false;

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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should login with a pending reauthentication return URL', () => {
    component.login();

    expect(mockAuthService.login).toHaveBeenCalledWith('/coding');
  });

  it('should show reauthentication inline when logged out after an expired session', () => {
    mockAuthService.isLoggedIn.mockReturnValue(false);
    mockAppService.needsReAuthentication = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_title');
    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_message');
  });
});
