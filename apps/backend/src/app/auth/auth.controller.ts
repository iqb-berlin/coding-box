import {
  Controller, Post, Body, Logger, HttpCode, HttpStatus, Get, Query, Res,
  UnauthorizedException
} from '@nestjs/common';
import {
  ApiTags, ApiOkResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiBody, ApiQuery, ApiOperation
} from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { OAuth2ClientCredentialsService, ClientCredentialsRequest, ClientCredentialsTokenResponse } from './service/oauth2-client-credentials.service';
import { KeycloakAuthService, KeycloakUserInfo } from './service/keycloak-auth.service';
import { AuthService } from './service/auth.service';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oauth2ClientCredentialsService: OAuth2ClientCredentialsService,
    private readonly keycloakAuthService: KeycloakAuthService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Helper method to construct complete callback URI with proper host
   */
  private getCallbackUri(): string {
    const backendUrl = process.env.BACKEND_URL;

    if (backendUrl && backendUrl.startsWith('http')) {
      return `${backendUrl}api/auth/callback`;
    }
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = process.env.SERVER_NAME || 'localhost';
    const port = process.env.API_PORT || '3333';
    const basePath = backendUrl || '';
    const apiHost = process.env.API_HOST;
    const isDockerEnv = apiHost && apiHost !== 'localhost';

    if (host === 'localhost' && !isDockerEnv) {
      return `${protocol}://${host}:${port}/${basePath}auth/callback`.replace(/\/+/g, '/').replace(':/', '://');
    }

    if (isDockerEnv && host === 'localhost') {
      // For Docker dev environment, use localhost with port for external access
      return `${protocol}://${host}:${port}/${basePath}api/auth/callback`.replace(/\/+/g, '/').replace(':/', '://');
    }

    // For Docker/production environments, nginx handles /api/ routing, so exclude it from callback URL
    return `${protocol}://${host}/auth/callback`.replace(/\/+/g, '/').replace(':/', '://');
  }

  private isAllowedRedirect(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }

    try {
      if (url.startsWith('/')) {
        return true;
      }

      if (url.startsWith('http')) {
        const redirectCallbackUri = this.getCallbackUri();
        const callbackUrl = new URL(redirectCallbackUri);
        const allowedOrigin = callbackUrl.origin;

        const redirectUrl = new URL(url);

        // Allow redirects to the same origin as the callback URI
        if (redirectUrl.origin === allowedOrigin) {
          return true;
        }

        // Validate against the given KEYCLOAK_URL and prevent redirects to it for security
        const keycloakUrl = this.configService.get<string>('KEYCLOAK_URL');
        if (keycloakUrl) {
          try {
            const keycloakOrigin = new URL(keycloakUrl).origin;
            if (redirectUrl.origin === keycloakOrigin) {
              return false;
            }
          } catch {
            // Invalid KEYCLOAK_URL, ignore
          }
        }

        // Allow other external URLs
        return true;
      }

      return false;
    } catch {
      return false;
    }
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
   * Validate an access token against Keycloak
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
      description: 'User information from Keycloak'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired token'
  })
  async validateToken(
    @Body() tokenData: { access_token: string }
  ): Promise<KeycloakUserInfo> {
    this.logger.log('Token validation request');

    return this.oauth2ClientCredentialsService.validateAccessToken(tokenData.access_token);
  }

  /**
   * Initiate Keycloak login using Authorization Code flow
   * @param res - Express response object for redirecting
   * @param redirectUri - Optional redirect URI after successful authentication
   */
  @Get('login')
  @ApiOperation({
    summary: 'Initiate Keycloak login',
    description: 'Redirects user to Keycloak login page using Authorization Code flow'
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
    this.logger.log('Initiating Keycloak login');

    // Encode redirect URI in state parameter to avoid duplicate redirect_uri parameters
    const baseState = Math.random().toString(36).substring(2, 15);
    const state = redirectUri ? `${baseState}:${encodeURIComponent(redirectUri)}` : baseState;
    const loginCallbackUri = this.getCallbackUri();

    // Get authorization URL with proper OAuth redirect_uri (callback)
    const authUrl = this.keycloakAuthService.getAuthorizationUrl(state, loginCallbackUri);
    res.redirect(authUrl);
  }

  /**
   * Handle Keycloak callback after authentication
   * @param code - Authorization code from Keycloak
   * @param state - State parameter for security
   * @param res - Express response object
   */
  @Get('callback')
  @ApiOperation({
    summary: 'Handle Keycloak authentication callback',
    description: 'Processes the authorization code and creates user session'
  })
  @ApiQuery({ name: 'code', description: 'Authorization code from Keycloak' })
  @ApiQuery({ name: 'state', description: 'State parameter for security' })
  async callback(
    @Query('code') code: string,
      @Query('state') state: string,
      @Res() res: Response
  ): Promise<void> {
    this.logger.log('Processing Keycloak callback');

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

        const errorUrl = (errorRedirectUri && this.isAllowedRedirect(errorRedirectUri)) ?
          `${errorRedirectUri}?error=authentication_failed` :
          '/login?error=authentication_failed';
        res.redirect(errorUrl);
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

      const callbackUri = this.getCallbackUri();
      const tokenResponse = await this.keycloakAuthService.exchangeCodeForToken(code, callbackUri);

      const userInfo = await this.keycloakAuthService.getUserInfo(tokenResponse.access_token);

      const userData: CreateUserDto = {
        identity: userInfo.sub,
        username: userInfo.preferred_username,
        firstName: userInfo.given_name || '',
        lastName: userInfo.family_name || '',
        email: userInfo.email || '',
        issuer: 'keycloak',
        isAdmin: userInfo.realm_access?.roles?.includes('admin') || false
      };

      // Store user in database but use Keycloak access token directly
      await this.authService.storeKeycloakUser(userData);

      // Return Keycloak tokens directly instead of creating internal ones
      if (finalRedirectUri && this.isAllowedRedirect(finalRedirectUri)) {
        let redirectUrl: URL;
        if (finalRedirectUri.startsWith('http')) {
          redirectUrl = new URL(finalRedirectUri);
        } else {
          // Relative URL, construct absolute
          const callbackUrl = new URL(callbackUri);
          redirectUrl = new URL(finalRedirectUri, callbackUrl.origin);
        }
        redirectUrl.searchParams.set('token', tokenResponse.access_token);
        if (tokenResponse.id_token) {
          redirectUrl.searchParams.set('id_token', tokenResponse.id_token);
        }
        if (tokenResponse.refresh_token) {
          redirectUrl.searchParams.set('refresh_token', tokenResponse.refresh_token);
        }
        res.redirect(redirectUrl.toString());
      } else {
        res.json({
          access_token: tokenResponse.access_token,
          token_type: tokenResponse.token_type,
          expires_in: tokenResponse.expires_in,
          id_token: tokenResponse.id_token,
          refresh_token: tokenResponse.refresh_token,
          user: userData
        });
      }
    } catch (error) {
      this.logger.error('Keycloak callback failed:', error);
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

      const errorUrl = (errorRedirectUri && this.isAllowedRedirect(errorRedirectUri)) ?
        `${errorRedirectUri}?error=authentication_failed` :
        '/login?error=authentication_failed';
      res.redirect(errorUrl);
    }
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout from Keycloak SSO',
    description: 'Performs POST logout to Keycloak to terminate SSO session using refresh token'
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
    this.logger.log('Processing Keycloak SSO logout');

    try {
      if (!logoutData.refresh_token) {
        this.logger.error('Refresh token is required for logout');
        res.status(HttpStatus.UNAUTHORIZED).json({
          error: 'Refresh token is required for logout',
          success: false
        });
        return;
      }

      await this.keycloakAuthService.logoutWithRefreshToken(logoutData.refresh_token);

      this.logger.log('Successfully logged out from Keycloak SSO session');
      res.json({
        message: 'Successfully logged out from Keycloak SSO session',
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
   * Redirect to Keycloak profile management page
   * @param res - Express response object for redirecting
   * @param redirectUri - Optional redirect URI to return to after profile management
   */
  @Get('profile')
  @ApiOperation({
    summary: 'Redirect to profile management',
    description: 'Redirects user to Keycloak account management page for profile editing'
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
    this.logger.log('Redirecting to Keycloak profile management');

    try {
      const profileUrl = this.keycloakAuthService.getProfileUrl(redirectUri);
      res.redirect(profileUrl);
    } catch (error) {
      this.logger.error('Profile redirect failed:', error);
      res.status(500).json({ error: 'Failed to redirect to profile management' });
    }
  }
}
