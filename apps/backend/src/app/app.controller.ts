import {
  Body,
  Controller, Get, Post, Query, UseGuards
} from '@nestjs/common';

import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../frontend/api-dto/user/create-user-dto';
import { AuthDataDto } from '../../../frontend/api-dto/auth-data-dto';
import { UsersService } from './database/services/users.service';
import { WorkspaceService } from './database/services/workspace.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TestcenterService } from './database/services/testcenter.service';

@Controller()
export class AppController {
  constructor(private authService:AuthService,
              private usersService: UsersService,
              private testCenterService: TestcenterService,
              private workspaceService:WorkspaceService) {}

  @Get('auth-data')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' })
  @ApiTags('auth')
  async findCanDos(@Query('identity')identity:string): Promise<AuthDataDto> {
    const user = await this.usersService.findUserByIdentity(identity);
    const workspaces = await this.workspaceService.findAllUserWorkspaces(identity);
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
  async authenticate(@Body() credentials: any): Promise<any> {
    return this.testCenterService.authenticate(credentials);
  }
}
