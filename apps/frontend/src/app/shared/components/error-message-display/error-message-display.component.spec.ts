import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ErrorMessageDisplayComponent } from './error-message-display.component';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppHttpError } from '../../../core/interceptors/app-http-error.class';

describe('ErrorMessageDisplayComponent', () => {
  let fixture: ComponentFixture<ErrorMessageDisplayComponent>;
  let appService: {
    backendUnavailable: boolean;
    needsReAuthentication: boolean;
    errorMessages: AppHttpError[];
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

  it('should hide request details until the user expands them', () => {
    appService.errorMessages = [{
      id: 1,
      status: 504,
      message: 'Der Server antwortet gerade nicht.',
      method: '',
      urlWithParams: '',
      requestCount: 2,
      isBackendConnectivityError: true,
      affectedRequests: [
        { method: 'GET', urlWithParams: '/api/admin/users/access/5' },
        { method: 'POST', urlWithParams: '/api/admin/workspace/5/coding/statistics/job?version=v1' }
      ]
    } as AppHttpError];

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('error.requests_affected');
    expect(fixture.nativeElement.textContent).not.toContain('/api/admin/users/access/5');

    fixture.componentInstance.toggleErrorDetails(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('/api/admin/users/access/5');
    expect(fixture.nativeElement.textContent).toContain('/api/admin/workspace/5/coding/statistics/job?version=v1');
  });
});
