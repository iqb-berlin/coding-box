import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WORKSPACE_TOKEN_STRATEGY } from './workspace-token.constants';

@Injectable()
export class JwtOrWorkspaceTokenAuthGuard extends AuthGuard(['jwt', WORKSPACE_TOKEN_STRATEGY]) {}
