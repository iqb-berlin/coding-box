import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { AuthErrorCode } from '../../../../../../api-dto/auth-error-dto';
import { OidcUserInfo } from './oidc-auth.service';
import { AuthFailureException } from '../auth-failure.exception';
import { isHttpEndpoint, logAuthProviderFailure } from '../auth-provider-errors';

export interface ClientCredentialsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export type ClientCredentialsRequest = RequestBody<'ClientCredentialsRequest'>;

@Injectable()
export class OAuth2ClientCredentialsService {
  private readonly logger = new Logger(OAuth2ClientCredentialsService.name);
  private readonly providerTimeoutMs = 10_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {}

  async getAccessToken(
    clientCredentials: ClientCredentialsRequest,
    requestId?: string
  ): Promise<ClientCredentialsTokenResponse> {
    const endpoint = this.getEndpoint('OIDC_TOKEN_ENDPOINT');
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientCredentials.client_id,
      client_secret: clientCredentials.client_secret
    });
    if (clientCredentials.scope) params.append('scope', clientCredentials.scope);

    try {
      const response = await firstValueFrom(
        this.httpService.post<ClientCredentialsTokenResponse>(endpoint, params.toString(), {
          timeout: this.providerTimeoutMs,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      );
      if (typeof response.data?.access_token !== 'string' || !response.data.access_token.trim()) {
        throw new AuthFailureException('provider-unavailable');
      }
      return response.data;
    } catch (error: unknown) {
      throw this.providerFailure(error, endpoint, 'oauth2-client-credentials-failed', requestId);
    }
  }

  async validateAccessToken(accessToken: string, requestId?: string): Promise<OidcUserInfo> {
    const endpoint = this.getEndpoint('OIDC_USERINFO_ENDPOINT');
    try {
      const response = await firstValueFrom(
        this.httpService.get<OidcUserInfo>(endpoint, {
          timeout: this.providerTimeoutMs,
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      );
      if (typeof response.data?.sub !== 'string' || !response.data.sub.trim()) {
        throw new AuthFailureException('provider-unavailable');
      }
      return response.data;
    } catch (error: unknown) {
      throw this.providerFailure(error, endpoint, 'oauth2-token-validation-failed', requestId);
    }
  }

  private getEndpoint(key: string): string {
    const endpoint = this.configService.get<string>(key);
    if (!isHttpEndpoint(endpoint)) throw new AuthFailureException('configuration-error');
    return endpoint;
  }

  private providerFailure(error: unknown, endpoint: string, event: string, requestId?: string): AuthFailureException {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    let code: AuthErrorCode = error instanceof AuthFailureException ? error.code : 'provider-unavailable';
    if (status !== undefined && [400, 401, 403].includes(status)) code = 'session-invalid';
    else if (status === 404) code = 'configuration-error';
    logAuthProviderFailure(this.logger, event, endpoint, code, status ?? null, requestId);
    return new AuthFailureException(code);
  }
}
