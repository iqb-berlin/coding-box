import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type JwtSubject = string | number | {
  identity?: string;
};

type JwtPayload = {
  userId: string;
  sub?: JwtSubject;
  username: string;
  workspace?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET')
    });
  }

  async validate(
    payload: JwtPayload
  ) {
    return {
      userId: payload.userId,
      id: payload.userId,
      name: payload.username,
      workspace: payload.workspace || '',
      identity: this.getIdentity(payload.sub)
    };
  }

  // eslint-disable-next-line class-methods-use-this
  private getIdentity(subject?: JwtSubject): string | undefined {
    if (subject && typeof subject === 'object' && typeof subject.identity === 'string') {
      return subject.identity;
    }

    return undefined;
  }
}
