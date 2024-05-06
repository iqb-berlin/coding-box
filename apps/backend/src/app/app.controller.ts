import {
  Body,
  Controller, Get, Post
} from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../frontend/api-dto/user/create-user-dto';
import { WorkspaceService } from './database/services/workspace.service';

@Controller()
export class AppController {
  constructor(public authService:AuthService) {}

  @Get('player')
  async getPlayer():Promise<string> {
    const fileContent = fs.readFileSync(path.resolve(process.cwd(), 'apps/backend/src/verona/iqb-player-aspect-2.4.1.html'), 'utf8');
    const stringifiedJSON = JSON.stringify(fileContent);
    return stringifiedJSON;
  }

  @Post('login')
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Login successful.' })
  async login(@Body() user: CreateUserDto) {
    const token = await this.authService.login(user);
    return `"${token}"`;
  }
}
