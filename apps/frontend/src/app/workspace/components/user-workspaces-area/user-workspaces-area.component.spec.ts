import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { UserWorkspacesAreaComponent } from './user-workspaces-area.component';
import { AuthService } from '../../../auth/service/auth.service';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../auth/services/auth.service';

const mockAuthService = {
  getLoggedUser: jest.fn(),
  isLoggedIn: jest.fn().mockReturnValue(true)

};
describe('UserWorkspacesAreaComponent', () => {
  let component: UserWorkspacesAreaComponent;
  let fixture: ComponentFixture<UserWorkspacesAreaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserWorkspacesAreaComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: mockAuthService }
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
