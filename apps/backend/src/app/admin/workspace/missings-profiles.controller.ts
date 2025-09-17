import {
  Controller, Get, Post, Body, Param, Delete, Put
} from '@nestjs/common';
import { WorkspaceCodingService } from '../../database/services/workspace-coding.service';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

@Controller('admin/workspace/:workspaceId/missings-profiles')
export class MissingsProfilesController {
  constructor(private readonly workspaceCodingService: WorkspaceCodingService) {}

  @Get()
  async getMissingsProfiles(@Param('workspaceId') workspaceId: number) {
    return this.workspaceCodingService.getMissingsProfiles(workspaceId);
  }

  @Get(':label')
  async getMissingsProfileDetails(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string
  ) {
    return this.workspaceCodingService.getMissingsProfileDetails(workspaceId, label);
  }

  @Post()
  async createMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.workspaceCodingService.createMissingsProfile(workspaceId, profile);
  }

  @Put(':label')
  async updateMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.workspaceCodingService.updateMissingsProfile(workspaceId, label, profile);
  }

  @Delete(':label')
  async deleteMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string
  ) {
    return this.workspaceCodingService.deleteMissingsProfile(workspaceId, label);
  }
}
