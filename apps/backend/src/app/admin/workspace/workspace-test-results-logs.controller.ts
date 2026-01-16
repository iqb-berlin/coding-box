import {
  Controller,
  Get,
  Param,
  UseGuards,
  ParseIntPipe
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { BookletLogsResponse } from './dto/workspace-test-results.interfaces';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsLogsController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService
  ) { }

  @Get(':workspace_id/units/:unitId/logs')
  @ApiOperation({
    summary: 'Get unit logs',
    description:
      'Retrieves all logs for a specific unit (by numeric unit ID) in a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'unitId',
    type: Number,
    description: 'ID of the unit (numeric)'
  })
  @ApiOkResponse({
    description: 'Unit logs retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          unitid: { type: 'number' },
          ts: { type: 'string' },
          key: { type: 'string' },
          parameter: { type: 'string' }
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findUnitLogs(
    @Param('workspace_id') workspace_id: number,
      @Param('unitId', ParseIntPipe) unitId: number
  ): Promise<
      { id: number; unitid: number; ts: string; key: string; parameter: string }[]
      > {
    return this.workspaceTestResultsService.findUnitLogs(workspace_id, unitId);
  }

  @Get(':workspace_id/units/:unitId/booklet-logs')
  @ApiOperation({
    summary: 'Get booklet logs for unit',
    description:
      'Retrieves booklet logs and sessions for the booklet that contains the given unit (numeric unit ID)'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'unitId',
    type: Number,
    description: 'ID of the unit (numeric)'
  })
  @ApiOkResponse({
    description: 'Booklet logs retrieved successfully.'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findBookletLogsForUnit(
    @Param('workspace_id') workspace_id: number,
      @Param('unitId', ParseIntPipe) unitId: number
  ): Promise<BookletLogsResponse> {
    return this.workspaceTestResultsService.findBookletLogsByUnitId(
      workspace_id,
      unitId
    );
  }
}
