import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  BehaviorSubject,
  firstValueFrom,
  Observable,
  tap
} from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { AppService } from './app.service';
import { AuthExchangeResponse, DecodedToken, UserProfile } from './auth.models';
import { suppressGlobalAndAuthRedirectHttpErrorContext } from '../interceptors/http-error-context';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly appService = inject(AppService);
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

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(this.hasStoredSession());
  private readonly authenticatedState = toSignal(this.isAuthenticatedSubject, { requireSync: true });

  constructor() {
    this.checkTokenValidity();
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
    this.authenticatedState();
    const hasStoredSession = this.hasStoredSession();
    if (hasStoredSession !== this.isAuthenticatedSubject.value) {
      this.isAuthenticatedSubject.next(hasStoredSession);
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
    this.isAuthenticatedSubject.next(false);

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
    this.isAuthenticatedSubject.next(true);
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
        this.storeAccessToken(tokenResponse.access_token);

        if (tokenResponse.id_token) {
          this.setIdToken(tokenResponse.id_token);
        }

        if (tokenResponse.refresh_token) {
          this.setRefreshToken(tokenResponse.refresh_token);
        }

        return tokenResponse.access_token;
      })
      .catch(() => {
        if (isCurrentSession()) {
          this.clearStoredTokens();
          this.appService.requireReAuthentication(this.router.url);
        }
        return undefined;
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
    this.isAuthenticatedSubject.next(false);
  }

  private invalidatePendingRefresh(): void {
    this.sessionGeneration += 1;
    this.refreshInFlight = undefined;
  }

  private isTokenValid(token: string, minValidity = 0): boolean {
    try {
      const decoded = jwtDecode<DecodedToken>(token);
      const now = Date.now() / 1000;
      return decoded.exp ? decoded.exp > now + minValidity : false;
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
