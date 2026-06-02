import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';

interface OidcJwtPayload {
  sub: string;
  preferred_username: string;
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

  constructor(configService: ConfigService) {
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

  private isTokenForConfiguredClient(payload: OidcJwtPayload): boolean {
    if (!this.oAuth2ClientId) {
      return false;
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    return payload.azp === this.oAuth2ClientId || audiences.includes(this.oAuth2ClientId);
  }
}
