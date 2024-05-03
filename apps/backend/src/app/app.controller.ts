import {
  Body,
  Controller, Get, Post, UploadedFiles, UseGuards, UseInterceptors
} from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { CreateUserDto } from '../../../frontend/api-dto/user/create-user-dto';
import { AuthService } from './auth/service/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { UserId, UserName } from './auth/user.decorator';
import { AuthDataDto } from '../../../frontend/src/app/components/auth-data-dto';
import { UsersService } from './database/services/users.service';

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

  @Get('auth-data')
  @UseGuards(JwtAuthGuard)
  @ApiHeader({
    name: 'app-version',
    description: 'version of frontend',
    required: true,
    allowEmptyValue: false
  })
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' }) // TODO: Add Exception
  @ApiTags('auth')
  async findCanDos(
    @UserId() userId: number, @UserName() userName: string
  ): Promise<AuthDataDto> {
    if (userId) {
      return <AuthDataDto>{
        userId: userId,
        userName: userName,
        userLongName: 'long',
        isAdmin: true
      };
    }
    return <AuthDataDto>{
      userId: 0,
      userName: '',
      isAdmin: false
    };
  }
  @Post('login')
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Login successful.' })
  async login(@Body() user: CreateUserDto) {
    const token = await this.authService.login(user);
    return `"${token}"`;
  }
}
