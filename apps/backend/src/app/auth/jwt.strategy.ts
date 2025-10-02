import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const keycloakUrl = configService.get('KEYCLOAK_URL');
    const keycloakRealm = configService.get('KEYCLOAK_REALM');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${keycloakUrl}realms/${keycloakRealm}/protocol/openid-connect/certs`
      }),
      issuer: `${keycloakUrl}realms/${keycloakRealm}`,
      algorithms: ['RS256']
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async validate(
    payload: { sub: string, preferred_username: string, given_name?: string, family_name?: string, email?: string, realm_access?: { roles: string[] } }
  ) {
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
}
