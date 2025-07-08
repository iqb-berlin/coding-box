import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { UserWorkspacesComponent } from './user-workspaces.component';
import { AuthService } from '../../../auth/services/auth.service';

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
  isLoggedIn: jest.fn().mockReturnValue(true)
};

describe('UserWorkspacesComponent', () => {
  let component: UserWorkspacesComponent;
  let fixture: ComponentFixture<UserWorkspacesComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
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
});
