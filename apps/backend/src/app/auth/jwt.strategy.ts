import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakJwksService } from './keycloak-jwks.service';
import { UsersService } from '../database/services/users';
import {
  WORKSPACE_API_TOKEN_TYPE,
  WorkspaceTokenScope
} from './workspace-token';

type JwtSubject = string | number | {
  identity?: string;
};

type JwtPayload = {
  userId?: string | number;
  sub?: JwtSubject;
  username?: string;
  workspace?: string | number;
  tokenType?: string;
  scopes?: unknown;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  preferred_username?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, {
    roles?: string[];
  }>;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
};

const ADMIN_ROLES = ['admin', 'system-admin', 'sys-admin', 'administrator'];

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly expectedIssuer?: string;
  private readonly keycloakClientId?: string;

  constructor(
    configService: ConfigService,
    keycloakJwksService: KeycloakJwksService,
    private readonly usersService: UsersService
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    const expectedIssuer = resolveExpectedIssuer(configService);
    const keycloakClientId = configService.get<string>('KEYCLOAK_CLIENT_ID')?.trim();

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256', 'HS256'],
      secretOrKeyProvider: async (_request, token, done) => {
        try {
          const header = decodeJwtPart<JwtHeader>(token, 0);
          if (header.alg === 'RS256') {
            done(null, await keycloakJwksService.getSigningKey(header.kid));
            return;
          }

          if (header.alg === 'HS256' && jwtSecret) {
            done(null, jwtSecret);
            return;
          }

          done(new UnauthorizedException('Unsupported JWT signing algorithm'));
        } catch (error) {
          done(error);
        }
      }
    });

    this.expectedIssuer = expectedIssuer;
    this.keycloakClientId = keycloakClientId;
  }

  async validate(
    payload: JwtPayload
  ) {
    if (this.isKeycloakPayload(payload)) {
      return this.validateKeycloakPayload(payload);
    }

    if (!this.isWorkspaceTokenPayload(payload)) {
      throw new UnauthorizedException('JWT is not a valid Keycloak or workspace token');
    }

    return {
      userId: payload.userId,
      id: payload.userId,
      name: payload.username,
      workspace: payload.workspace || '',
      identity: this.getIdentity(payload.sub),
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: this.getWorkspaceTokenScopes(payload.scopes)
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
