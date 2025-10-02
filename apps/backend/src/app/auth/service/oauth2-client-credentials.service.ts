import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { KeycloakUserInfo } from './keycloak-auth.service';

export interface ClientCredentialsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface ClientCredentialsRequest {
  client_id: string;
  client_secret: string;
  scope?: string;
}

@Injectable()
export class OAuth2ClientCredentialsService {
  private readonly logger = new Logger(OAuth2ClientCredentialsService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Exchange client credentials for an access token using OAuth2 Client Credentials Flow
   * @param clientCredentials - The client ID and secret
   * @returns Promise<ClientCredentialsTokenResponse>
   */
  async getAccessToken(clientCredentials: ClientCredentialsRequest): Promise<ClientCredentialsTokenResponse> {
    const keycloakUrl = this.configService.get<string>('KEYCLOAK_URL');
    const keycloakRealm = this.configService.get<string>('KEYCLOAK_REALM');

    if (!keycloakUrl || !keycloakRealm) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const tokenEndpoint = `${keycloakUrl}realms/${keycloakRealm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientCredentials.client_id);
    params.append('client_secret', clientCredentials.client_secret);

    if (clientCredentials.scope) {
      params.append('scope', clientCredentials.scope);
    }

    try {
      this.logger.log(`Requesting access token for client: ${clientCredentials.client_id}`);

      const response = await firstValueFrom(
        this.httpService.post(tokenEndpoint, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log(`Successfully obtained access token for client: ${clientCredentials.client_id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to obtain access token for client ${clientCredentials.client_id}:`, error.response?.data || error.message);
      throw new UnauthorizedException('Failed to authenticate with client credentials');
    }
  }

  /**
   * Validate an access token against Keycloak's userinfo endpoint
   * @param accessToken - The access token to validate
   * @returns Promise<KeycloakUserInfo> - User info from Keycloak
   */
  async validateAccessToken(accessToken: string): Promise<KeycloakUserInfo> {
    const keycloakUrl = this.configService.get<string>('KEYCLOAK_URL');
    const keycloakRealm = this.configService.get<string>('KEYCLOAK_REALM');

    if (!keycloakUrl || !keycloakRealm) {
      throw new UnauthorizedException('Keycloak configuration is missing');
    }

    const userinfoEndpoint = `${keycloakUrl}realms/${keycloakRealm}/protocol/openid-connect/userinfo`;

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
      this.logger.error('Failed to validate access token:', error.response?.data || error.message);
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
