import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GermanTranslationsTestingModule } from '../../../../testing/german-translations';
import { AuthSessionState, DEFAULT_AUTH_DATA } from '../../../core/services/auth-session-state.service';
import { UserMenuComponent } from './user-menu.component';
import { AuthService } from '../../../core/services/auth.service';

describe('UserMenuComponent', () => {
  let fixture: ComponentFixture<UserMenuComponent>;
  let session: AuthSessionState;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserMenuComponent, GermanTranslationsTestingModule],
      providers: [{ provide: AuthService, useValue: {} }]
    }).compileComponents();
    session = TestBed.inject(AuthSessionState);
    fixture = TestBed.createComponent(UserMenuComponent);
  });

  it('shows the login alongside the full name and updates permissions after bootstrap', async () => {
    session.establish({ given_name: 'Test', family_name: 'Coder', preferred_username: 'coder01' });
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    const menu = document.querySelector('.user-info');
    expect(menu?.textContent).toContain('Test Coder');
    expect(menu?.textContent).toContain('Angemeldet als coder01');
    expect(menu?.textContent).not.toContain('Berechtigungen');
    session.updateAuthData({ ...DEFAULT_AUTH_DATA, userId: 7 });
    await fixture.whenStable();
    expect(menu?.textContent).toContain('zugewiesenen Arbeitsbereiche');
    session.updateAuthData({ ...DEFAULT_AUTH_DATA, userId: 7, isAdmin: true });
    await fixture.whenStable();
    expect(menu?.textContent).toContain('Nutzerrechte und Arbeitsbereiche verwalten');
  });
});
