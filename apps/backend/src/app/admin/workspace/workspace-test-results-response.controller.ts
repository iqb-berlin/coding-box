import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { logger } from 'nx/src/utils/logger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { WorkspaceTestResultsService, ResponseManagementService } from '../../database/services/test-results';
import { ResponseEntity } from '../../database/entities/response.entity';
import { RequestWithUser, ResolveDuplicateResponsesRequest, ResponseSearchResult } from './dto/workspace-test-results.interfaces';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsResponseController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private responseManagementService: ResponseManagementService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService
  ) { }

  private async invalidateFlatResponseFilterOptionsCache(
    workspaceId: number
  ): Promise<void> {
    const versionKey =
      this.cacheService.generateFlatResponseFilterOptionsVersionKey(
        workspaceId
      );
    const nextVersion = await this.cacheService.incr(versionKey);
    await this.jobQueueService.addFlatResponseFilterOptionsJob(
      workspaceId,
      60000,
      {
        jobId: `flat-response-filter-options:${workspaceId}:v${nextVersion}:thr60000`,
        removeOnComplete: true,
        removeOnFail: true
      }
    );
  }

  @Delete(':workspace_id/responses/:responseId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Delete a response',
    description: 'Deletes a response'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'responseId',
    type: Number,
    description: 'ID of the response to delete'
  })
  @ApiOkResponse({
    description: 'Response deleted successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to delete response' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteResponse(
    @Param('workspace_id') workspaceId: number,
      @Param('responseId') responseId: number,
      @Req() req: RequestWithUser
  ): Promise<{
        success: boolean;
        report: {
          deletedResponse: number | null;
          warnings: string[];
        };
      }> {
    const result = await this.responseManagementService.deleteResponse(
      workspaceId,
      responseId,
      req.user.id
    );
    if (result?.success) {
      await this.invalidateFlatResponseFilterOptionsCache(workspaceId);
    }
    return result;
  }

  @Post(':workspace_id/responses/resolve-duplicates')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Resolve duplicate responses',
    description:
      'Resolves duplicate responses by keeping one response per duplicate group and deleting the others.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Duplicate responses resolved successfully.'
  })
  async resolveDuplicateResponses(
    @Param('workspace_id') workspaceId: number,
      @Body() body: ResolveDuplicateResponsesRequest,
      @Req() req: RequestWithUser
  ): Promise<{ resolvedCount: number; success: boolean }> {
    try {
      return await this.responseManagementService.resolveDuplicateResponses(
        workspaceId,
        body?.resolutionMap || {},
        req.user.id
      );
    } catch (error) {
      throw new BadRequestException(
        `Failed to resolve duplicate responses. ${error.message}`
      );
    }
  }

  @Get(':workspace_id/responses')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Responses retrieved successfully.'
  })
  async findWorkspaceResponse(
    @WorkspaceId() id: number,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 20
  ): Promise<{
        data: ResponseEntity[];
        total: number;
        page: number;
        limit: number;
      }> {
    const [responses, total] =
      await this.workspaceTestResultsService.findWorkspaceResponses(id, {
        page,
        limit
      });
    return {
      data: responses,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/responses/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findResponse(
    @WorkspaceId() id: number,
      @Param('testPerson') testPerson: string,
      @Param('unitId') unitId: string
  ): Promise<{
        responses: {
          id: string;
          content: { id: string; value: string; status: string }[];
        }[];
      }> {
    return this.workspaceTestResultsService.findUnitResponse(
      id,
      testPerson,
      unitId
    );
  }

  @Get(':workspace_id/coding/responses/:status')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'status', type: String })
  @ApiOkResponse({
    description: 'Responses with the specified status retrieved successfully.'
  })
  async getResponsesByStatus(
    @WorkspaceId() workspace_id: number,
      @Param('status') status: string,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 20
  ): Promise<{
        data: ResponseEntity[];
        total: number;
        page: number;
        limit: number;
      }> {
    const [responses, total] =
      await this.workspaceTestResultsService.getResponsesByStatus(
        workspace_id,
        status,
        { page, limit }
      );
    return {
      data: responses,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/responses/search')
  @ApiOperation({
    summary: 'Search for responses',
    description:
      'Searches for responses across all test persons in a workspace by value, variable ID, unit name, booklet name, and other filters'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Responses retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to search for responses' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async searchResponses(
    @Param('workspace_id') workspace_id: number,
      @Query('value') value?: string,
      @Query('variableId') variableId?: string,
      @Query('unitName') unitName?: string,
      @Query('bookletName') bookletName?: string,
      @Query('status') status?: string,
      @Query('codedStatus') codedStatus?: string,
      @Query('group') group?: string,
      @Query('code') code?: string,
      @Query('version') version?: 'v1' | 'v2' | 'v3',
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<ResponseSearchResult> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    try {
      return await this.workspaceTestResultsService.searchResponses(
        workspace_id,
        {
          value,
          variableId,
          unitName,
          bookletName,
          status,
          codedStatus,
          group,
          code,
          version
        },
        { page, limit }
      );
    } catch (error) {
      logger.error(`Error searching for responses: ${error}`);
      throw new BadRequestException(
        `Failed to search for responses. ${error.message}`
      );
    }
  }
}
