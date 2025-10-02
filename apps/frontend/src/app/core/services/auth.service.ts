import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../../environments/environment';

export interface UserProfile {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface DecodedToken {
  sub?: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: {
    roles: string[];
  };
  exp?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokenKey = 'auth_token';
  private readonly idTokenKey = 'id_token';
  private readonly refreshTokenKey = 'refresh_token';
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(this.hasValidToken());

  constructor() {
    this.checkTokenValidity();
  }

  getLoggedUser(): DecodedToken | undefined {
    const token = this.getToken();
    if (token) {
      try {
        return jwtDecode<DecodedToken>(token);
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  getIdToken(): string | null {
    return localStorage.getItem(this.idTokenKey);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.refreshTokenKey);
  }

  isLoggedIn(): boolean {
    return this.isAuthenticatedSubject.value;
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

  login(): void {
    const redirectUri = encodeURIComponent(window.location.origin);
    window.location.href = `${environment.backendUrl}auth/login?redirect_uri=${redirectUri}`;
  }

  logout(): void {
    const refreshToken = this.getRefreshToken();
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.idTokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    this.isAuthenticatedSubject.next(false);

    if (refreshToken) {
      const logoutPayload = {
        refresh_token: refreshToken
      };

      this.http.post(`${environment.backendUrl}/auth/logout`, logoutPayload).subscribe({
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
    window.location.href = `${environment.backendUrl}/auth/profile?redirect_uri=${redirectUri}`;
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

    try {
      const decoded = jwtDecode<DecodedToken>(token);
      const now = Date.now() / 1000;
      return decoded.exp ? decoded.exp > now : false;
    } catch {
      return false;
    }
  }

  private checkTokenValidity(): void {
    if (!this.hasValidToken()) {
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.idTokenKey);
      localStorage.removeItem(this.refreshTokenKey);
      this.isAuthenticatedSubject.next(false);
    }
  }
}
