import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import Persons from '../../database/entities/persons.entity';
import {
  RequestWithUser, PersonTestResult, BookletSearchResult, UnitSearchResult
} from './dto/workspace-test-results.interfaces';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsManagementController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService,
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

  @Get(':workspace_id/test-results')
  @ApiOperation({
    summary: 'Get test results',
    description: 'Retrieves paginated test results for a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiQuery({
    name: 'searchText',
    required: false,
    description: 'Text to search for in code, group, or login fields',
    type: String
  })
  @ApiOkResponse({
    description: 'Test results retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve test results' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findTestResults(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
                                         @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
                                         @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
                                         @Query('searchText') searchText?: string
  ): Promise<{ data: Persons[]; total: number; page: number; limit: number }> {
    const [data, total] =
            await this.workspaceTestResultsService.findTestResults(workspace_id, {
              page,
              limit,
              searchText
            });
    return {
      data,
      total,
      page,
      limit
    };
  }

  @Delete(':workspace_id/test-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteTestGroups(
    @Query('testPersons') testPersonIds: string,
      @Param('workspace_id') workspaceId: string,
      @Req() req: RequestWithUser
  ): Promise<{
        success: boolean;
        report: {
          deletedPersons: string[];
          warnings: string[];
        };
      }> {
    return this.workspaceTestResultsService.deleteTestPersons(
      Number(workspaceId),
      testPersonIds,
      req.user.id
    );
  }

  @Delete(':workspace_id/units/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Delete a unit',
    description: 'Deletes a unit and all its associated responses'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'unitId',
    type: Number,
    description: 'ID of the unit to delete'
  })
  @ApiOkResponse({
    description: 'Unit deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        report: {
          type: 'object',
          properties: {
            deletedUnit: { type: 'number', nullable: true },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to delete unit' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteUnit(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Param('unitId', ParseIntPipe) unitId: number,
      @Req() req: RequestWithUser
  ): Promise<{
        success: boolean;
        report: {
          deletedUnit: number | null;
          warnings: string[];
        };
      }> {
    const result = await this.workspaceTestResultsService.deleteUnit(
      workspaceId,
      unitId,
      req.user.id
    );
    if (result?.success) {
      await this.invalidateFlatResponseFilterOptionsCache(workspaceId);
    }
    return result;
  }

  @Get(':workspace_id/test-results/:personId')
  @ApiOperation({
    summary: 'Get test results for a specific person',
    description:
            'Retrieves detailed test results for a specific person in a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({ name: 'personId', type: Number, description: 'ID of the person' })
  @ApiOkResponse({
    description: 'Test results retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve test results' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findPersonTestResults(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Param('personId', ParseIntPipe) personId: number
  ): Promise<PersonTestResult[]> {
    return this.workspaceTestResultsService.findPersonTestResults(
      personId,
      workspace_id
    );
  }

  @Delete(':workspace_id/booklets/:bookletId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Delete a booklet',
    description: 'Deletes a booklet and all its associated units and responses'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'bookletId',
    type: Number,
    description: 'ID of the booklet to delete'
  })
  @ApiOkResponse({
    description: 'Booklet deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        report: {
          type: 'object',
          properties: {
            deletedBooklet: { type: 'number', nullable: true },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to delete booklet' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteBooklet(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Param('bookletId', ParseIntPipe) bookletId: number,
      @Req() req: RequestWithUser
  ): Promise<{
        success: boolean;
        report: {
          deletedBooklet: number | null;
          warnings: string[];
        };
      }> {
    const result = await this.workspaceTestResultsService.deleteBooklet(
      workspaceId,
      bookletId,
      req.user.id
    );
    if (result?.success) {
      await this.invalidateFlatResponseFilterOptionsCache(workspaceId);
    }
    return result;
  }

  @Get(':workspace_id/booklets/search')
  @ApiOperation({
    summary: 'Search for booklets by name',
    description:
            'Searches for booklets with a specific name across all test persons in a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiQuery({
    name: 'bookletName',
    required: true,
    description: 'Name of the booklet to search for',
    type: String
  })
  @ApiOkResponse({
    description: 'Booklets retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to search for booklets' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findBookletsByName(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Query('bookletName') bookletName: string,
                                         @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
                                         @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20
  ): Promise<BookletSearchResult> {
    return this.workspaceTestResultsService.findBookletsByName(
      workspace_id,
      bookletName,
      { page, limit }
    );
  }

  @Get(':workspace_id/units/search')
  @ApiOperation({
    summary: 'Search for units by name',
    description:
            'Searches for units with a specific name across all test persons in a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiQuery({
    name: 'unitName',
    required: true,
    description: 'Name of the unit to search for',
    type: String
  })
  @ApiOkResponse({
    description: 'Units retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to search for units' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findUnitsByName(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Query('unitName') unitName: string,
                                         @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
                                         @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20
  ): Promise<UnitSearchResult> {
    return this.workspaceTestResultsService.findUnitsByName(
      workspace_id,
      unitName,
      { page, limit }
    );
  }

  @Get(':workspace_id/results/export/options')
  @ApiOperation({
    summary: 'Get export options',
    description:
            'Retrieves available options for filtering test results export (groups, booklets, units)'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Export options retrieved successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getExportOptions(@Param('workspace_id', ParseIntPipe) workspace_id: number): Promise<{
    testPersons: {
      id: number;
      code: string;
      groupName: string;
      login: string;
    }[];
    groups: string[];
    booklets: string[];
    units: string[];
  }> {
    return this.workspaceTestResultsService.getExportOptions(
      Number(workspace_id)
    );
  }
}
