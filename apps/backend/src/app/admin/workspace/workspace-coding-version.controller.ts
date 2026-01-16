import {
  Controller,
  Post,
  Req,
  UseGuards,
  Body
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingVersionService, CodingStatisticsService } from '../../database/services/coding';
import { JournalService } from '../../database/services/shared';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    id: string;
    name: string;
    workspace: string;
  };
}

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingVersionController {
  constructor(
    private codingVersionService: CodingVersionService,
    private codingStatisticsService: CodingStatisticsService,
    private journalService: JournalService
  ) { }

  @Post(':workspace_id/coding/reset-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiBody({
    description: 'Reset coding version request',
    schema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          enum: ['v1', 'v2', 'v3'],
          description: 'Coding version to reset'
        },
        unitFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional unit names to filter by'
        },
        variableFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional variable IDs to filter by'
        }
      },
      required: ['version']
    }
  })
  @ApiOkResponse({
    description: 'Coding version reset successfully',
    schema: {
      type: 'object',
      properties: {
        affectedResponseCount: {
          type: 'number',
          description: 'Number of responses that were reset'
        },
        cascadeResetVersions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Versions that were also reset due to cascade'
        },
        message: {
          type: 'string',
          description: 'Summary message of the reset operation'
        }
      }
    }
  })
  async resetCodingVersion(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     version: 'v1' | 'v2' | 'v3';
                     unitFilters?: string[];
                     variableFilters?: string[];
                   },
                   @Req() request: RequestWithUser
  ): Promise<{
        affectedResponseCount: number;
        cascadeResetVersions: ('v2' | 'v3')[];
        message: string;
      }> {
    const result = await this.codingVersionService.resetCodingVersion(
      workspace_id,
      body.version,
      body.unitFilters,
      body.variableFilters
    );

    // Invalidate statistics cache for reset versions
    await this.codingStatisticsService.invalidateCache(
      workspace_id,
      body.version
    );
    if (result.cascadeResetVersions.length > 0) {
      for (const cascadeVersion of result.cascadeResetVersions) {
        await this.codingStatisticsService.invalidateCache(
          workspace_id,
          cascadeVersion
        );
      }
    }

    // Log to journal
    const userId = request.user?.id || 'unknown';
    await this.journalService.createEntry(
      userId,
      workspace_id,
      'RESET_VERSION',
      'CODING',
      workspace_id,
      {
        version: body.version,
        affectedResponseCount: result.affectedResponseCount,
        unitFilters: body.unitFilters || [],
        variableFilters: body.variableFilters || [],
        cascadeResetVersions: result.cascadeResetVersions
      }
    );

    return result;
  }
}
