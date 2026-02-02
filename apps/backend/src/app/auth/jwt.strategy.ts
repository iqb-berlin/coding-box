import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const oidcProviderUrl = configService.get('OIDC_PROVIDER_URL');
    const keycloakRealm = configService.get('KEYCLOAK_REALM');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${oidcProviderUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`
      }),
      issuer: `${oidcProviderUrl}/realms/${keycloakRealm}`,
      algorithms: ['RS256']
    });

    this.expectedIssuer = expectedIssuer;
    this.keycloakClientId = keycloakClientId;
    this.allowLegacyWorkspaceReplayTokens = resolveAllowLegacyWorkspaceReplayTokens(configService);
  }

  async validate(
    payload: { sub: string, preferred_username: string, given_name?: string, family_name?: string, email?: string, realm_access?: { roles: string[] } }
  ) {
    if (this.isKeycloakPayload(payload)) {
      return this.validateKeycloakPayload(payload);
    }

    if (!this.isWorkspaceTokenPayload(payload)) {
      throw new UnauthorizedException('JWT is not a valid Keycloak or workspace token');
    }

    return {
      userId: payload.sub,
      id: payload.sub,
      name: payload.preferred_username,
      firstName: payload.given_name,
      lastName: payload.family_name,
      email: payload.email,
      isAdmin: payload.realm_access?.roles?.includes('admin') || false,
      sub: payload.sub
    };
  }

  private async validateKeycloakPayload(payload: JwtPayload) {
    if (this.expectedIssuer && payload.iss !== this.expectedIssuer) {
      throw new UnauthorizedException('JWT issuer is not trusted');
    }

    if (this.keycloakClientId && !this.hasExpectedAudience(payload)) {
      throw new UnauthorizedException('JWT audience is not trusted');
    }

    const identity = this.getKeycloakIdentity(payload);
    const username = this.getKeycloakUsername(payload);
    const roles = this.getKeycloakRoles(payload);
    const userId = await this.usersService.syncKeycloakUser({
      identity,
      issuer: payload.iss || '',
      username,
      isAdmin: roles.some(role => ADMIN_ROLES.includes(role.toLowerCase())),
      email: payload.email,
      firstName: payload.given_name,
      lastName: payload.family_name
    });

    return {
      userId,
      id: userId,
      name: username,
      workspace: '',
      identity,
      issuer: payload.iss,
      roles
    };
  }

  private isKeycloakPayload(payload: JwtPayload): boolean {
    return typeof payload.iss === 'string' &&
      typeof payload.sub === 'string' &&
      (!!payload.preferred_username || !!payload.azp || !!payload.aud);
  }

  private isWorkspaceTokenPayload(payload: JwtPayload): boolean {
    return payload.userId !== undefined &&
      typeof payload.username === 'string' &&
      payload.workspace !== undefined &&
      payload.workspace !== null &&
      payload.workspace !== '';
  }

  private getWorkspaceTokenScopes(scopes: unknown): WorkspaceTokenScope[] {
    if (scopes === undefined) {
      return this.allowLegacyWorkspaceReplayTokens ?
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ] :
        [];
    }

    if (!Array.isArray(scopes)) {
      return [];
    }

    return scopes.filter((scope): scope is WorkspaceTokenScope => typeof scope === 'string');
  }

  private getIdentity(subject?: JwtSubject): string | undefined {
    if (subject && typeof subject === 'object' && typeof subject.identity === 'string') {
      return subject.identity;
    }

    return undefined;
  }

  private getKeycloakIdentity(payload: JwtPayload): string {
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new UnauthorizedException('JWT subject is missing');
    }

    return payload.sub;
  }

  private getKeycloakUsername(payload: JwtPayload): string {
    const username = payload.preferred_username || this.getKeycloakIdentity(payload);
    return username.trim();
  }

  private hasExpectedAudience(payload: JwtPayload): boolean {
    if (!this.keycloakClientId) {
      return true;
    }

    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return payload.azp === this.keycloakClientId ||
      audience.includes(this.keycloakClientId);
  }

  private getKeycloakRoles(payload: JwtPayload): string[] {
    const realmRoles = payload.realm_access?.roles || [];
    const clientRoles = this.keycloakClientId ?
      (payload.resource_access?.[this.keycloakClientId]?.roles || []) :
      [];

    return Array.from(new Set([...realmRoles, ...clientRoles]
      .filter(role => typeof role === 'string')
      .map(role => role.trim())
      .filter(Boolean)));
  }
}

function decodeJwtPart<T>(token: string, partIndex: number): T {
  const part = token.split('.')[partIndex];
  if (!part) {
    throw new UnauthorizedException('Malformed JWT');
  }

  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

function resolveExpectedIssuer(configService: ConfigService): string | undefined {
  const configuredIssuer = configService.get<string>('OIDC_ISSUER')?.trim();
  if (configuredIssuer) {
    return configuredIssuer.replace(/\/+$/, '');
  }

  const keycloakUrl = configService.get<string>('KEYCLOAK_URL')?.trim();
  const realm = configService.get<string>('KEYCLOAK_REALM')?.trim();
  if (!keycloakUrl || !realm) {
    return undefined;
  }

  return `${keycloakUrl.replace(/\/+$/, '')}/realms/${realm}`;
}

function resolveAllowLegacyWorkspaceReplayTokens(configService: ConfigService): boolean {
  const configuredValue = configService.get<string>(ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS_ENV);
  if (configuredValue === undefined || configuredValue === null || configuredValue.trim() === '') {
    return true;
  }

  return !['false', '0', 'no', 'off'].includes(configuredValue.trim().toLowerCase());
}
