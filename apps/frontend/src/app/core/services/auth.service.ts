import { inject, Injectable } from '@angular/core';
import Keycloak, { KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';
import { AppService } from './app.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly keycloak = inject(Keycloak);
  private readonly appService = inject(AppService);
  getLoggedUser(): KeycloakTokenParsed | undefined {
    try {
      return this.keycloak.idTokenParsed;
    } catch (e) {
      return undefined;
    }
  }

  getToken() {
    const token = this.keycloak.token;
    return token;
  }

  isLoggedIn(): boolean | undefined {
    return this.keycloak.authenticated;
  }

  loadUserProfile(): Promise<KeycloakProfile> {
    return this.keycloak.loadUserProfile();
  }

  async login(returnUrl?: string): Promise<void> {
    const redirectUri = this.appService.createLoginRedirectUri(returnUrl || this.appService.reAuthenticationReturnUrl);
    await this.keycloak.login(redirectUri ? { redirectUri } : undefined);
  }

  async logout(): Promise<void> {
    this.appService.markExplicitLogoutInProgress();
    this.appService.clearAuthState({ clearReAuthentication: true });
    await this.keycloak.logout({ redirectUri: window.location.origin });
  }

  async redirectToProfile(): Promise<void> {
    await this.keycloak.accountManagement();
  }

  getRoles(): string[] {
    if (this.keycloak.realmAccess) {
      return this.keycloak.realmAccess.roles;
    }
    return [];
  }
}
