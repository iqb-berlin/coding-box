import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { UsersService } from '../database/services/users';

interface OidcJwtPayload {
  sub?: string;
  iss?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  aud?: string | string[];
  azp?: string;
  realm_access?: { roles: string[] };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly oAuth2ClientId?: string;

  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService
  ) {
    const oidcIssuer = configService.get('OIDC_ISSUER');
    const oidcJwksUri = configService.get('OIDC_JWKS_URI');
    const oAuth2ClientId = configService.get<string>('OAUTH2_CLIENT_ID');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${oidcJwksUri}`
      }),
      issuer: `${oidcIssuer}`,
      algorithms: ['RS256']
    });

    this.oAuth2ClientId = oAuth2ClientId;
  }

  async validate(payload: OidcJwtPayload) {
    if (!this.isTokenForConfiguredClient(payload)) {
      throw new UnauthorizedException('JWT client does not match configured OAuth2 client');
    }

    const identity = this.getIdentity(payload);
    const username = this.getUsername(payload, identity);
    const isAdmin = payload.realm_access?.roles?.includes('admin') || false;
    const userId = await this.usersService.createOidcProviderUser({
      identity,
      issuer: payload.iss || '',
      username,
      email: payload.email,
      firstName: payload.given_name,
      lastName: payload.family_name,
      isAdmin
    });

    return {
      userId,
      id: userId,
      name: username,
      firstName: payload.given_name,
      lastName: payload.family_name,
      email: payload.email,
      isAdmin,
      sub: identity,
      identity,
      issuer: payload.iss
    };
  }

  private isTokenForConfiguredClient(payload: OidcJwtPayload): boolean {
    if (!this.oAuth2ClientId) {
      return false;
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    return payload.azp === this.oAuth2ClientId || audiences.includes(this.oAuth2ClientId);
  }

  private getIdentity(payload: OidcJwtPayload): string {
    if (!payload.sub || !payload.sub.trim()) {
      throw new UnauthorizedException('JWT subject is missing');
    }

    return payload.sub.trim();
  }

  private getUsername(payload: OidcJwtPayload, identity: string): string {
    return payload.preferred_username?.trim() || identity;
  }
}
