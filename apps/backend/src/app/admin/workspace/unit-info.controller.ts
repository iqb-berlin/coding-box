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
import { JwtOrWorkspaceTokenAuthGuard } from '../../auth/jwt-or-workspace-token-auth.guard';
import {
  AllowWorkspaceTokenScopes,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ
} from '../../auth/workspace-token';
import { WorkspaceGuard } from './workspace.guard';
import { UnitInfoService } from '../../database/services/workspace';
import { UnitInfoDto } from '../../../../../../api-dto/unit-info/unit-info.dto';

@ApiTags('Unit Info')
@Controller('admin/workspace/:workspaceId/unit')
@UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
export class UnitInfoController {
  constructor(private readonly unitInfoService: UnitInfoService) {}

  @Get(':unitId/info')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_REPLAY_READ)
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
    return this.unitInfoService.getUnitInfo(workspaceId, unitId);
  }
}
