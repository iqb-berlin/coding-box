import {
  Controller, Get, Post, Body, Param, Delete, Put
} from '@nestjs/common';
import { WorkspacesAdminFacade } from '../../workspaces/services/workspaces-admin-facade.service';
import { MissingsProfilesDto } from '../../../../../../api-dto/coding/missings-profiles.dto';

@Controller('admin/workspace/:workspaceId/missings-profiles')
export class MissingsProfilesController {
  constructor(private readonly workspacesAdminFacade: WorkspacesAdminFacade) {}

  @Get()
  async getMissingsProfiles(@Param('workspaceId') workspaceId: number) {
    return this.workspacesAdminFacade.getMissingsProfiles(workspaceId);
  }

  @Get(':id')
  async getMissingsProfileDetails(
  @Param('workspaceId') workspaceId: number,
    @Param('id') id: string
  ) {
    const parsedId = parseInt(id, 10);
    if (!Number.isNaN(parsedId)) {
      return this.workspacesAdminFacade.getMissingsProfileDetails(workspaceId, parsedId);
    }
    return this.workspacesAdminFacade.getMissingsProfileByLabel(id);
  }

  @Post()
  async createMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.workspacesAdminFacade.createMissingsProfile(workspaceId, profile);
  }

  @Put(':label')
  async updateMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string,
    @Body() profile: MissingsProfilesDto
  ) {
    return this.workspacesAdminFacade.updateMissingsProfile(workspaceId, label, profile);
  }

  @Delete(':label')
  async deleteMissingsProfile(
  @Param('workspaceId') workspaceId: number,
    @Param('label') label: string
  ) {
    return this.workspacesAdminFacade.deleteMissingsProfile(workspaceId, label);
  }
}
