import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET')
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async validate(
    payload: { userId:string, sub:string, username: string, workspaces: string[] }
  ) {
    return { id: payload.userId, name: payload.username, workspaces: payload.workspaces };
  }
}
