import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { AppService } from './app.service';
import { AuthExchangeResponse, DecodedToken, UserProfile } from './auth.models';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly appService = inject(AppService);
  private readonly tokenKey = 'auth_token';
  private readonly idTokenKey = 'id_token';
  private readonly refreshTokenKey = 'refresh_token';
  private refreshInFlight?: Promise<string | undefined>;
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(this.hasStoredSession());

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

  isLoggedIn(): boolean {
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

  login(returnUrl?: string): void {
    const redirectUri = this.appService.createLoginRedirectUri(returnUrl || this.appService.reAuthenticationReturnUrl);
    window.location.href = `${this.appService.serverUrl}auth/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  exchangeLoginCode(code: string): Observable<AuthExchangeResponse> {
    return this.http.post<AuthExchangeResponse>(`${this.appService.serverUrl}auth/exchange`, { code });
  }

  refreshToken(refreshToken: string): Observable<AuthExchangeResponse> {
    return this.http.post<AuthExchangeResponse>(`${this.appService.serverUrl}auth/refresh`, { refresh_token: refreshToken });
  }

  logout(): void {
    const refreshToken = this.getRefreshToken();
    this.appService.markExplicitLogoutInProgress();
    this.appService.clearAuthState({ clearReAuthentication: true });
    this.isAuthenticatedSubject.next(false);

    if (refreshToken) {
      this.http.post(`${this.appService.serverUrl}auth/logout`, { refresh_token: refreshToken }).subscribe({
        next: () => {
          window.location.href = window.location.origin;
        },
        error: () => {
          window.location.href = window.location.origin;
        }
      });
    } else {
      window.location.href = window.location.origin;
    }
  }

  redirectToProfile(): void {
    const redirectUri = encodeURIComponent(window.location.origin);
    window.location.href = `${this.appService.serverUrl}auth/profile?redirect_uri=${redirectUri}`;
  }

  getRoles(): string[] {
    const decodedToken = this.getLoggedUser();
    return decodedToken?.realm_access?.roles || [];
  }

  setToken(token: string): void {
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
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      this.clearStoredTokens();
      return undefined;
    }

    this.refreshInFlight = firstValueFrom(this.refreshToken(refreshToken))
      .then(tokenResponse => {
        this.setToken(tokenResponse.access_token);

        if (tokenResponse.id_token) {
          this.setIdToken(tokenResponse.id_token);
        }

        if (tokenResponse.refresh_token) {
          this.setRefreshToken(tokenResponse.refresh_token);
        }

        return tokenResponse.access_token;
      })
      .catch(() => {
        this.clearStoredTokens();
        return undefined;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });

    return this.refreshInFlight;
  }

  private hasStoredSession(): boolean {
    return this.hasValidToken() || !!this.getRefreshToken();
  }

  private clearStoredTokens(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.idTokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    this.isAuthenticatedSubject.next(false);
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
}
