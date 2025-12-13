import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface KeycloakTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  id_token?: string;
}

export interface KeycloakUserInfo {
  sub: string;
  preferred_username: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  realm_access?: {
    roles: string[];
  };
}

@Injectable()
export class KeycloakAuthService {
  private readonly logger = new Logger(KeycloakAuthService.name);
  private readonly keycloakUrl: string;
  private readonly keycloakRealm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.keycloakUrl = this.configService.get<string>('KEYCLOAK_URL');
    this.keycloakRealm = this.configService.get<string>('KEYCLOAK_REALM');
    this.clientId = this.configService.get<string>('KEYCLOAK_CLIENT_ID');
    this.clientSecret = this.configService.get<string>('KEYCLOAK_CLIENT_SECRET');
  }

  /**
   * Generate the Keycloak authorization URL for the Authorization Code flow
   * @param state - Random state parameter for security
   * @param redirectUri - Callback URL after authentication
   * @returns Authorization URL
   */
  getAuthorizationUrl(state: string, redirectUri: string): string {
    if (!this.keycloakUrl || !this.keycloakRealm || !this.clientId) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const authUrl = `${this.keycloakUrl}realms/${this.keycloakRealm}/protocol/openid-connect/auth`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state: state,
      scope: 'openid profile email'
    });

    return `${authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code - Authorization code from Keycloak
   * @param redirectUri - The same redirect URI used in authorization request
   * @returns Token response from Keycloak
   */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<KeycloakTokenResponse> {
    if (!this.keycloakUrl || !this.keycloakRealm || !this.clientId || !this.clientSecret) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const tokenEndpoint = `${this.keycloakUrl}realms/${this.keycloakRealm}/protocol/openid-connect/token`;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: code,
      redirect_uri: redirectUri
    });

    try {
      this.logger.log('Exchanging authorization code for access token');

      const response = await firstValueFrom(
        this.httpService.post(tokenEndpoint, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log('Successfully obtained access token from authorization code');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to exchange authorization code for token:', error.response?.data || error.message);
      throw new UnauthorizedException('Failed to exchange authorization code for token');
    }
  }

  /**
   * Get user information from Keycloak using access token
   * @param accessToken - Access token from Keycloak
   * @returns User information
   */
  async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    if (!this.keycloakUrl || !this.keycloakRealm) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const userinfoEndpoint = `${this.keycloakUrl}realms/${this.keycloakRealm}/protocol/openid-connect/userinfo`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(userinfoEndpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get user info:', error.response?.data || error.message);
      throw new UnauthorizedException('Failed to get user information');
    }
  }

  /**
   * Generate Keycloak logout URL
   * @param idToken - ID token for proper logout
   * @param redirectUri - URL to redirect after logout
   * @returns Logout URL
   */
  getLogoutUrl(idToken: string, redirectUri: string): string {
    if (!this.keycloakUrl || !this.keycloakRealm || !this.clientId) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const logoutUrl = `${this.keycloakUrl}realms/${this.keycloakRealm}/protocol/openid-connect/logout`;
    const params = new URLSearchParams({
      client_id: this.clientId,
      id_token_hint: idToken,
      post_logout_redirect_uri: redirectUri
    });

    return `${logoutUrl}?${params.toString()}`;
  }

  /**
   * POST logout to Keycloak to terminate SSO session
   * @param refreshToken - Refresh token to invalidate
   * @returns Promise that resolves when logout is complete
   */
  async logoutWithRefreshToken(refreshToken: string): Promise<void> {
    if (!this.keycloakUrl || !this.keycloakRealm || !this.clientId) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const logoutEndpoint = `${this.keycloakUrl}realms/${this.keycloakRealm}/protocol/openid-connect/logout`;

    const params = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: refreshToken
    });

    // Add client_secret only for confidential clients
    if (this.clientSecret) {
      params.append('client_secret', this.clientSecret);
    }

    try {
      this.logger.log('Performing POST logout to Keycloak');

      await firstValueFrom(
        this.httpService.post(logoutEndpoint, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log('Successfully logged out from Keycloak SSO session');
    } catch (error) {
      this.logger.error('Failed to logout from Keycloak:', error.response?.data || error.message);
      throw new UnauthorizedException('Failed to logout from Keycloak');
    }
  }

  /**
   * Generate Keycloak profile management URL
   * @param redirectUri - Optional URL to redirect back to after profile management
   * @returns Profile management URL
   */
  getProfileUrl(redirectUri?: string): string {
    if (!this.keycloakUrl || !this.keycloakRealm || !this.clientId) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const profileUrl = `${this.keycloakUrl}realms/${this.keycloakRealm}/account`;
    if (redirectUri) {
      const params = new URLSearchParams({
        referrer: this.clientId,
        referrer_uri: redirectUri
      });
      return `${profileUrl}?${params.toString()}`;
    }

    return profileUrl;
  }
}
