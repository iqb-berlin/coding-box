import {
  Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards
} from '@nestjs/common';
import { ValidatedBody } from '../http/validated-body.decorator';
import type { RequestBody } from '../../../../../api-dto/request-contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from '../admin/workspace/access-level.guard';
import { WorkspaceSettingsService } from './workspace-settings.service';

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspace/:workspaceId/settings')
export class WorkspaceSettingsController {
  constructor(private readonly settingsService: WorkspaceSettingsService) {}

  @Get(':key')
  getWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('key') key: string
  ) {
    return this.settingsService.getWorkspaceSetting(workspaceId, key);
  }

  @Post('batch')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  createWorkspaceSettings(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @ValidatedBody('WorkspaceSettingsBatchDto') body: RequestBody<'WorkspaceSettingsBatchDto'>
  ) {
    return this.settingsService.createWorkspaceSettings(workspaceId, body);
  }

  @Post()
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  createWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @ValidatedBody('WorkspaceSettingWriteDto') body: RequestBody<'WorkspaceSettingWriteDto'>
  ) {
    return this.settingsService.createWorkspaceSetting(workspaceId, body);
  }

  @Put(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  updateWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @ValidatedBody('WorkspaceSettingsController_updateWorkspaceSetting') body: RequestBody<'WorkspaceSettingsController_updateWorkspaceSetting'>
  ) {
    return this.settingsService.updateWorkspaceSetting(workspaceId, settingId, body);
  }

  @Delete(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  deleteWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string
  ) {
    return this.settingsService.deleteWorkspaceSetting(workspaceId, settingId);
  }
}
