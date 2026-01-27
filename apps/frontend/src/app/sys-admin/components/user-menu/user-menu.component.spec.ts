import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { UserMenuComponent } from './user-menu.component';
import { AuthService } from '../../../core/services/auth.service';
import { LogoService } from '../../../core/services/logo.service';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

const mockAuthService = {
  logout: jest.fn().mockResolvedValue(undefined),
  redirectToProfile: jest.fn().mockResolvedValue(undefined)
};

const mockLogoService = {
  getLogoSettings: jest.fn().mockReturnValue(of(null))
};

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserMenuComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        HttpClientTestingModule
      ],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: LogoService, useValue: mockLogoService },
        { provide: SERVER_URL, useValue: environment.backendUrl }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
