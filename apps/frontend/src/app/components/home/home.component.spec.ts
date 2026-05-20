import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject, Observable, Subject, of, throwError
} from 'rxjs';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { AppService, AuthBootstrapStatus } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { UserService } from '../../shared/services/user/user.service';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
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
  let getUsers: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    queryParamsSubject = new Subject<Record<string, string>>();
    authStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('ready');
    authDataSubject = new BehaviorSubject<AuthDataDto>(defaultAuthData);
    snackBarOpen = jest.fn();
    routerNavigate = jest.fn();
    getUsers = jest.fn();
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
        {
          provide: UserService,
          useValue: { getUsers }
        },
        {
          provide: Router,
          useValue: {
            navigate: routerNavigate,
            createUrlTree: jest.fn().mockReturnValue({}),
            serializeUrl: jest.fn().mockReturnValue('/workspace-admin/11'),
            events: of({})
          }
        },
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

  it('should not route to coding when canCode is explicitly false for a level 1 user', async () => {
    getUsers.mockReturnValue(of([{ id: 7, accessLevel: 1, canCode: false }]));
    authDataSubject.next({
      ...defaultAuthData,
      userId: 7,
      workspaces: [{ id: 11 } as WorkspaceFullDto]
    });

    createComponent();
    await fixture.whenStable();

    expect(getUsers).toHaveBeenCalledWith(11);
    expect(routerNavigate).not.toHaveBeenCalledWith(['/coding']);
  });

  it.each([
    {
      label: 'pure coder',
      workspaceUser: { id: 7, accessLevel: 1, canCode: true },
      shouldRouteToCoding: true
    },
    {
      label: 'coding manager with coding rights',
      workspaceUser: { id: 7, accessLevel: 2, canCode: true },
      shouldRouteToCoding: false
    },
    {
      label: 'coding manager without coding rights',
      workspaceUser: { id: 7, accessLevel: 2, canCode: false },
      shouldRouteToCoding: false
    },
    {
      label: 'study manager with coding rights',
      workspaceUser: { id: 7, accessLevel: 3, canCode: true },
      shouldRouteToCoding: false
    },
    {
      label: 'study manager without coding rights',
      workspaceUser: { id: 7, accessLevel: 3, canCode: false },
      shouldRouteToCoding: false
    },
    {
      label: 'legacy level 1 coder without canCode field',
      workspaceUser: { id: 7, accessLevel: 1 },
      shouldRouteToCoding: true
    }
  ])('should handle home auto-routing for $label', async ({ workspaceUser, shouldRouteToCoding }) => {
    getUsers.mockReturnValue(of([workspaceUser]));
    authDataSubject.next({
      ...defaultAuthData,
      userId: 7,
      workspaces: [{ id: 11 } as WorkspaceFullDto]
    });

    createComponent();
    await fixture.whenStable();

    expect(getUsers).toHaveBeenCalledWith(11);
    if (shouldRouteToCoding) {
      expect(routerNavigate).toHaveBeenCalledWith(['/coding']);
    } else {
      expect(routerNavigate).not.toHaveBeenCalledWith(['/coding']);
    }
  });

  it('should not route to coding when a user is a coder in one workspace and manager in another', async () => {
    getUsers.mockImplementation((workspaceId: number) => of(workspaceId === 11 ?
      [{ id: 7, accessLevel: 1, canCode: true }] :
      [{ id: 7, accessLevel: 3, canCode: true }]));
    authDataSubject.next({
      ...defaultAuthData,
      userId: 7,
      workspaces: [
        { id: 11 } as WorkspaceFullDto,
        { id: 12 } as WorkspaceFullDto
      ]
    });

    createComponent();
    await fixture.whenStable();

    expect(getUsers).toHaveBeenCalledWith(11);
    expect(getUsers).toHaveBeenCalledWith(12);
    expect(routerNavigate).not.toHaveBeenCalledWith(['/coding']);
  });

  it('should not route to coding when one of multiple workspace access requests fails', async () => {
    getUsers.mockImplementation((workspaceId: number) => (workspaceId === 11 ?
      of([{ id: 7, accessLevel: 1, canCode: true }]) :
      throwError(() => new Error('access failed'))));
    authDataSubject.next({
      ...defaultAuthData,
      userId: 7,
      workspaces: [
        { id: 11 } as WorkspaceFullDto,
        { id: 12 } as WorkspaceFullDto
      ]
    });

    createComponent();
    await fixture.whenStable();

    expect(getUsers).toHaveBeenCalledWith(11);
    expect(getUsers).toHaveBeenCalledWith(12);
    expect(routerNavigate).not.toHaveBeenCalledWith(['/coding']);
  });

  it('should not route to coding when workspace access cannot be loaded', async () => {
    getUsers.mockReturnValue(throwError(() => new Error('access failed')));
    authDataSubject.next({
      ...defaultAuthData,
      userId: 7,
      workspaces: [{ id: 11 } as WorkspaceFullDto]
    });

    createComponent();
    await fixture.whenStable();

    expect(getUsers).toHaveBeenCalledWith(11);
    expect(routerNavigate).not.toHaveBeenCalledWith(['/coding']);
  });

  it('should not auto-route admins to coding even when they can code', async () => {
    getUsers.mockReturnValue(of([{ id: 7, accessLevel: 3, canCode: true }]));
    authDataSubject.next({
      ...defaultAuthData,
      userId: 7,
      isAdmin: true,
      workspaces: [{ id: 11 } as WorkspaceFullDto]
    });

    createComponent();
    await fixture.whenStable();

    expect(getUsers).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalledWith(['/coding']);
  });
});
