import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { createHash, randomBytes } from 'crypto';
import { CacheService } from '../../cache/cache.service';
import { AuthFailureException } from '../auth-failure.exception';
import { AuthErrorCode } from '../../../../../../api-dto/auth-error-dto';
import { isHttpEndpoint, logAuthProviderFailure } from '../auth-provider-errors';

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
  refresh_token?: string;
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
  private readonly pkceTtlSeconds = 5 * 60;
  private readonly tokenExchangeTtlSeconds = 60;
  private readonly refreshTimeoutMs = 10_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService
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

  getIssuer(): string {
    if (!isHttpEndpoint(this.oidcConfiguration.issuer)) {
      throw new AuthFailureException('configuration-error');
    }
    return this.oidcConfiguration.issuer;
  }

  /**
   * Generate the OpenID Connect authorization URL for the Authorization Code flow
   * @param state - Random state parameter for security
   * @param redirectUri - Callback URL after authentication
   * @returns Authorization URL
   */
  getAuthorizationUrl(state: string, redirectUri: string, codeChallenge?: string): string {
    if (!isHttpEndpoint(this.oidcConfiguration.authorization_endpoint) || !this.oAuth2ClientId?.trim()) {
      throw new AuthFailureException('configuration-error');
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
  async exchangeCodeForToken(code: string, redirectUri: string, codeVerifier?: string, requestId?: string): Promise<OidcTokenResponse> {
    if (!isHttpEndpoint(this.oidcConfiguration.token_endpoint) || !this.oAuth2ClientId?.trim()) {
      throw new AuthFailureException('configuration-error');
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
          timeout: this.refreshTimeoutMs,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log('Successfully obtained access token from authorization code');
      if (typeof response.data?.access_token !== 'string' || !response.data.access_token.trim()) {
        throw new AuthFailureException('provider-unavailable');
      }
      return response.data;
    } catch (error: unknown) {
      throw this.providerFailure(error, 'oidc-code-exchange-failed', this.oidcConfiguration.token_endpoint, requestId);
    }
  }

  /**
   * Refresh an access token using an OpenID Connect refresh token.
   * @param refreshToken - Refresh token from the provider
   * @returns Refreshed token response from OpenID Connect Provider
   */
  async refreshToken(refreshToken: string, requestId?: string): Promise<OidcTokenResponse> {
    if (!isHttpEndpoint(this.oidcConfiguration.token_endpoint) || !this.oAuth2ClientId?.trim()) {
      throw new AuthFailureException('configuration-error');
    }

    if (!refreshToken) {
      throw new AuthFailureException('session-invalid');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.oAuth2ClientId,
      refresh_token: refreshToken
    });

    if (this.oAuth2ClientSecret) {
      params.append('client_secret', this.oAuth2ClientSecret);
    }

    try {
      this.logger.log('Refreshing OpenID Connect access token');

      const response = await firstValueFrom(
        this.httpService.post(this.oidcConfiguration.token_endpoint, params.toString(), {
          timeout: this.refreshTimeoutMs,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      if (typeof response.data?.access_token !== 'string' || !response.data.access_token.trim()) {
        throw new AuthFailureException('provider-unavailable');
      }
      return response.data;
    } catch (error: unknown) {
      throw this.providerFailure(error, 'oidc-refresh-failed', this.oidcConfiguration.token_endpoint, requestId);
    }
  }

  /**
   * Get user information from OpenID Connect Provider using access token
   * @param accessToken - Access token from OpenID Connect Provider
   * @returns User information
   */
  async getUserInfo(accessToken: string, requestId?: string): Promise<OidcUserInfo> {
    if (!isHttpEndpoint(this.oidcConfiguration.userinfo_endpoint)) {
      throw new AuthFailureException('configuration-error');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(this.oidcConfiguration.userinfo_endpoint, {
          timeout: this.refreshTimeoutMs,
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
      );
      if (typeof response.data?.sub !== 'string' || !response.data.sub.trim()) {
        throw new AuthFailureException('provider-unavailable');
      }
      return response.data;
    } catch (error: unknown) {
      throw this.providerFailure(error, 'oidc-userinfo-failed', this.oidcConfiguration.userinfo_endpoint, requestId, true);
    }
  }

  /**
   * Generate OpenID Connect Provider logout URL
   * @param idToken - ID token for proper logout
   * @param redirectUri - URL to redirect after logout
   * @returns Logout URL
   */
  getLogoutUrl(idToken: string, redirectUri: string): string {
    if (!isHttpEndpoint(this.oidcConfiguration.end_session_endpoint) || !this.oAuth2ClientId?.trim()) {
      throw new AuthFailureException('configuration-error');
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
    if (!isHttpEndpoint(this.oidcConfiguration.end_session_endpoint) || !this.oAuth2ClientId?.trim()) {
      throw new AuthFailureException('configuration-error');
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
          timeout: this.refreshTimeoutMs,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log('Successfully logged out from OpenID Connect Provider SSO session');
    } catch (error: unknown) {
      throw this.providerFailure(error, 'oidc-logout-failed', this.oidcConfiguration.end_session_endpoint);
    }
  }

  /**
   * Generate OpenID Connect Provider profile management URL
   * @param redirectUri - Optional URL to redirect back to after profile management
   * @returns Profile management URL
   */
  getProfileUrl(redirectUri?: string): string {
    if (!isHttpEndpoint(this.oidcConfiguration.account_endpoint) || !this.oAuth2ClientId?.trim()) {
      throw new AuthFailureException('configuration-error');
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

  private providerFailure(error: unknown, event: string, endpoint: string, requestId?: string, userInfo = false): AuthFailureException {
    const providerError = error as { response?: { status?: number; data?: { error?: string } } } | null;
    const status = providerError?.response?.status;
    let code: AuthErrorCode = error instanceof AuthFailureException ? error.code : 'provider-unavailable';
    if ((status === 400 && providerError?.response?.data?.error === 'invalid_grant') || (userInfo && status === 401)) {
      code = 'session-invalid';
    } else if (status !== undefined && [400, 401, 403, 404].includes(status)) {
      code = 'configuration-error';
    }
    logAuthProviderFailure(this.logger, event, endpoint, code, typeof status === 'number' ? status : null, requestId);
    return new AuthFailureException(code);
  }

  async storePkceVerifier(
    state: string,
    codeVerifier: string,
    browserChallenge: string
  ): Promise<boolean> {
    return this.cacheService.set(
      this.pkceCacheKey(state),
      { codeVerifier, browserChallenge },
      this.pkceTtlSeconds
    );
  }

  async consumePkceVerifier(
    state: string
  ): Promise<{ codeVerifier: string; browserChallenge: string } | null> {
    return this.cacheService.getAndDelete<{
      codeVerifier: string;
      browserChallenge: string;
    }>(
      this.pkceCacheKey(state)
    );
  }

  async storeTokenExchange(
    tokenResponse: OidcTokenResponse,
    browserChallenge: string
  ): Promise<string | null> {
    const code = randomBytes(32).toString('base64url');
    const stored = await this.cacheService.set(
      this.tokenExchangeCacheKey(code),
      { tokenResponse, browserChallenge },
      this.tokenExchangeTtlSeconds
    );

    return stored ? code : null;
  }

  async consumeTokenExchange(
    code: string,
    browserVerifier: string
  ): Promise<OidcTokenResponse | null> {
    if (
      !code ||
      typeof code !== 'string' ||
      typeof browserVerifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(browserVerifier)
    ) {
      return null;
    }

    const cacheKey = this.tokenExchangeCacheKey(code);
    const browserChallenge = createHash('sha256')
      .update(browserVerifier)
      .digest('base64url');
    const cached = await this.cacheService.getAndDeleteIfFieldMatches<{
      tokenResponse: OidcTokenResponse;
      browserChallenge: string;
    }>(cacheKey, 'browserChallenge', browserChallenge);
    return cached?.tokenResponse ?? null;
  }

  private pkceCacheKey(state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `oidc:pkce:${digest}`;
  }

  private tokenExchangeCacheKey(code: string): string {
    const digest = createHash('sha256').update(code).digest('hex');
    return `oidc:token-exchange:${digest}`;
  }
}
