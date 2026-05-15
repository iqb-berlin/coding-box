import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject, Observable, Subject, of
} from 'rxjs';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { AppService, AuthBootstrapStatus } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import {
  AUTH_QUERY_PARAM_ACCESS_DENIED,
  AUTH_QUERY_PARAM_AUTH_DATA_FAILED,
  AUTH_QUERY_PARAM_SESSION_EXPIRED
} from '../../core/guards/auth-redirect';

const mockAuthService = {
  isLoggedIn: jest.fn(() => true)
};

const mockActivatedRoute = {
  snapshot: {
    data: {
      someData: 'test-data'
    }
  },
  queryParams: of({})
};

const defaultAuthData: AuthDataDto = {
  userId: 0,
  userName: '',
  email: '',
  firstName: '',
  lastName: '',
  isAdmin: false,
  workspaces: []
};

const mockAppService: {
  refreshAuthData: jest.Mock;
  requireReAuthentication: jest.Mock;
  authBootstrapStatus$: Observable<AuthBootstrapStatus>;
  authData$: Observable<AuthDataDto>;
  userProfile: {
    firstName: string;
    lastName: string;
  };
} = {
  refreshAuthData: jest.fn(),
  requireReAuthentication: jest.fn(),
  authBootstrapStatus$: of('ready' as AuthBootstrapStatus),
  authData$: of(defaultAuthData),
  userProfile: {
    firstName: '',
    lastName: ''
  }
};

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let queryParamsSubject: Subject<Record<string, string>>;
  let authStatusSubject: BehaviorSubject<AuthBootstrapStatus>;
  let authDataSubject: BehaviorSubject<AuthDataDto>;
  let snackBarOpen: jest.Mock;
  let routerNavigate: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    queryParamsSubject = new Subject<Record<string, string>>();
    authStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('ready');
    authDataSubject = new BehaviorSubject<AuthDataDto>(defaultAuthData);
    snackBarOpen = jest.fn();
    routerNavigate = jest.fn();
    mockActivatedRoute.queryParams = queryParamsSubject.asObservable();
    mockAppService.authBootstrapStatus$ = authStatusSubject.asObservable();
    mockAppService.authData$ = authDataSubject.asObservable();
    mockAuthService.isLoggedIn.mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [HomeComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: AuthService, useValue: mockAuthService },
        { provide: AppService, useValue: mockAppService },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: snackBarOpen }
        },
        { provide: Router, useValue: { navigate: routerNavigate } },
        provideHttpClient()
      ]
    }).compileComponents();
  });

  function createComponent(): void {
    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', () => {
    createComponent();

    expect(component).toBeTruthy();
  });

  it('should require reauthentication for expired-session query params when Keycloak is logged out', () => {
    createComponent();
    mockAuthService.isLoggedIn.mockReturnValue(false);

    queryParamsSubject.next({
      auth: AUTH_QUERY_PARAM_SESSION_EXPIRED,
      returnUrl: '/workspace-admin/1'
    });

    expect(mockAppService.requireReAuthentication).toHaveBeenCalledWith('/workspace-admin/1');
  });

  it('should not clear an active Keycloak session for stale expired-session query params', () => {
    createComponent();
    mockAuthService.isLoggedIn.mockReturnValue(true);

    queryParamsSubject.next({
      auth: AUTH_QUERY_PARAM_SESSION_EXPIRED,
      returnUrl: '/workspace-admin/1'
    });

    expect(mockAppService.requireReAuthentication).not.toHaveBeenCalled();
  });

  it('should show a dedicated message when auth data could not be loaded', () => {
    authStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('auth-data-failed');
    mockAppService.authBootstrapStatus$ = authStatusSubject.asObservable();
    createComponent();

    queryParamsSubject.next({ auth: AUTH_QUERY_PARAM_AUTH_DATA_FAILED });

    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Sitzungsdaten konnten nicht geladen werden'),
      'Schließen',
      expect.objectContaining({ duration: 8000 })
    );
  });

  it('should suppress stale auth-data failed query params while backend login is running', () => {
    authStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('backend-login-running');
    mockAppService.authBootstrapStatus$ = authStatusSubject.asObservable();
    createComponent();

    queryParamsSubject.next({
      auth: AUTH_QUERY_PARAM_AUTH_DATA_FAILED,
      returnUrl: '/workspace-admin/1'
    });

    expect(snackBarOpen).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalled();

    authDataSubject.next({
      userId: 1,
      userName: 'Test User',
      email: '',
      firstName: '',
      lastName: '',
      isAdmin: false,
      workspaces: []
    });

    expect(snackBarOpen).not.toHaveBeenCalled();
    expect(routerNavigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: {
        auth: null,
        returnUrl: null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    }));
  });

  it('should clear stale auth-data failed query params when auth bootstrap is already ready', () => {
    createComponent();

    queryParamsSubject.next({ auth: AUTH_QUERY_PARAM_AUTH_DATA_FAILED });

    expect(snackBarOpen).not.toHaveBeenCalled();
    expect(routerNavigate).toHaveBeenCalledWith([], expect.objectContaining({
      replaceUrl: true
    }));
  });

  it('should reset pending auth-data failed state when query params are cleared', () => {
    authStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('backend-login-running');
    mockAppService.authBootstrapStatus$ = authStatusSubject.asObservable();
    createComponent();

    queryParamsSubject.next({ auth: AUTH_QUERY_PARAM_AUTH_DATA_FAILED });
    queryParamsSubject.next({});
    authStatusSubject.next('auth-data-failed');

    expect(snackBarOpen).not.toHaveBeenCalled();
  });

  it('should show a dedicated message when access is denied', () => {
    createComponent();

    queryParamsSubject.next({ auth: AUTH_QUERY_PARAM_ACCESS_DENIED });

    expect(snackBarOpen).toHaveBeenCalledWith(
      'Sie haben keinen Zugriff auf diesen Bereich.',
      'Schließen',
      expect.objectContaining({ duration: 5000 })
    );
  });

  it('should refresh auth data once the auth bootstrap is ready', () => {
    authStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('checking');
    mockAppService.authBootstrapStatus$ = authStatusSubject.asObservable();
    createComponent();
    expect(mockAppService.refreshAuthData).not.toHaveBeenCalled();

    authStatusSubject.next('backend-login-running');
    expect(mockAppService.refreshAuthData).not.toHaveBeenCalled();

    authStatusSubject.next('ready');
    expect(mockAppService.refreshAuthData).toHaveBeenCalledTimes(1);
  });
});
