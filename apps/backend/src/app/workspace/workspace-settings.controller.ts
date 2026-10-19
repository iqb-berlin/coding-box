import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  ParseIntPipe,
  UseGuards,
  Req
} from '@nestjs/common';
import type { RequestBody } from '../../../../../api-dto/request-contracts';
import { ValidatedBody } from '../http/validated-body.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import {
  AccessLevelGuard,
  RequireAccessLevel
} from '../admin/workspace/access-level.guard';
import { WorkspaceSettingsService } from './workspace-settings.service';

type WorkspaceSettingWriteDto = RequestBody<'WorkspaceSettingWriteDto'>;
type WorkspaceSettingsBatchDto = RequestBody<'WorkspaceSettingsBatchDto'>;

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspace/:workspaceId/settings')
export class WorkspaceSettingsController {
  constructor(
    private readonly settings: WorkspaceSettingsService
  ) {}

  @Get(':key')
  async getWorkspaceSetting(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('key') key: string
  ) {
    return this.settings.getWorkspaceSetting(workspaceId, key);
  }

  @Post('batch')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async createWorkspaceSettings(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @ValidatedBody('WorkspaceSettingsBatchDto') createSettingsDto: WorkspaceSettingsBatchDto,
    @Req() request?: { user: { id: number } }
  ) {
    return this.settings.createWorkspaceSettings(workspaceId, createSettingsDto, request?.user.id);
  }

  @Post()
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async createWorkspaceSetting(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @ValidatedBody('WorkspaceSettingWriteDto') createSettingDto: WorkspaceSettingWriteDto,
    @Req() request?: { user: { id: number } }
  ) {
    return this.settings.createWorkspaceSetting(workspaceId, createSettingDto, request?.user.id);
  }

  @Put(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async updateWorkspaceSetting(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @ValidatedBody('WorkspaceSettingsController_updateWorkspaceSetting') updateSettingDto: RequestBody<'WorkspaceSettingsController_updateWorkspaceSetting'>,
    @Req() request?: { user: { id: number } }
  ) {
    return this.settings.updateWorkspaceSetting(workspaceId, settingId, updateSettingDto, request?.user.id);
  }

  @Delete(':settingId')
  @UseGuards(AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteWorkspaceSetting(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Param('settingId') settingId: string,
    @Req() request?: { user: { id: number } }
  ) {
    return this.settings.deleteWorkspaceSetting(workspaceId, settingId, request?.user.id);
  }
}
