import {
  BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Post, Query, Req, UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiOkResponse, ApiResponse, ApiTags
} from '@nestjs/swagger';
import { Request } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { RequestBody } from '../../../../api-dto/request-contracts';
import { ValidatedBody } from './http/validated-body.decorator';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { UsersService } from './database/services/users';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TestcenterService } from './database/services/test-results';
import { WorkspaceUsersService } from './database/services/workspace';

type AuthenticatedRequest = Request & {
  user?: {
    identity?: string;
  };
};

@Controller()
export class AppController {
  constructor(private usersService: UsersService,
              private testCenterService: TestcenterService,
              private workspaceUsersService: WorkspaceUsersService) {}

  @Get('auth-data')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' })
  @ApiTags('auth')
  async getUserAuthData(
    @Query('identity') identity: string | undefined,
    @Req() req: AuthenticatedRequest
  ): Promise<AuthDataDto> {
    const tokenIdentity = req.user?.identity;
    if (!tokenIdentity) {
      throw new BadRequestException('authenticated identity is required');
    }

    if (identity !== undefined && typeof identity !== 'string') {
      throw new BadRequestException('identity query parameter must be a string');
    }

    const requestedIdentity = typeof identity === 'string' && identity.trim() ?
      identity.trim() :
      tokenIdentity;

    this.assertTokenMatchesRequestedIdentity(requestedIdentity, tokenIdentity);

    const user = await this.usersService.findUserByIdentity(requestedIdentity);
    if (!user) {
      throw new NotFoundException(`User with identity ${requestedIdentity} not found`);
    }

    const workspaces = await this.workspaceUsersService.findAllUserWorkspaces(requestedIdentity);
    return <AuthDataDto><unknown>{
      userId: user.id,
      userName: user.username,
      isAdmin: user.isAdmin,
      workspaces: workspaces
    };
  }

  private assertTokenMatchesRequestedIdentity(requestedIdentity: string, tokenIdentity?: string): void {
    if (!tokenIdentity || tokenIdentity !== requestedIdentity) {
      throw new ForbiddenException('Requested identity does not match the authenticated user');
    }
  }

  @Post('tc_authentication')
  @ApiTags('auth')
  @ApiBearerAuth()
  @ApiResponse({ status: 201, description: 'Testcenter session created', schema: { type: 'object', additionalProperties: true } })
  @ApiResponse({ status: 400, description: 'Invalid request body or Testcenter URL' })
  @ApiResponse({ status: 401, description: 'Application authentication is invalid' })
  @ApiResponse({ status: 403, description: 'Testcenter target or access is not allowed' })
  @ApiResponse({ status: 422, description: 'Testcenter credentials are invalid; the application session remains valid' })
  @ApiResponse({ status: 429, description: 'Authentication rate limit exceeded; retry after the Retry-After interval' })
  @ApiResponse({ status: 502, description: 'Invalid upstream Testcenter response' })
  @ApiResponse({ status: 503, description: 'Testcenter authentication is unavailable' })
  @ApiResponse({ status: 504, description: 'Testcenter authentication timed out' })
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  async authenticateTestCenter(
    @ValidatedBody('AppController_authenticateTestCenter') credentials: RequestBody<'AppController_authenticateTestCenter'>
  ): Promise<Record<string, unknown>> {
    return this.testCenterService.authenticate(credentials);
  }
}
