import {
  Body,
  Controller, Delete, Param, Patch, Post, UploadedFile, UseInterceptors
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { WorkspaceService } from '../../database/services/workspace.service';

@Controller('workspaces/test-files')
export class TestFilesController {
  constructor(
    private workspaceService: WorkspaceService
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiTags('ws admin test-files')
  async addTestFiles(@UploadedFile() file) {
    return this.workspaceService.uploadTestFiles(1, file.buffer, file);
  }

  @Delete(':ids')
  @ApiTags('ws admin test-files')
  async deleteTestFiles(@Param('ids')ids : string) {
    return this.workspaceService.deleteTestFiles(ids.split(';'));
  }
}
