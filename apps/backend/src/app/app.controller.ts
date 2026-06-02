import {
  Body,
  Controller, Get, Post, Query, UseGuards
} from '@nestjs/common';

import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { UsersService } from './database/services/users';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TestcenterService } from './database/services/test-results';
import { WorkspaceUsersService } from './database/services/workspace';

@Controller()
export class AppController {
  constructor(private usersService: UsersService,
              private testCenterService: TestcenterService,
              private workspaceUsersService: WorkspaceUsersService) {}

  @Get('auth-data')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' })
  @ApiTags('auth')
  async getUserAuthData(@Query('identity') identity: string): Promise<AuthDataDto> {
    const user = await this.usersService.findUserByIdentity(identity);
    const workspaces = await this.workspaceUsersService.findAllUserWorkspaces(identity);
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
