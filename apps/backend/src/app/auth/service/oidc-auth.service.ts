import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { createHash, randomBytes } from 'crypto';

export interface OidcConfiguration {
  issuer: string;
  account_endpoint: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
}

export interface OidcTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  id_token?: string;
}

export interface OidcUserInfo {
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
export class OidcAuthService {
  private readonly logger = new Logger(OidcAuthService.name);
  private readonly oidcConfiguration: OidcConfiguration;
  private readonly oAuth2ClientId: string;
  private readonly oAuth2ClientSecret?: string;
  private readonly pkceTtlMs = 5 * 60 * 1000;
  private readonly pkceStore = new Map<string, { codeVerifier: string; expiresAt: number }>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.oidcConfiguration = {
      issuer: this.configService.get<string>('OIDC_ISSUER') ?? '',
      account_endpoint: this.configService.get<string>('OIDC_ACCOUNT_ENDPOINT') ?? '',
      authorization_endpoint: this.configService.get<string>('OIDC_AUTHORIZATION_ENDPOINT') ?? '',
      token_endpoint: this.configService.get<string>('OIDC_TOKEN_ENDPOINT') ?? '',
      userinfo_endpoint: this.configService.get<string>('OIDC_USERINFO_ENDPOINT') ?? '',
      end_session_endpoint: this.configService.get<string>('OIDC_END_SESSION_ENDPOINT') ?? '',
      jwks_uri: this.configService.get<string>('OIDC_JWKS_URI') ?? ''
    };
    this.oAuth2ClientId = this.configService.get<string>('OAUTH2_CLIENT_ID');
    this.oAuth2ClientSecret = this.configService.get<string>('OAUTH2_CLIENT_SECRET');
  }

  /**
   * Generate the OpenID Connect authorization URL for the Authorization Code flow
   * @param state - Random state parameter for security
   * @param redirectUri - Callback URL after authentication
   * @returns Authorization URL
   */
  getAuthorizationUrl(state: string, redirectUri: string, codeChallenge?: string): string {
    if (!this.oidcConfiguration.authorization_endpoint || !this.oAuth2ClientId) {
      throw new UnauthorizedException('OpenID Connect configuration is missing');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.oAuth2ClientId,
      redirect_uri: redirectUri,
      state: state,
      scope: 'openid profile email'
    });

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    return `${this.oidcConfiguration.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code - Authorization code from OpenID Connect Provider
   * @param redirectUri - The same redirect URI used in authorization request
   * @returns Token response from OpenID Connect Provider
   */
  async exchangeCodeForToken(code: string, redirectUri: string, codeVerifier?: string): Promise<OidcTokenResponse> {
    if (!this.oidcConfiguration.token_endpoint || !this.oAuth2ClientId) {
      throw new UnauthorizedException('OpenID Connect token endpoint configuration is missing');
    }

    if (!codeVerifier) {
      throw new UnauthorizedException('PKCE code verifier is missing');
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.oAuth2ClientId,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });

    if (this.oAuth2ClientSecret) {
      params.append('client_secret', this.oAuth2ClientSecret);
    }

    try {
      this.logger.log('Exchanging authorization code for access token');

      const response = await firstValueFrom(
        this.httpService.post(this.oidcConfiguration.token_endpoint, params.toString(), {
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
   * Get user information from OpenID Connect Provider using access token
   * @param accessToken - Access token from OpenID Connect Provider
   * @returns User information
   */
  async getUserInfo(accessToken: string): Promise<OidcUserInfo> {
    if (!this.oidcConfiguration.userinfo_endpoint) {
      throw new UnauthorizedException('OpenID Connect userinfo endpoint configuration is missing');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(this.oidcConfiguration.userinfo_endpoint, {
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
   * Generate OpenID Connect Provider logout URL
   * @param idToken - ID token for proper logout
   * @param redirectUri - URL to redirect after logout
   * @returns Logout URL
   */
  getLogoutUrl(idToken: string, redirectUri: string): string {
    if (!this.oidcConfiguration.end_session_endpoint || !this.oAuth2ClientId) {
      throw new UnauthorizedException('OpenID Connect end session endpoint configuration is missing');
    }

    const params = new URLSearchParams({
      client_id: this.oAuth2ClientId,
      id_token_hint: idToken,
      post_logout_redirect_uri: redirectUri
    });

    return `${this.oidcConfiguration.end_session_endpoint}?${params.toString()}`;
  }

  /**
   * POST logout to OpenID Connect Provider to terminate SSO session
   * @param refreshToken - Refresh token to invalidate
   * @returns Promise that resolves when logout is complete
   */
  async logoutWithRefreshToken(refreshToken: string): Promise<void> {
    if (!this.oidcConfiguration.end_session_endpoint || !this.oAuth2ClientId) {
      throw new UnauthorizedException('OpenID Connect end session endpoint configuration is missing');
    }

    const params = new URLSearchParams({
      client_id: this.oAuth2ClientId,
      refresh_token: refreshToken
    });

    // Add client_secret only for confidential clients
    if (this.oAuth2ClientSecret) {
      params.append('client_secret', this.oAuth2ClientSecret);
    }

    try {
      this.logger.log('Performing POST logout to OpenID Connect Provider');

      await firstValueFrom(
        this.httpService.post(this.oidcConfiguration.end_session_endpoint, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log('Successfully logged out from OpenID Connect Provider SSO session');
    } catch (error) {
      this.logger.error('Failed to logout from OpenID Connect Provider:', error.response?.data || error.message);
      throw new UnauthorizedException('Failed to logout from OpenID Connect Provider');
    }
  }

  /**
   * Generate OpenID Connect Provider profile management URL
   * @param redirectUri - Optional URL to redirect back to after profile management
   * @returns Profile management URL
   */
  getProfileUrl(redirectUri?: string): string {
    if (!this.oidcConfiguration.account_endpoint || !this.oAuth2ClientId) {
      throw new UnauthorizedException('OpenID Connect account endpoint configuration is missing');
    }

    if (redirectUri) {
      const params = new URLSearchParams({
        referrer: this.oAuth2ClientId,
        referrer_uri: redirectUri
      });
      return `${this.oidcConfiguration.account_endpoint}?${params.toString()}`;
    }

    return this.oidcConfiguration.account_endpoint;
  }

  generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  async storePkceVerifier(state: string, codeVerifier: string): Promise<boolean> {
    const cacheKey = this.pkceCacheKey(state);
    const expiresAt = Date.now() + this.pkceTtlMs;
    this.pkceStore.set(cacheKey, { codeVerifier, expiresAt });
    return true;
  }

  async consumePkceVerifier(state: string): Promise<string | null> {
    const cacheKey = this.pkceCacheKey(state);
    const cached = this.pkceStore.get(cacheKey);
    this.pkceStore.delete(cacheKey);
    if (!cached || cached.expiresAt < Date.now()) {
      return null;
    }
    return cached.codeVerifier;
  }

  private pkceCacheKey(state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `oidc:pkce:${digest}`;
  }
}
