import {
  Body,
  Controller, Get, Post
} from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../frontend/api-dto/user/create-user-dto';
import { UserId, UserName } from './admin/users/user.decorator';
import { AuthDataDto } from '../../../frontend/api-dto/auth-data-dto';
import { UsersService } from './database/services/users.service';
import { WorkspaceService } from './database/services/workspace.service';

@Controller()
export class AppController {
  constructor(public authService:AuthService, public userService: UsersService, public workspaceService:WorkspaceService) {}

  @Get('player')
  async getPlayer():Promise<string> {
    const fileContent = fs.readFileSync(path.resolve(process.cwd(), 'apps/backend/src/verona/iqb-player-aspect-2.4.1.html'), 'utf8');
    const stringifiedJSON = JSON.stringify(fileContent);
    return stringifiedJSON;
  }

  @Get('auth-data')
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' })
  @ApiTags('auth')
  async findCanDos(
    @UserId() userId: number, @UserName() userName: string
  ): Promise<AuthDataDto> {
    return <AuthDataDto>{
      userId: userId,
      userName: userName,
      userLongName: await this.userService.getLongName(userId),
      isAdmin: await this.authService.isAdminUser(userId),
      workspaces: await this.workspaceService.findAll(userId)
    };
  }

  @Post('login')
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Login successful.' })
  async login(@Body() user: CreateUserDto) {
    const token = await this.authService.login(user);
    return `"${token}"`;
  }

  @Post('password')
  @ApiOkResponse({ description: 'Password successfully updated.' })
  @ApiTags('auth')
  async setPassword(@Body() new_password, token): Promise<any> {
    return this.userService.setPassword(new_password, token);
  }
}
