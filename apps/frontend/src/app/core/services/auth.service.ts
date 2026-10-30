import { inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  firstValueFrom,
  Observable,
  Subject,
  tap
} from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { AppService } from './app.service';
import { AuthExchangeResponse, DecodedToken, UserProfile } from './auth.models';
import { suppressGlobalAndAuthRedirectHttpErrorContext } from '../interceptors/http-error-context';
import { AuthRefreshUnavailableError } from '../interceptors/auth-refresh-unavailable.error';
import { SessionRecoveryService } from './session-recovery.service';
import { AuthSessionState } from './auth-session-state.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly authenticationRecoveredSubject = new Subject<void>();
  readonly authenticationRecovered$ = this.authenticationRecoveredSubject.asObservable();
  private readonly refreshFailureState = signal<AuthRefreshUnavailableError | null>(null);
  readonly refreshFailure = this.refreshFailureState.asReadonly();
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly appService = inject(AppService);
  private readonly sessionRecovery = inject(SessionRecoveryService);
  private readonly session = inject(AuthSessionState);
  private readonly tokenKey = 'auth_token';
  private readonly idTokenKey = 'id_token';
  private readonly refreshTokenKey = 'refresh_token';
  private readonly loginVerifierKey = 'oidc_login_verifier';
  private sessionGeneration = 0;
  private refreshInFlight?: {
    generation: number;
    refreshToken: string;
    promise: Promise<string | undefined>;
  };

  constructor() {
    this.checkTokenValidity();
    this.session.setCredentialsAvailable(this.hasStoredSession());
  }

  getLoggedUser(): DecodedToken | undefined {
    const token = this.getToken();
    if (token) {
      try {
        return jwtDecode<DecodedToken>(token);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  async getValidToken(minValidity = 30): Promise<string | undefined> {
    const token = this.getToken();
    if (!token) {
      return this.refreshAccessToken();
    }

    if (this.isTokenValid(token, Math.max(0, minValidity))) {
      return token;
    }

    return this.refreshAccessToken();
  }

  getIdToken(): string | null {
    return localStorage.getItem(this.idTokenKey);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.refreshTokenKey);
  }

  getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  isLoggedIn(): boolean {
    const currentAvailability = this.session.credentialsAvailable();
    const hasStoredSession = this.hasStoredSession();
    if (hasStoredSession !== currentAvailability) {
      this.session.setCredentialsAvailable(hasStoredSession);
    }
    return hasStoredSession;
  }

  loadUserProfile(): Promise<UserProfile> {
    const decodedToken = this.getLoggedUser();
    if (decodedToken) {
      return Promise.resolve({
        id: decodedToken.sub,
        username: decodedToken.preferred_username,
        email: decodedToken.email,
        firstName: decodedToken.given_name,
        lastName: decodedToken.family_name
      });
    }
    return Promise.reject(new Error('No valid token found'));
  }

  async login(returnUrl?: string): Promise<void> {
    this.appService.clearLoginFailure();
    const redirectUri = this.appService.createLoginRedirectUri(returnUrl || this.appService.reAuthenticationReturnUrl);
    const browserVerifier = this.encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const challengeDigest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(browserVerifier)
    );
    const browserChallenge = this.encodeBase64Url(new Uint8Array(challengeDigest));
    globalThis.sessionStorage.setItem(this.loginVerifierKey, browserVerifier);

    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      browser_challenge: browserChallenge
    });
    this.document.location.href = `${this.appService.serverUrl}auth/login?${params.toString()}`;
  }

  exchangeLoginCode(code: string): Observable<AuthExchangeResponse> {
    const browserVerifier = globalThis.sessionStorage.getItem(this.loginVerifierKey);
    return this.http.post<AuthExchangeResponse>(`${this.appService.serverUrl}auth/exchange`, {
      code,
      browser_verifier: browserVerifier
    }, {
      context: suppressGlobalAndAuthRedirectHttpErrorContext()
    }).pipe(
      tap(() => globalThis.sessionStorage.removeItem(this.loginVerifierKey))
    );
  }

  refreshToken(refreshToken: string): Observable<AuthExchangeResponse> {
    return this.http.post<AuthExchangeResponse>(`${this.appService.serverUrl}auth/refresh`, { refresh_token: refreshToken }, {
      // Only the owning session may handle refresh failures; the interceptor cannot determine that.
      context: suppressGlobalAndAuthRedirectHttpErrorContext()
    });
  }

  logout(): void {
    const refreshToken = this.getRefreshToken();
    this.invalidatePendingRefresh();
    this.appService.markExplicitLogoutInProgress();
    this.appService.clearAuthState({ clearReAuthentication: true });
    this.session.clear();

    if (refreshToken) {
      this.http.post(`${this.appService.serverUrl}auth/logout`, { refresh_token: refreshToken }).subscribe({
        next: () => {
          this.document.location.href = this.document.location.origin;
        },
        error: () => {
          this.document.location.href = this.document.location.origin;
        }
      });
    } else {
      this.document.location.href = this.document.location.origin;
    }
  }

  redirectToProfile(): void {
    const redirectUri = encodeURIComponent(this.document.location.origin);
    this.document.location.href = `${this.appService.serverUrl}auth/profile?redirect_uri=${redirectUri}`;
  }

  getRoles(): string[] {
    const decodedToken = this.getLoggedUser();
    return decodedToken?.realm_access?.roles || [];
  }

  setToken(token: string): void {
    this.invalidatePendingRefresh();
    this.storeAccessToken(token);
  }

  private storeAccessToken(token: string): void {
    localStorage.setItem(this.tokenKey, token);
    this.session.setCredentialsAvailable(true);
  }

  setIdToken(idToken: string): void {
    localStorage.setItem(this.idTokenKey, idToken);
  }

  setRefreshToken(refreshToken: string): void {
    localStorage.setItem(this.refreshTokenKey, refreshToken);
  }

  hasValidToken(): boolean {
    const token = this.getToken();
    if (!token) {
      return false;
    }

    return this.isTokenValid(token);
  }

  private async refreshAccessToken(): Promise<string | undefined> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      const hadAccessToken = !!this.getToken();
      this.clearStoredTokens();
      if (hadAccessToken) this.appService.requireReAuthentication(this.router.url);
      return undefined;
    }

    const generation = this.sessionGeneration;
    if (this.refreshInFlight?.generation === generation && this.refreshInFlight.refreshToken === refreshToken) {
      return this.refreshInFlight.promise;
    }

    // AppService can also clear the stored session directly, without calling logout.
    const isCurrentSession = () => generation === this.sessionGeneration && refreshToken === this.getRefreshToken();
    const refreshPromise: Promise<string | undefined> = firstValueFrom(this.refreshToken(refreshToken))
      .then(tokenResponse => {
        if (!isCurrentSession()) return undefined;
        if (typeof tokenResponse?.access_token !== 'string' || !tokenResponse.access_token.trim()) {
          throw new AuthRefreshUnavailableError();
        }
        const recoveredFromFailure = this.refreshFailureState() !== null;
        this.refreshFailureState.set(null);
        this.storeAccessToken(tokenResponse.access_token);

        if (tokenResponse.id_token) {
          this.setIdToken(tokenResponse.id_token);
        }

        if (tokenResponse.refresh_token) {
          this.setRefreshToken(tokenResponse.refresh_token);
        }

        if (recoveredFromFailure) this.authenticationRecoveredSubject.next();
        return tokenResponse.access_token;
      })
      .catch((error: unknown) => {
        if (!isCurrentSession()) return undefined;
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.clearStoredTokens();
          this.appService.requireReAuthentication(this.router.url);
          return undefined;
        }
        const response = error instanceof HttpErrorResponse ? error : undefined;
        const requestId = response?.headers.get('X-Request-Id') || response?.error?.requestId;
        const failure = new AuthRefreshUnavailableError(
          response?.error?.code === 'configuration-error' ? 'configuration-error' : 'provider-unavailable',
          response?.status,
          typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : ''
        );
        this.refreshFailureState.set(failure);
        this.sessionRecovery.captureRegisteredDrafts();
        throw failure;
      })
      .finally(() => {
        if (this.refreshInFlight?.promise === refreshPromise) this.refreshInFlight = undefined;
      });

    this.refreshInFlight = { generation, refreshToken, promise: refreshPromise };
    return refreshPromise;
  }

  private hasStoredSession(): boolean {
    return this.hasValidToken() || !!this.getRefreshToken();
  }

  private clearStoredTokens(): void {
    this.invalidatePendingRefresh();
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.idTokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    // AppService captures recovery drafts before clearing the accepted identity.
    this.session.setCredentialsAvailable(false);
  }

  private invalidatePendingRefresh(): void {
    this.sessionGeneration += 1;
    this.refreshInFlight = undefined;
    this.refreshFailureState.set(null);
  }

  private isTokenValid(token: string, minValidity = 0): boolean {
    try {
      const decoded = jwtDecode<DecodedToken>(token);
      const now = Date.now() / 1000;
      if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) return false;
      // A fixed margin can exceed a short-lived token's entire lifetime and
      // refresh it before every API call. Keep at least 90% of its lifetime usable.
      const lifetime = typeof decoded.iat === 'number' && Number.isFinite(decoded.iat) && decoded.exp > decoded.iat ?
        decoded.exp - decoded.iat : undefined;
      const refreshAhead = lifetime === undefined ? minValidity : Math.min(minValidity, lifetime / 10);
      return decoded.exp > now + refreshAhead;
    } catch {
      return false;
    }
  }

  private checkTokenValidity(): void {
    const token = this.getToken();
    if (token && !this.hasValidToken()) {
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.idTokenKey);
    }

    if (!this.hasStoredSession()) {
      this.clearStoredTokens();
    }
  }

  private encodeBase64Url(bytes: Uint8Array): string {
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return globalThis.btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
