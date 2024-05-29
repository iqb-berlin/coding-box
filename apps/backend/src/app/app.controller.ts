import {
  Body,
  Controller, Get, Post, UseGuards
} from '@nestjs/common';

import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../frontend/api-dto/user/create-user-dto';
import { UserId, UserName } from './admin/users/user.decorator';
import { AuthDataDto } from '../../../frontend/api-dto/auth-data-dto';
import { UsersService } from './database/services/users.service';
import { WorkspaceService } from './database/services/workspace.service';
import { LocalAuthGuard } from './auth/local-auth.guard';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TestcenterService } from './database/services/testcenter.service';

@Controller()
export class AppController {
  constructor(private authService:AuthService,
              private userService: UsersService,
              private testcenterService: TestcenterService,
              private workspaceService:WorkspaceService) {}

  @Get('create-token')
  @UseGuards(JwtAuthGuard)
  async createToken():Promise<string> {
    return await this.authService.createToken();
  }

  @Get('auth-data')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' })
  @ApiTags('auth')
  async findCanDos(
    @UserId() userId: number, @UserName() userName: string
  ): Promise<AuthDataDto> {
    const workspaces = await this.workspaceService.findAllUserWorkspaces(userId);
    return <AuthDataDto><unknown>{
      userId: userId,
      userName: userName,
      isAdmin: await this.authService.isAdminUser(userId),
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

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Login successful.' })
  async login(@Body() user: CreateUserDto) {
    const token = await this.authService.login(user);
    return `"${token}"`;
  }

  @Post('password')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Password successfully updated.' })
  @ApiTags('auth')
  async setPassword(@Body() new_password, token): Promise<any> {
    return this.userService.setPassword(new_password, token);
  }

  @Post('tc_authentication')
  async authenticate(@Body() credentials: any): Promise<any> {
    return this.testcenterService.authenticate(credentials);
  }
}
