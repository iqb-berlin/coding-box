import {
  Body,
  Controller, Get, Post, Query, UseGuards
} from '@nestjs/common';

import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../../api-dto/user/create-user-dto';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { UsersService } from './users/services/users.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TestcenterService } from './workspaces/services/testcenter.service';
import { WorkspaceUsersService } from './workspaces/services/workspace-users.service';

@Controller()
export class AppController {
  constructor(private authService:AuthService,
              private usersService: UsersService,
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

  @Post('keycloak-login')
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Keycloak login successful.' })
  async keycloakLogin(@Body() user: CreateUserDto) {
    const token = await this.authService.keycloakLogin(user);
    return `"${token}"`;
  }

  @Post('tc_authentication')
  async authenticateTestCenter(
    @Body() credentials: { username: string, password: string, server: string, url: string }
  ): Promise<Record<string, unknown>> {
    return this.testCenterService.authenticate(credentials);
  }
}
