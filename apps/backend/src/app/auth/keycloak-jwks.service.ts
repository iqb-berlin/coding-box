import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createPublicKey } from 'crypto';

type KeycloakJwk = {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [claim: string]: unknown;
};

interface JwksResponse {
  keys: KeycloakJwk[];
}

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class KeycloakJwksService {
  private cachedKeys = new Map<string, string>();
  private cacheExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  async getSigningKey(kid?: string): Promise<string> {
    if (this.shouldRefresh(kid)) {
      await this.refreshKeys();
    }

    if (kid) {
      const key = this.cachedKeys.get(kid);
      if (key) {
        return key;
      }

      await this.refreshKeys();
      const refreshedKey = this.cachedKeys.get(kid);
      if (refreshedKey) {
        return refreshedKey;
      }
    }

    if (!kid && this.cachedKeys.size === 1) {
      return Array.from(this.cachedKeys.values())[0];
    }

    throw new UnauthorizedException('Unable to resolve Keycloak signing key');
  }

  private shouldRefresh(kid?: string): boolean {
    return Date.now() >= this.cacheExpiresAt ||
      this.cachedKeys.size === 0 ||
      (!!kid && !this.cachedKeys.has(kid));
  }

  private async refreshKeys(): Promise<void> {
    const response = await axios.get<JwksResponse>(this.getJwksUri(), { timeout: 5000 });
    const keys = response.data?.keys || [];
    const nextKeys = new Map<string, string>();

    keys
      .filter(key => key.kty === 'RSA')
      .filter(key => !key.use || key.use === 'sig')
      .forEach(key => {
        if (key.kid) {
          nextKeys.set(key.kid, this.toPem(key));
        }
      });

    if (nextKeys.size === 0) {
      throw new UnauthorizedException('Keycloak JWKS did not contain usable RSA signing keys');
    }

    this.cachedKeys = nextKeys;
    this.cacheExpiresAt = Date.now() + JWKS_CACHE_TTL_MS;
  }

  private toPem(jwk: KeycloakJwk): string {
    const publicKeyInput = {
      key: jwk,
      format: 'jwk'
    } as never;

    return createPublicKey(publicKeyInput).export({
      type: 'spki',
      format: 'pem'
    }).toString();
  }

  private getJwksUri(): string {
    const configuredJwksUri = this.configService.get<string>('OIDC_JWKS_URI')?.trim();
    if (configuredJwksUri) {
      return configuredJwksUri;
    }

    const keycloakUrl = this.configService.get<string>('KEYCLOAK_URL')?.trim() ||
      this.configService.get<string>('OIDC_PROVIDER_URL')?.trim();
    const realm = this.configService.get<string>('KEYCLOAK_REALM')?.trim();

    if (!keycloakUrl || !realm) {
      throw new UnauthorizedException('Keycloak JWKS configuration is missing');
    }

    return `${keycloakUrl.replace(/\/+$/, '')}/realms/${realm}/protocol/openid-connect/certs`;
  }
}
