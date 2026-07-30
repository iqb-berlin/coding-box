import {
  Controller, Get, Post, Body, Param, Delete, Put, UseGuards
} from '@nestjs/common';
import { MissingsProfilesService } from '../../database/services/coding';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';

@Controller('admin/workspace/:workspace_id/missings-profiles')
export class MissingsProfilesController {
  constructor(private readonly missingsProfilesService: MissingsProfilesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getMissingsProfiles(@WorkspaceId() workspaceId: number) {
    return this.missingsProfilesService.getMissingsProfiles(workspaceId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getMissingsProfileDetails(
  @WorkspaceId() workspaceId: number,
    @Param('id') id: string
  ) {
    const parsedId = parseInt(id, 10);
    if (!Number.isNaN(parsedId)) {
      return this.missingsProfilesService.getMissingsProfileDetails(workspaceId, parsedId);
    }
    return this.missingsProfilesService.getMissingsProfileByLabel(workspaceId, id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async createMissingsProfile(
  @WorkspaceId() workspaceId: number,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.missingsProfilesService.createMissingsProfile(workspaceId, profile);
  }

  @Put(':label')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async updateMissingsProfile(
  @WorkspaceId() workspaceId: number,
    @Param('label') label: string,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.missingsProfilesService.updateMissingsProfile(workspaceId, label, profile);
  }

  @Delete(':label')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteMissingsProfile(
  @WorkspaceId() workspaceId: number,
    @Param('label') label: string
  ) {
    return this.missingsProfilesService.deleteMissingsProfile(workspaceId, label);
  }
}
