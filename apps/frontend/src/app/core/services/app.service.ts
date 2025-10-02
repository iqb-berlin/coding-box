import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  Subject,
  catchError,
  map,
  of,
  retry,
  throwError,
  timer
} from 'rxjs';
import { DecodedToken } from './auth.service';
import { AppLogoDto } from '../../../../../../api-dto/app-logo-dto';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import {
  AppHttpError,
  BACKEND_CONNECTIVITY_ERROR_MESSAGE,
  isBackendConnectivityStatus
} from '../interceptors/app-http-error.class';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { LogoService } from './logo.service';
import { SERVER_URL } from '../../injection-tokens';
import { suppressGlobalHttpErrorContext } from '../interceptors/http-error-context';

export type AuthBootstrapStatus =
  'checking'
  | 'backend-login-running'
  | 'ready'
  | 'session-expired'
  | 'auth-data-failed';

const AUTH_BOOTSTRAP_RETRY_DELAYS_MS = [500, 1000, 2000];
const RETRYABLE_AUTH_BOOTSTRAP_ERROR_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);

@Injectable({
  providedIn: 'root'
})
export class AppService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private logoService = inject(LogoService);

  static defaultAuthData = <AuthDataDto>{
    userId: 0,
    userName: '',
    email: '',
    firstName: '',
    lastName: '',
    workspaces: []
  };

  user?: CreateUserDto;
  userProfile: Partial<CreateUserDto> = {};
  isLoggedIn = false;
  errorMessagesDisabled = false;
  selectedWorkspaceId = 0;
  dataLoading: boolean | number = false;
  appLogo: AppLogoDto = standardLogo;
  postMessage$ = new Subject<MessageEvent>();
  loggedUser: DecodedToken | undefined;
  errorMessages: AppHttpError[] = [];
  errorMessageCounter = 0;
  backendUnavailable = false;
  needsReAuthentication = false;
  reAuthenticationReturnUrl?: string;
  private explicitLogoutInProgress = false;
  private authBootstrapStatusSubject = new BehaviorSubject<AuthBootstrapStatus>('checking');
  private authDataSubject = new BehaviorSubject<AuthDataDto>(AppService.defaultAuthData);

  constructor() {
    this.loadLogoSettings();
  }

  createOwnToken(workspaceId: number, duration: number): Observable<string> {
    return this.http.get<string>(
      `${this.serverUrl}admin/workspace/${workspaceId}/token/${duration}`
    );
  }

  createTokenForIdentity(workspaceId: number, identity: string, duration: number): Observable<string> {
    const encodedIdentity = encodeURIComponent(identity);
    return this.http.get<string>(
      `${this.serverUrl}admin/workspace/${workspaceId}/${encodedIdentity}/token/${duration}`
    );
  }

  getAuthData(identity: string): Observable<AuthDataDto> {
    return this.http.get<AuthDataDto>(
      `${this.serverUrl}auth-data?identity=${encodeURIComponent(identity)}`
    );
  }

  retryAuthDataLoad(): Observable<boolean> {
    const identity = this.loggedUser?.sub || '';
    if (!identity || !this.hasStoredAuthToken()) {
      this.markAuthDataFailed();
      return of(false);
    }

    return this.loadAuthData(identity);
  }

  refreshAuthData(): void {
    const identity = this.loggedUser?.sub;
    if (!identity) {
      this.markAuthDataFailed();
      return;
    }

    this.loadAuthData(identity).subscribe();
  }

  private loadAuthData(identity: string): Observable<boolean> {
    this.setAuthBootstrapStatus('backend-login-running');

    return this.getAuthDataWithRetry(identity)
      .pipe(
        map(authData => {
          this.updateAuthData(authData);
          this.completeBackendLogin();
          return true;
        }),
        catchError(() => {
          this.markAuthDataFailed();
          return of(false);
        })
      );
  }

  private getAuthDataWithRetry(identity: string): Observable<AuthDataDto> {
    return this.withAuthBootstrapRetry(
      this.http.get<AuthDataDto>(
        `${this.serverUrl}auth-data?identity=${encodeURIComponent(identity)}`,
        { context: suppressGlobalHttpErrorContext() }
      )
    );
  }

  private withAuthBootstrapRetry<T>(request$: Observable<T>): Observable<T> {
    return request$.pipe(
      retry({
        count: AUTH_BOOTSTRAP_RETRY_DELAYS_MS.length,
        delay: (error: { status?: number }, retryCount: number) => {
          if (!this.isRetryableAuthBootstrapError(error)) {
            return throwError(() => error);
          }
          return timer(AUTH_BOOTSTRAP_RETRY_DELAYS_MS[retryCount - 1]);
        }
      })
    );
  }

  private isRetryableAuthBootstrapError(error: { status?: number }): boolean {
    return RETRYABLE_AUTH_BOOTSTRAP_ERROR_STATUSES.has(error.status ?? -1);
  }

  private loadLogoSettings(): void {
    this.logoService.getLogoSettings().subscribe({
      next: settings => {
        if (settings) {
          this.appLogo = settings;
        }
      },
      error: () => {
        this.appLogo = standardLogo;
      }
    });
  }

  get authData$() {
    return this.authDataSubject.asObservable();
  }

  get authBootstrapStatus$() {
    return this.authBootstrapStatusSubject.asObservable();
  }

  get authData(): AuthDataDto {
    return this.authDataSubject.value;
  }

  get authBootstrapStatus(): AuthBootstrapStatus {
    return this.authBootstrapStatusSubject.value;
  }

  get userId(): number {
    return this.authDataSubject.value.userId;
  }

  setAuthBootstrapStatus(status: AuthBootstrapStatus): void {
    this.authBootstrapStatusSubject.next(status);
  }

  updateAuthData(newAuthData: AuthDataDto): void {
    this.authDataSubject.next(newAuthData);
  }

  processMessagePost(postData: MessageEvent): void {
    const msgData = postData.data;
    const msgType = msgData.type;
    if ((typeof msgType !== 'undefined') && (msgType !== null)) {
      this.postMessage$.next(postData);
    }
  }

  addErrorMessage(error: AppHttpError): void {
    if (this.errorMessagesDisabled) {
      return;
    }

    this.normalizeError(error);
    const alikeError = this.errorMessages.find(existingError => this.isSameErrorGroup(existingError, error));

    if (alikeError) {
      this.normalizeError(alikeError);
      alikeError.requestCount = (alikeError.requestCount || 1) + 1;
      this.addAffectedRequest(alikeError, error);
      if (!alikeError.isBackendConnectivityError && !alikeError.message.includes(error.message)) {
        alikeError.message += `; ${error.message}`;
        alikeError.userMessage = alikeError.message;
      }
      return;
    }

    this.errorMessageCounter += 1;
    error.id = this.errorMessageCounter;
    this.addAffectedRequest(error, error);
    this.errorMessages.push(error);
  }

  setBackendUnavailable(unavailable: boolean): void {
    this.backendUnavailable = unavailable;
  }

  setNeedsReAuthentication(needs: boolean): void {
    this.needsReAuthentication = needs;
    if (!needs) {
      this.reAuthenticationReturnUrl = undefined;
    }
  }

  hasStoredAuthToken(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  isBackendLoginRunning(): boolean {
    return this.authBootstrapStatus === 'backend-login-running';
  }

  clearAuthenticationErrorMessages(): void {
    this.errorMessages = this.errorMessages.filter(error => error.status !== 401);
  }

  completeBackendLogin(): void {
    this.clearAuthenticationErrorMessages();
    this.setNeedsReAuthentication(false);
    this.setAuthBootstrapStatus('ready');
  }

  markAuthDataFailed(): void {
    this.setAuthBootstrapStatus('auth-data-failed');
  }

  normalizeInternalRoute(returnUrl?: string): string | undefined {
    if (!returnUrl ||
      !returnUrl.startsWith('/') ||
      returnUrl.startsWith('//') ||
      returnUrl === '/' ||
      returnUrl.startsWith('/home')) {
      return undefined;
    }

    return returnUrl;
  }

  createLoginRedirectUri(returnUrl?: string): string {
    const normalizedReturnUrl = this.normalizeInternalRoute(returnUrl);
    if (!normalizedReturnUrl) {
      return `${window.location.origin}${window.location.pathname}${window.location.search}`;
    }

    return `${window.location.origin}${window.location.pathname}${window.location.search}#${normalizedReturnUrl}`;
  }

  markExplicitLogoutInProgress(): void {
    this.explicitLogoutInProgress = true;
  }

  consumeExplicitLogoutInProgress(): boolean {
    const logoutInProgress = this.explicitLogoutInProgress;
    this.explicitLogoutInProgress = false;
    return logoutInProgress;
  }

  clearAuthState(options: { clearReAuthentication?: boolean; clearReturnUrl?: boolean } = {}): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('id_token');
    localStorage.removeItem('refresh_token');
    this.user = undefined;
    this.userProfile = {};
    this.isLoggedIn = false;
    this.loggedUser = undefined;
    this.updateAuthData(AppService.defaultAuthData);

    if (options.clearReAuthentication ?? true) {
      this.needsReAuthentication = false;
    }

    if (options.clearReturnUrl ?? true) {
      this.reAuthenticationReturnUrl = undefined;
    }

    if (options.clearReAuthentication ?? true) {
      this.setAuthBootstrapStatus('ready');
    }
  }

  requireReAuthentication(returnUrl?: string): void {
    const normalizedReturnUrl = this.normalizeInternalRoute(returnUrl) || this.reAuthenticationReturnUrl;
    this.clearAuthState({ clearReAuthentication: false, clearReturnUrl: false });
    this.reAuthenticationReturnUrl = normalizedReturnUrl;
    this.setNeedsReAuthentication(true);
    this.setAuthBootstrapStatus('session-expired');
  }

  private normalizeError(error: AppHttpError): void {
    error.requestCount = error.requestCount || 1;
    error.affectedRequests = error.affectedRequests || [];
    error.userMessage = error.userMessage || error.message;
    error.technicalMessage = error.technicalMessage || '';
    error.isBackendConnectivityError = isBackendConnectivityStatus(error.status);

    if (error.isBackendConnectivityError) {
      error.message = BACKEND_CONNECTIVITY_ERROR_MESSAGE;
      error.userMessage = BACKEND_CONNECTIVITY_ERROR_MESSAGE;
    }
  }

  private isSameErrorGroup(existingError: AppHttpError, newError: AppHttpError): boolean {
    if (isBackendConnectivityStatus(existingError.status) && isBackendConnectivityStatus(newError.status)) {
      return true;
    }

    return existingError.status === newError.status &&
      existingError.method === newError.method &&
      existingError.urlWithParams === newError.urlWithParams;
  }

  private addAffectedRequest(target: AppHttpError, source: AppHttpError): void {
    if (!source.method && !source.urlWithParams) {
      return;
    }

    target.affectedRequests = target.affectedRequests || [];

    const request = {
      method: source.method,
      urlWithParams: source.urlWithParams,
      requestId: source.requestId?.trim() || undefined
    };
    const isKnownRequest = target.affectedRequests.some(knownRequest => (
      knownRequest.method === request.method &&
      knownRequest.urlWithParams === request.urlWithParams &&
      knownRequest.requestId === request.requestId
    ));

    if (!isKnownRequest) {
      target.affectedRequests.push(request);
    }
  }
}

export const standardLogo: AppLogoDto = {
  data: 'assets/images/IQB-LogoA.png',
  alt: 'Zur Startseite',
  bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
  boxBackground: 'lightgray'
};
