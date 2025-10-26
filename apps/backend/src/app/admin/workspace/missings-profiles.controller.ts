import {
  Controller, Get, Post, Body, Param, Delete, Put
} from '@nestjs/common';
import { MissingsProfilesService } from '../../database/services/missings-profiles.service';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

@Controller('admin/workspace/:workspaceId/missings-profiles')
export class MissingsProfilesController {
  constructor(private readonly missingsProfilesService: MissingsProfilesService) {}

  @Get()
  async getMissingsProfiles(@Param('workspaceId') workspaceId: number) {
    return this.missingsProfilesService.getMissingsProfiles(workspaceId);
  }

  @Get(':id')
  async getMissingsProfileDetails(
  @Param('workspaceId') workspaceId: number,
    @Param('id') id: string
  ) {
    const parsedId = parseInt(id, 10);
    if (!Number.isNaN(parsedId)) {
      return this.missingsProfilesService.getMissingsProfileDetails(workspaceId, parsedId);
    }
    return this.missingsProfilesService.getMissingsProfileByLabel(id);
  }

  @Post()
  async createMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.missingsProfilesService.createMissingsProfile(workspaceId, profile);
  }

  @Put(':label')
  async updateMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.missingsProfilesService.updateMissingsProfile(workspaceId, label, profile);
  }

  @Delete(':label')
  async deleteMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string
  ) {
    return this.missingsProfilesService.deleteMissingsProfile(workspaceId, label);
  }
}
