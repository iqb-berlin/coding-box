import {
  Controller, Post, Body, Logger, HttpCode, HttpStatus, Get, Query, Res,
  UnauthorizedException
} from '@nestjs/common';
import {
  ApiTags, ApiOkResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiBody, ApiQuery, ApiOperation
} from '@nestjs/swagger';
import { Response } from 'express';
import { OAuth2ClientCredentialsService, ClientCredentialsRequest, ClientCredentialsTokenResponse } from './service/oauth2-client-credentials.service';
import { OidcAuthService, OidcTokenResponse, OidcUserInfo } from './service/oidc-auth.service';
import { AuthService } from './service/auth.service';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oauth2ClientCredentialsService: OAuth2ClientCredentialsService,
    private readonly oidcAuthService: OidcAuthService,
    private readonly authService: AuthService
  ) {}

  /**
   * Helper method to construct complete Url for the client-side OAuth2 endpoint.
   * @returns The complete Url for the client-side OAuth2 endpoint.
   */
  private getOAuth2Endpoint(): string {
    const relativeOAuth2Url = process.env.OAUTH2_REDIRECT_URL;
    const scheme = process.env.NODE_ENV === 'production' ? 'https:' : 'http:';

    return scheme + relativeOAuth2Url;
  }

  private getDefaultLoginErrorRedirect(): string {
    const frontendOrigin = this.getDefaultFrontendOrigin();
    if (frontendOrigin) {
      return `${frontendOrigin}/?error=authentication_failed`;
    }

    return '/login?error=authentication_failed';
  }

  private getDefaultFrontendOrigin(): string | null {
    if (process.env.FRONTEND_URL) {
      try {
        return new URL(process.env.FRONTEND_URL).origin;
      } catch {
        return null;
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return null;
    }

    try {
      const oAuth2Url = new URL(this.getOAuth2Endpoint());
      const frontendPort = process.env.HTTP_PORT || '4200';

      return `${oAuth2Url.protocol}//${oAuth2Url.hostname}:${frontendPort}`;
    } catch {
      return null;
    }
  }

  private getAllowedRedirectOrigins(oAuth2Url: URL): Set<string> {
    const allowedOrigins = new Set<string>([oAuth2Url.origin]);
    const frontendOrigin = this.getDefaultFrontendOrigin();
    if (frontendOrigin) {
      allowedOrigins.add(frontendOrigin);
    }

    if (process.env.NODE_ENV !== 'production') {
      const frontendPort = process.env.HTTP_PORT || '4200';
      allowedOrigins.add(`http://localhost:${frontendPort}`);
      allowedOrigins.add(`http://127.0.0.1:${frontendPort}`);
    }

    return allowedOrigins;
  }

  private resolveAllowedRedirectUrl(redirectUri?: string): URL | null {
    if (!redirectUri || typeof redirectUri !== 'string') {
      return null;
    }

    const normalizedRedirectUri = redirectUri.trim();
    if (!normalizedRedirectUri || normalizedRedirectUri.startsWith('//') || normalizedRedirectUri.startsWith('/\\')) {
      return null;
    }

    try {
      const oAuth2Url = new URL(this.getOAuth2Endpoint());
      const redirectUrl = new URL(normalizedRedirectUri, oAuth2Url.origin);
      const isHttpUrl = redirectUrl.protocol === 'http:' || redirectUrl.protocol === 'https:';
      const isAllowedOrigin = this.getAllowedRedirectOrigins(oAuth2Url).has(redirectUrl.origin);

      return isHttpUrl && isAllowedOrigin ? redirectUrl : null;
    } catch {
      return null;
    }
  }

  private buildErrorRedirectUrl(redirectUri?: string): string {
    const redirectUrl = this.resolveAllowedRedirectUrl(redirectUri);
    if (!redirectUrl) {
      return this.getDefaultLoginErrorRedirect();
    }

    redirectUrl.searchParams.set('error', 'authentication_failed');
    return redirectUrl.toString();
  }

  /**
   * Exchange client credentials for an access token using OAuth2 Client Credentials Flow
   * @param credentials - Client ID and secret
   * @returns Access token response
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    description: 'Client credentials for OAuth2 Client Credentials Flow',
    schema: {
      type: 'object',
      required: ['client_id', 'client_secret'],
      properties: {
        client_id: {
          type: 'string',
          description: 'The client identifier',
          example: 'my-application'
        },
        client_secret: {
          type: 'string',
          description: 'The client secret',
          example: 'my-secret-key'
        },
        scope: {
          type: 'string',
          description: 'Optional scope for the access token',
          example: 'read write'
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Successfully obtained access token',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          description: 'The access token'
        },
        token_type: {
          type: 'string',
          description: 'The type of token (usually "Bearer")',
          example: 'Bearer'
        },
        expires_in: {
          type: 'number',
          description: 'Token expiration time in seconds',
          example: 3600
        },
        scope: {
          type: 'string',
          description: 'The scope of the access token'
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Invalid request parameters'
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid client credentials'
  })
  async getClientCredentialsToken(
    @Body() credentials: ClientCredentialsRequest
  ): Promise<ClientCredentialsTokenResponse> {
    this.logger.log(`Client credentials token request for client: ${credentials.client_id}`);

    return this.oauth2ClientCredentialsService.getAccessToken(credentials);
  }

  /**
   * Validate an access token against OpenID Connect Provider
   * @param tokenData - Object containing the access token
   * @returns User information from the token
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    description: 'Access token to validate',
    schema: {
      type: 'object',
      required: ['access_token'],
      properties: {
        access_token: {
          type: 'string',
          description: 'The access token to validate'
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Token is valid, returns user information',
    schema: {
      type: 'object',
      description: 'User information from OpenID Connect Provider'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired token'
  })
  async validateToken(
    @Body() tokenData: { access_token: string }
  ): Promise<OidcUserInfo> {
    this.logger.log('Token validation request');

    return this.oauth2ClientCredentialsService.validateAccessToken(tokenData.access_token);
  }

  /**
   * Initiate OpenID Connect Provider login using Authorization Code flow
   * @param res - Express response object for redirecting
   * @param redirectUri - Optional redirect URI after successful authentication
   */
  @Get('login')
  @ApiOperation({
    summary: 'Initiate OpenID Connect Provider login',
    description: 'Redirects user to OpenID Connect Provider login page using Authorization Code flow'
  })
  @ApiQuery({
    name: 'redirect_uri',
    required: false,
    description: 'URL to redirect to after successful authentication'
  })
  async login(
    @Res() res: Response,
      @Query('redirect_uri') redirectUri?: string
  ): Promise<void> {
    this.logger.log('Initiating OpenID Connect Provider login');

    // Encode redirect URI in state parameter to avoid duplicate redirect_uri parameters
    const baseState = Math.random().toString(36).substring(2, 15);
    const allowedRedirectUrl = this.resolveAllowedRedirectUrl(redirectUri);
    const state = allowedRedirectUrl ? `${baseState}:${encodeURIComponent(allowedRedirectUrl.toString())}` : baseState;
    const oAuth2Endpoint = this.getOAuth2Endpoint();

    const { codeVerifier, codeChallenge } = this.oidcAuthService.generatePkcePair();
    const stored = await this.oidcAuthService.storePkceVerifier(state, codeVerifier);
    if (!stored) {
      this.logger.error('Failed to store PKCE verifier');
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Failed to initiate login' });
      return;
    }

    // Get authorization URL with proper OAuth redirect_uri (callback)
    const authUrl = this.oidcAuthService.getAuthorizationUrl(state, oAuth2Endpoint, codeChallenge);
    res.redirect(authUrl);
  }

  /**
   * Handle OpenID Connect Provider callback after authentication
   * @param code - Authorization code from OpenID Connect Provider
   * @param state - State parameter for security
   * @param res - Express response object
   */
  @Get('callback')
  @ApiOperation({
    summary: 'Handle OpenID Connect Provider authentication callback',
    description: 'Processes the authorization code and creates user session'
  })
  @ApiQuery({ name: 'code', description: 'Authorization code from OpenID Connect Provider' })
  @ApiQuery({ name: 'state', description: 'State parameter for security' })
  async callback(
    @Query('code') code: string,
      @Query('state') state: string,
      @Res() res: Response
  ): Promise<void> {
    this.logger.log('Processing OpenID Connect Provider callback');

    try {
      if (!code) {
        this.logger.error('Authorization code is required');
        let errorRedirectUri;
        if (state && typeof state === 'string' && state.includes(':')) {
          const [, encodedRedirectUri] = state.split(':', 2);
          try {
            errorRedirectUri = decodeURIComponent(encodedRedirectUri);
          } catch (error) {
            this.logger.warn('Invalid encoded redirect URI in state');
          }
        }

        res.redirect(this.buildErrorRedirectUrl(errorRedirectUri));
        return;
      }

      let finalRedirectUri;
      if (state && typeof state === 'string' && state.includes(':')) {
        const [, encodedRedirectUri] = state.split(':', 2);
        try {
          finalRedirectUri = decodeURIComponent(encodedRedirectUri);
        } catch (error) {
          this.logger.warn('Invalid encoded redirect URI in state');
        }
      }

      if (!state) {
        this.logger.error('State parameter is required for PKCE flow');
        res.redirect(this.buildErrorRedirectUrl(finalRedirectUri));
        return;
      }

      const oAuth2Endpoint = this.getOAuth2Endpoint();
      const codeVerifier = await this.oidcAuthService.consumePkceVerifier(state);
      if (!codeVerifier) {
        this.logger.error('PKCE verifier missing or expired');
        res.redirect(this.buildErrorRedirectUrl(finalRedirectUri));
        return;
      }

      const tokenResponse = await this.oidcAuthService.exchangeCodeForToken(code, oAuth2Endpoint, codeVerifier);

      const userInfo = await this.oidcAuthService.getUserInfo(tokenResponse.access_token);

      const userData: CreateUserDto = {
        identity: userInfo.sub,
        username: userInfo.preferred_username,
        firstName: userInfo.given_name || '',
        lastName: userInfo.family_name || '',
        email: userInfo.email || '',
        issuer: 'coding-box',
        isAdmin: userInfo.realm_access?.roles?.includes('admin') || false
      };

      // Store user in database but use OpenID Connect Provider access token directly
      await this.authService.storeOidcProviderUser(userData);

      const redirectUrl = this.resolveAllowedRedirectUrl(finalRedirectUri);
      if (!redirectUrl) {
        this.logger.warn('Refusing to return OIDC tokens for a disallowed redirect URI');
        res.redirect(this.getDefaultLoginErrorRedirect());
        return;
      }

      const exchangeCode = await this.oidcAuthService.storeTokenExchange(tokenResponse);
      if (!exchangeCode) {
        this.logger.error('Failed to store token exchange data');
        res.redirect(this.buildErrorRedirectUrl(finalRedirectUri));
        return;
      }

      redirectUrl.searchParams.set('auth_code', exchangeCode);
      res.redirect(redirectUrl.toString());
    } catch (error) {
      this.logger.error('OpenID Connect Provider callback failed:', error);
      // Decode redirect URI from state for error handling too
      let errorRedirectUri;
      if (state && typeof state === 'string' && state.includes(':')) {
        const [, encodedRedirectUri] = state.split(':', 2);
        try {
          errorRedirectUri = decodeURIComponent(encodedRedirectUri);
        } catch (decodeError) {
          this.logger.warn('Invalid encoded redirect URI in state during error handling');
        }
      }

      res.redirect(this.buildErrorRedirectUrl(errorRedirectUri));
    }
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a short-lived login code',
    description: 'Exchanges the one-time login code from the callback redirect for OIDC tokens'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Short-lived one-time login code from the frontend redirect'
        }
      },
      required: ['code']
    }
  })
  @ApiOkResponse({
    description: 'Successfully exchanged the one-time login code'
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired login code'
  })
  async exchangeLoginCode(
    @Body() exchangeData: { code: string }
  ): Promise<OidcTokenResponse> {
    const tokenResponse = await this.oidcAuthService.consumeTokenExchange(exchangeData?.code);
    if (!tokenResponse) {
      throw new UnauthorizedException('Invalid or expired login code');
    }

    return tokenResponse;
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout from OpenID Connect Provider SSO',
    description: 'Performs POST logout to OpenID Connect Provider to terminate SSO session using refresh token'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refresh_token: {
          type: 'string',
          description: 'Refresh token to invalidate the SSO session'
        }
      },
      required: ['refresh_token']
    }
  })
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() logoutData: { refresh_token: string },
      @Res() res: Response
  ): Promise<void> {
    this.logger.log('Processing OpenID Connect Provider SSO logout');

    try {
      if (!logoutData.refresh_token) {
        this.logger.error('Refresh token is required for logout');
        res.status(HttpStatus.UNAUTHORIZED).json({
          error: 'Refresh token is required for logout',
          success: false
        });
        return;
      }

      await this.oidcAuthService.logoutWithRefreshToken(logoutData.refresh_token);

      this.logger.log('Successfully logged out from OpenID Connect Provider SSO session');
      res.json({
        message: 'Successfully logged out from OpenID Connect Provider SSO session',
        success: true
      });
    } catch (error) {
      this.logger.error('Logout failed:', error);
      if (error instanceof UnauthorizedException) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          error: error.message,
          success: false
        });
      } else {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          error: 'Logout failed',
          success: false
        });
      }
    }
  }

  /**
   * Redirect to OpenID Connect Provider profile management page
   * @param res - Express response object for redirecting
   * @param redirectUri - Optional redirect URI to return to after profile management
   */
  @Get('profile')
  @ApiOperation({
    summary: 'Redirect to profile management',
    description: 'Redirects user to OpenID Connect Provider account management page for profile editing'
  })
  @ApiQuery({
    name: 'redirect_uri',
    required: false,
    description: 'URL to redirect to after profile management'
  })
  async redirectToProfile(
    @Res() res: Response,
      @Query('redirect_uri') redirectUri?: string
  ): Promise<void> {
    this.logger.log('Redirecting to OpenID Connect Provider profile management');

    try {
      const profileUrl = this.oidcAuthService.getProfileUrl(redirectUri);
      res.redirect(profileUrl);
    } catch (error) {
      this.logger.error('Profile redirect failed:', error);
      res.status(500).json({ error: 'Failed to redirect to profile management' });
    }
  }
}
