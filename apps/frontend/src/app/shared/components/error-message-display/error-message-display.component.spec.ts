import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ErrorMessageDisplayComponent } from './error-message-display.component';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';

describe('ErrorMessageDisplayComponent', () => {
  let fixture: ComponentFixture<ErrorMessageDisplayComponent>;
  let appService: {
    backendUnavailable: boolean;
    needsReAuthentication: boolean;
    errorMessages: unknown[];
    reAuthenticationReturnUrl?: string;
    setBackendUnavailable: jest.Mock;
    setNeedsReAuthentication: jest.Mock;
  };
  let authService: { login: jest.Mock };
  let router: { url: string };

  beforeEach(async () => {
    appService = {
      backendUnavailable: false,
      needsReAuthentication: true,
      errorMessages: [],
      reAuthenticationReturnUrl: '/coding',
      setBackendUnavailable: jest.fn(),
      setNeedsReAuthentication: jest.fn()
    };
    authService = { login: jest.fn() };
    router = { url: '/home?auth=session-expired' };

    await TestBed.configureTestingModule({
      imports: [ErrorMessageDisplayComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ErrorMessageDisplayComponent);
  });

  it('should hide the global reauthentication message on the home route', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('error.reauthentication_title');
  });

  it('should show the global reauthentication message outside the home route', () => {
    router.url = '/coding';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.reauthentication_title');
  });

  it('should start login with the remembered return URL', () => {
    fixture.componentInstance.handleLogin();

    expect(authService.login).toHaveBeenCalledWith('/coding');
  });
});
