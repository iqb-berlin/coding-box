import {
  Controller,
  Get,
  Param,
  UseGuards
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspacesAdminFacade } from '../../workspaces/services/workspaces-admin-facade.service';
import { UnitInfoDto } from '../../../../../../api-dto/unit-info/unit-info.dto';

@ApiTags('Unit Info')
@Controller('admin/workspace/:workspaceId/unit')
@UseGuards(JwtAuthGuard)
export class UnitInfoController {
  constructor(private readonly workspacesAdminFacade: WorkspacesAdminFacade) {}

  @Get(':unitId/info')
  @ApiOperation({ summary: 'Get unit info from XML' })
  @ApiParam({ name: 'workspaceId', type: Number })
  @ApiParam({ name: 'unitId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Unit info retrieved successfully',
    type: UnitInfoDto
  })
  async getUnitInfo(
    @Param('workspaceId') workspaceId: number,
      @Param('unitId') unitId: string
  ): Promise<UnitInfoDto> {
    return this.workspacesAdminFacade.getUnitInfo(workspaceId, unitId);
  }
}
