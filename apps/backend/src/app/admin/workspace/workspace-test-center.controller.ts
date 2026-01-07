import {
  Controller, Get, Param, Query, UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { WorkspacesAdminFacade } from '../../workspaces/services/workspaces-admin-facade.service';
import { Result } from '../../workspaces/services/testcenter.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { TestGroupsInfoDto } from '../../../../../../api-dto/files/test-groups-info.dto';
import { ImportOptions } from '../../../../../frontend/src/app/services/import.service';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceBullQueueService } from '../../workspaces/services/workspace-bull-queue.service';

@ApiTags('Admin Workspace Test Center')
@Controller('admin/workspace')
export class WorkspaceTestCenterController {
  constructor(
    private workspacesAdminFacade: WorkspacesAdminFacade,
    private cacheService: CacheService,
    private workspaceBullQueueService: WorkspaceBullQueueService
  ) {}

  private async invalidateFlatResponseFilterOptionsCache(
    workspaceId: number
  ): Promise<void> {
    const versionKey =
      this.cacheService.generateFlatResponseFilterOptionsVersionKey(
        workspaceId
      );
    const nextVersion = await this.cacheService.incr(versionKey);
    await this.workspaceBullQueueService.addFlatResponseFilterOptionsJob(
      workspaceId,
      60000,
      {
        jobId: `flat-response-filter-options:${workspaceId}:v${nextVersion}:thr60000`,
        removeOnComplete: true,
        removeOnFail: true
      }
    );
  }

  @Get(':workspace_id/importWorkspaceFiles')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Import workspace files',
    description: 'Imports files from a test center into the workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    required: true,
    description: 'ID of the workspace'
  })
  @ApiQuery({ name: 'server', required: true, description: 'Server address' })
  @ApiQuery({
    name: 'url',
    required: true,
    description: 'URL of the test center'
  })
  @ApiQuery({
    name: 'tc_workspace',
    required: true,
    description: 'Test center workspace ID'
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Authentication token'
  })
  @ApiQuery({
    name: 'definitions',
    required: false,
    description: 'Include definitions'
  })
  @ApiQuery({
    name: 'responses',
    required: false,
    description: 'Include responses'
  })
  @ApiQuery({ name: 'logs', required: false, description: 'Include logs' })
  @ApiQuery({ name: 'player', required: false, description: 'Include player' })
  @ApiQuery({ name: 'units', required: false, description: 'Include units' })
  @ApiQuery({
    name: 'codings',
    required: false,
    description: 'Include codings'
  })
  @ApiQuery({
    name: 'testTakers',
    required: false,
    description: 'Include test takers'
  })
  @ApiQuery({
    name: 'testGroups',
    required: false,
    description: 'Include test groups'
  })
  @ApiQuery({
    name: 'booklets',
    required: false,
    description: 'Include booklets'
  })
  @ApiQuery({
    name: 'overwriteFileIds',
    required: false,
    description:
      'Semicolon-separated list of file_ids to overwrite for testFiles imports'
  })
  @ApiQuery({
    name: 'overwriteExistingLogs',
    required: false,
    description: 'Whether to overwrite existing logs',
    type: Boolean
  })
  @ApiOkResponse({ description: 'Files imported successfully', type: Object })
  @ApiBadRequestResponse({ description: 'Failed to import files' })
  async importWorkspaceFiles(
    @Param('workspace_id') workspace_id: string,
      @Query('server') server: string,
      @Query('url') url: string,
      @Query('tc_workspace') tc_workspace: string,
      @Query('token') token: string,
      @Query('definitions') definitions: string,
      @Query('responses') responses: string,
      @Query('logs') logs: string,
      @Query('player') player: string,
      @Query('units') units: string,
      @Query('codings') codings: string,
      @Query('testTakers') testTakers: string,
      @Query('testGroups') testGroups: string,
      @Query('booklets') booklets: string,
      @Query('overwriteFileIds') overwriteFileIds: string,
      @Query('overwriteExistingLogs') overwriteExistingLogs: string
  ): Promise<Result> {
    const importOptions: ImportOptions = {
      definitions: definitions,
      responses: responses,
      units: units,
      player: player,
      codings: codings,
      logs: logs,
      booklets: booklets,
      testTakers: testTakers
    };

    const overwriteLogs = overwriteExistingLogs === 'true';
    const overwriteIds = (overwriteFileIds || '')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    const result = await this.workspacesAdminFacade.importWorkspaceFiles(
      workspace_id,
      tc_workspace,
      server,
      decodeURIComponent(url),
      token,
      importOptions,
      testGroups,
      overwriteLogs,
      overwriteIds.length ? overwriteIds : undefined
    );

    if (result?.success) {
      const workspaceId = Number(workspace_id);
      if (Number.isFinite(workspaceId) && workspaceId > 0) {
        await this.invalidateFlatResponseFilterOptionsCache(workspaceId);
      }
    }

    return result;
  }

  @Get(':workspace_id/importWorkspaceFiles/testGroups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get test groups for import',
    description: 'Retrieves test groups from a test center for import'
  })
  @ApiParam({
    name: 'workspace_id',
    required: true,
    description: 'ID of the workspace'
  })
  @ApiQuery({ name: 'server', required: true, description: 'Server address' })
  @ApiQuery({
    name: 'url',
    required: true,
    description: 'URL of the test center'
  })
  @ApiQuery({
    name: 'tc_workspace',
    required: true,
    description: 'Test center workspace ID'
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Authentication token'
  })
  @ApiOkResponse({
    description: 'Test groups retrieved successfully',
    type: [TestGroupsInfoDto]
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve test groups' })
  async getImportTestcenterGroups(
    @Param('workspace_id') workspace_id: string,
      @Query('server') server: string,
      @Query('url') url: string,
      @Query('tc_workspace') tc_workspace: string,
      @Query('token') token: string
  ): Promise<TestGroupsInfoDto[]> {
    return this.workspacesAdminFacade.getTestgroups(
      workspace_id,
      tc_workspace,
      server,
      decodeURIComponent(url),
      token
    );
  }
}
