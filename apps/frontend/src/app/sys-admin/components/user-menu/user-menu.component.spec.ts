import { provideZonelessChangeDetection } from '@angular/core';
import { KeycloakProfile } from 'keycloak-js';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject, of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { UserMenuComponent } from './user-menu.component';
import { AuthService } from '../../../core/services/auth.service';
import { LogoService } from '../../../core/services/logo.service';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

const mockAuthService = {
  loadUserProfile: jest.fn(),
  logout: jest.fn().mockResolvedValue(undefined),
  redirectToProfile: jest.fn().mockResolvedValue(undefined)
};

const mockLogoService = {
  getLogoSettings: jest.fn().mockReturnValue(of(null))
};

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  let profile: Promise<KeycloakProfile>;
  let resolveProfile: (value: KeycloakProfile) => void;
  const authData = new BehaviorSubject({ isAdmin: false });

  beforeEach(async () => {
    authData.next({ isAdmin: false });
    profile = new Promise(resolve => { resolveProfile = resolve; });
    mockAuthService.loadUserProfile.mockReturnValue(profile);
    await TestBed.configureTestingModule({
      imports: [
        UserMenuComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        HttpClientTestingModule
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppService, useValue: { authData$: authData } },
        { provide: AuthService, useValue: mockAuthService },
        { provide: LogoService, useValue: mockLogoService },
        { provide: SERVER_URL, useValue: environment.backendUrl }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('renders a delayed profile and role updates without Zone change detection', async () => {
    resolveProfile({ firstName: 'Test', lastName: 'Coder' });
    await profile;
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(document.querySelector('.user-name')?.textContent).toContain('Test Coder');
    expect(document.querySelector('.user-status')?.textContent).toContain('Nutzer');

    authData.next({ isAdmin: true });
    await fixture.whenStable();
    expect(document.querySelector('.user-status')?.textContent).toContain('Administrator');
    fixture.destroy();
    expect(authData.observed).toBe(false);
  });

  it('ignores a profile response received after destruction', async () => {
    fixture.destroy();
    resolveProfile({ username: 'late-profile' });
    await profile;
    expect(component.userName()).toBe('');
    expect(authData.observed).toBe(false);
  });
});
