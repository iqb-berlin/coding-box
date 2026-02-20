import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { UserWorkspacesComponent } from './user-workspaces.component';
import { AuthService } from '../../../core/services/auth.service';

const mockAuthService = {
  isLoggedIn: jest.fn().mockReturnValue(true),
  getLoggedUser: jest.fn().mockReturnValue({
    sub: 'test-user-id',
    preferred_username: 'test-user',
    realm_access: { roles: ['user'] }
  }),
  getToken: jest.fn().mockReturnValue('mock-token'),
  loadUserProfile: jest.fn().mockResolvedValue({
    id: 'test-user-id',
    username: 'test-user'
  }),
  login: jest.fn(),
  logout: jest.fn(),
  getRoles: jest.fn().mockReturnValue(['user'])
};

describe('UserWorkspacesComponent', () => {
  let component: UserWorkspacesComponent;
  let fixture: ComponentFixture<UserWorkspacesComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService }
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
