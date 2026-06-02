import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';

import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
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

  @Post('tc_authentication')
  async authenticateTestCenter(
    @Body() credentials: { username: string, password: string, server: string, url: string }
  ): Promise<Record<string, unknown>> {
    return this.testCenterService.authenticate(credentials);
  }
}
