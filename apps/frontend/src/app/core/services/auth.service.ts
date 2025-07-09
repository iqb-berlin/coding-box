import { inject, Injectable } from '@angular/core';
import Keycloak, { KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';

@Injectable()
export class AuthService {
  private readonly keycloak = inject(Keycloak);
  getLoggedUser(): KeycloakTokenParsed | undefined {
    try {
      return this.keycloak.idTokenParsed;
    } catch (e) {
      return { message: 'Parsing id token failed', err: e };
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

  async login(): Promise<void> {
    await this.keycloak.login();
  }

  async logout(): Promise<void> {
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
