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
import {
  ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS_ENV,
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ
} from './workspace-token';

interface WorkspaceTokenPayload {
  token_use?: string;
  tokenType?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  userId?: number | string;
  username?: string;
  workspace?: number | string;
  scopes?: unknown;
}

@Injectable()
export class WorkspaceTokenStrategy extends PassportStrategy(Strategy, WORKSPACE_TOKEN_STRATEGY) {
  private readonly allowLegacyWorkspaceReplayTokens: boolean;

  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? '',
      algorithms: ['HS256']
    });

    const configuredLegacyMode = configService.get<string | boolean>(ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS_ENV);
    this.allowLegacyWorkspaceReplayTokens = !['false', '0', 'no', 'off']
      .includes(String(configuredLegacyMode ?? '').trim().toLowerCase());
  }

  async validate(payload: WorkspaceTokenPayload) {
    // Signature, algorithm and expiration have already been checked by passport-jwt.
    // Modern claims stay mandatory unless this is the explicitly allowed old format.
    const isModernToken = payload.token_use === WORKSPACE_TOKEN_USE &&
      payload.iss === WORKSPACE_TOKEN_ISSUER &&
      (payload.aud === WORKSPACE_TOKEN_AUDIENCE ||
        (Array.isArray(payload.aud) && payload.aud.includes(WORKSPACE_TOKEN_AUDIENCE)));
    const isLegacyToken = this.allowLegacyWorkspaceReplayTokens &&
      payload.token_use === undefined && payload.iss === undefined && payload.aud === undefined &&
      typeof payload.exp === 'number' && typeof payload.username === 'string' &&
      (payload.tokenType === undefined || payload.tokenType === WORKSPACE_API_TOKEN_TYPE);

    if (!isModernToken && !isLegacyToken) {
      throw new UnauthorizedException('Invalid workspace token type');
    }

    const userId = Number(payload.userId);
    const workspace = Number(payload.workspace);
    if (!['number', 'string'].includes(typeof payload.userId) ||
      !['number', 'string'].includes(typeof payload.workspace) ||
      !Number.isInteger(userId) || userId <= 0 || !Number.isInteger(workspace) || workspace <= 0) {
      throw new UnauthorizedException('Invalid workspace token payload');
    }

    const defaultScopes = isLegacyToken && payload.scopes === undefined ? [WORKSPACE_TOKEN_SCOPE_REPLAY_READ] : [];
    return {
      userId,
      id: userId,
      name: payload.username,
      workspace,
      tokenUse: WORKSPACE_TOKEN_USE,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: Array.isArray(payload.scopes) ?
        payload.scopes.filter((scope): scope is string => typeof scope === 'string') :
        defaultScopes,
      isWorkspaceToken: true
    };
  }
}
