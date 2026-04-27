import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  AccessLevelGuard,
  RequireAccessLevel
} from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { ContentPoolIntegrationService } from '../content-pool/content-pool-integration.service';

interface ContentPoolCredentialsDto {
  username: string;

  password: string;
}

interface ImportAcpDto extends ContentPoolCredentialsDto {
  acpId: string;

  overwriteExisting?: boolean;

  overwriteFileIds?: string[];
}

interface UploadFilesToAcpDto extends ContentPoolCredentialsDto {
  acpId: string;

  fileIds: number[];

  changelog?: string;
}

@ApiTags('Admin Workspace Content Pool')
@Controller('admin/workspace/:workspace_id/content-pool')
@UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
@ApiBearerAuth()
export class WorkspaceContentPoolController {
  constructor(
    private readonly contentPoolIntegrationService: ContentPoolIntegrationService
  ) {}

  @Get('config')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Read effective Content-Pool integration config for workspace users'
  })
  async getConfig() {
    return this.contentPoolIntegrationService.getSettings();
  }

  @Post('acps')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Authenticate against Content Pool and list accessible ACPs'
  })
  async listAcps(@Body() body: ContentPoolCredentialsDto) {
    return this.contentPoolIntegrationService.listAccessibleAcps(
      body.username,
      body.password
    );
  }

  @Post('import-acp')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Import all files from selected Content-Pool ACP into workspace test files'
  })
  async importAcp(
  @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Body() body: ImportAcpDto
  ) {
    return this.contentPoolIntegrationService.importAcpFilesToWorkspace({
      workspaceId,
      acpId: body.acpId,
      username: body.username,
      password: body.password,
      overwriteExisting: body.overwriteExisting,
      overwriteFileIds: body.overwriteFileIds
    });
  }

  @Post('import-acp/start')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Start importing all files from selected Content-Pool ACP'
  })
  async startImportAcp(
  @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Body() body: ImportAcpDto
  ) {
    return this.contentPoolIntegrationService.startAcpImportToWorkspace({
      workspaceId,
      acpId: body.acpId,
      username: body.username,
      password: body.password,
      overwriteExisting: body.overwriteExisting,
      overwriteFileIds: body.overwriteFileIds
    });
  }

  @Get('import-acp/:job_id/progress')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Read progress of a Content-Pool ACP import job'
  })
  async getImportAcpProgress(@Param('job_id') jobId: string) {
    return this.contentPoolIntegrationService.getAcpImportProgress(jobId);
  }

  @Post('upload-files/start')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Start replacing selected ACP files with workspace files'
  })
  async startUploadFilesToAcp(
  @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Body() body: UploadFilesToAcpDto
  ) {
    return this.contentPoolIntegrationService.startUploadWorkspaceFilesToAcp({
      workspaceId,
      acpId: body.acpId,
      username: body.username,
      password: body.password,
      fileIds: body.fileIds,
      changelog: body.changelog
    });
  }

  @Get('upload-files/:job_id/progress')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Read progress of a Content-Pool file upload job'
  })
  async getUploadFilesToAcpProgress(@Param('job_id') jobId: string) {
    return this.contentPoolIntegrationService.getUploadWorkspaceFilesProgress(jobId);
  }
}
