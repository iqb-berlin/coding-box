import {
  Controller, Post, UploadedFile, UseInterceptors
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
  async addTestFile(@UploadedFile() file) {
    return this.workspaceService.uploadTestFiles(1, file.buffer, file);
  }
}
