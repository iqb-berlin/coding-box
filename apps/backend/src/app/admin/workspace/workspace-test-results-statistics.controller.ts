import {
  BadRequestException,
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
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceTestResultsService } from '../../database/services/workspace-test-results.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsStatisticsController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService
  ) { }

  @Get(':workspace_id/test-results/overview')
  @ApiOperation({
    summary: 'Get workspace-wide test results overview',
    description:
            'Returns counts (testgroups/testpersons/unique units/booklets/responses) and response status distribution for the whole workspace.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        testPersons: { type: 'number' },
        testGroups: { type: 'number' },
        uniqueBooklets: { type: 'number' },
        uniqueUnits: { type: 'number' },
        uniqueResponses: { type: 'number' },
        responseStatusCounts: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        sessionBrowserCounts: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        sessionOsCounts: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        sessionScreenCounts: {
          type: 'object',
          additionalProperties: { type: 'number' }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve overview' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getOverview(
    @Param('workspace_id', ParseIntPipe) workspaceId: number
  ): Promise<{
        testPersons: number;
        testGroups: number;
        uniqueBooklets: number;
        uniqueUnits: number;
        uniqueResponses: number;
        responseStatusCounts: Record<string, number>;
        sessionBrowserCounts: Record<string, number>;
        sessionOsCounts: Record<string, number>;
        sessionScreenCounts: Record<string, number>;
      }> {
    try {
      return await this.workspaceTestResultsService.getWorkspaceTestResultsOverview(
        workspaceId
      );
    } catch (error) {
      throw new BadRequestException(
        `Failed to retrieve overview. ${error.message}`
      );
    }
  }
}
