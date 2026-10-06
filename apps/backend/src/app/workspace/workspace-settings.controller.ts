import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards
} from '@nestjs/common';
import { requestBodySchemas } from '../http/request-body.schemas';
import { JsonSchemaValidationPipe } from '../http/json-schema-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from '../admin/workspace/access-level.guard';
import {
  WorkspaceSettingsService, WorkspaceSettingWriteDto, WorkspaceSettingsBatchDto
} from './workspace-settings.service';

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
    @Body(new JsonSchemaValidationPipe(requestBodySchemas.WorkspaceSettingsBatchDto)) body: WorkspaceSettingsBatchDto
  ) {
    return this.settingsService.createWorkspaceSettings(workspaceId, body);
  }

  @Post()
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  createWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body(new JsonSchemaValidationPipe(requestBodySchemas.WorkspaceSettingWriteDto)) body: WorkspaceSettingWriteDto
  ) {
    return this.settingsService.createWorkspaceSetting(workspaceId, body);
  }

  @Put(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  updateWorkspaceSetting(
  @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @Body(new JsonSchemaValidationPipe(requestBodySchemas.WorkspaceSettingsController_updateWorkspaceSetting)) body: { value: string }
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
