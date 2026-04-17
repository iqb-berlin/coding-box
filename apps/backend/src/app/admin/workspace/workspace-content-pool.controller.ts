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

class ContentPoolCredentialsDto {
  username: string;

  password: string;
}

class ReplaceCodingSchemeDto extends ContentPoolCredentialsDto {
  acpId: string;

  fileId: number;

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
  async listAcps(
    @Body() body: ContentPoolCredentialsDto
  ) {
    return this.contentPoolIntegrationService.listAccessibleAcps(
      body.username,
      body.password
    );
  }

  @Post('replace-coding-scheme')
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Replace one .vocs coding scheme in selected Content-Pool ACP and create snapshot'
  })
  async replaceCodingScheme(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Body() body: ReplaceCodingSchemeDto
  ) {
    return this.contentPoolIntegrationService.replaceCodingSchemeInAcp({
      workspaceId,
      fileId: body.fileId,
      acpId: body.acpId,
      username: body.username,
      password: body.password,
      changelog: body.changelog
    });
  }
}
