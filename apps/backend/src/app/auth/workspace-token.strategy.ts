import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WORKSPACE_TOKEN_AUDIENCE,
  WORKSPACE_TOKEN_ISSUER,
  WORKSPACE_TOKEN_STRATEGY,
  WORKSPACE_TOKEN_USE
} from './workspace-token.constants';

interface WorkspaceTokenPayload {
  token_use?: string;
  userId?: number | string;
  username?: string;
  workspace?: number | string;
}

@Injectable()
export class WorkspaceTokenStrategy extends PassportStrategy(Strategy, WORKSPACE_TOKEN_STRATEGY) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
      issuer: WORKSPACE_TOKEN_ISSUER,
      audience: WORKSPACE_TOKEN_AUDIENCE,
      algorithms: ['HS256']
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async validate(payload: WorkspaceTokenPayload) {
    if (payload.token_use !== WORKSPACE_TOKEN_USE) {
      throw new UnauthorizedException('Invalid workspace token type');
    }

    const userId = Number(payload.userId);
    const workspace = Number(payload.workspace);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(workspace) || workspace <= 0) {
      throw new UnauthorizedException('Invalid workspace token payload');
    }

    return {
      userId,
      id: userId,
      name: payload.username,
      workspace,
      tokenUse: WORKSPACE_TOKEN_USE,
      isWorkspaceToken: true
    };
  }
}
