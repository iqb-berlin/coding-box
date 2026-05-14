import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { UserWorkspacesAreaComponent } from './user-workspaces-area.component';
import { AuthService } from '../../../core/services/auth.service';
import { AppService } from '../../../core/services/app.service';

const mockAuthService = {
  getLoggedUser: jest.fn(),
  isLoggedIn: jest.fn().mockReturnValue(true),
  login: jest.fn()

};
describe('UserWorkspacesAreaComponent', () => {
  let component: UserWorkspacesAreaComponent;
  let fixture: ComponentFixture<UserWorkspacesAreaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserWorkspacesAreaComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AppService, useValue: { reAuthenticationReturnUrl: undefined } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserWorkspacesAreaComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('workspaces', []);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
