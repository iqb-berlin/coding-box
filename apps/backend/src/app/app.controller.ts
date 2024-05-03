import {
  Body,
  Controller, Get, Post, UploadedFiles, UseInterceptors
} from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { CreateUserDto } from '../../../frontend/api-dto/user/create-user-dto';
import { AuthService } from './auth/service/auth.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, public authService:AuthService) {}

  @Get('player')
  async getPlayer():Promise<string> {
    const fileContent = fs.readFileSync(path.resolve(process.cwd(), 'apps/backend/src/verona/iqb-player-aspect-2.4.1.html'), 'utf8');
    const stringifiedJSON = JSON.stringify(fileContent);
    return stringifiedJSON;
  }

  @Post('upload/results')
  @UseInterceptors(FilesInterceptor('files'))
  async addResultsFiles(@UploadedFiles() files): Promise<any> {
    return this.appService.uploadResults(files);
  }

  @Post('login')
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Login successful.' })
  async login(@Body() user: CreateUserDto) {
    const token = await this.authService.login(user);
    return `"${token}"`;
  }
}
