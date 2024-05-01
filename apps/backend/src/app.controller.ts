import {
  Controller, Get, Post, UploadedFiles, UseInterceptors
} from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';
import { FilesInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
}
