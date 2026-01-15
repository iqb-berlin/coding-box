import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceFilesService } from '../../database/services/workspace-files.service';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto } from '../../../../../../api-dto/files/testtakers-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

@ApiTags('Admin Workspace Files - Validation')
@Controller('admin/workspace')
export class WorkspaceFilesValidationController {
  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly cacheService: CacheService,
    private readonly jobQueueService: JobQueueService
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

  @Get(':workspace_id/files/validation')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Validate test files',
    description:
            'Validates test files and returns a hierarchical view of expected files and their status'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Files validation result',
    type: FileValidationResultDto
  })
  async validateTestFiles(
    @Param('workspace_id') workspace_id: number
  ): Promise<FileValidationResultDto> {
    return this.workspaceFilesService.validateTestFiles(workspace_id);
  }

  @Get(':workspace_id/files/validate-testtakers')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Validate TestTakers',
    description:
            'Validates TestTakers XML files and checks if each person from the persons table is found'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'TestTakers validation result'
  })
  async validateTestTakers(
    @Param('workspace_id') workspace_id: number
  ): Promise<TestTakersValidationDto> {
    return this.workspaceFilesService.validateTestTakers(workspace_id);
  }

  @Get(':workspace_id/files/validate-group-responses')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Validate group responses',
    description:
            "Validates if there's at least one response for each group found in TestTakers XML files"
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
  @ApiOkResponse({
    description: 'Group responses validation result'
  })
  async validateGroupResponses(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 10
  ): Promise<{
        testTakersFound: boolean;
        groupsWithResponses: { group: string; hasResponse: boolean }[];
        allGroupsHaveResponses: boolean;
        total: number;
        page: number;
        limit: number;
      }> {
    return this.workspaceFilesService.validateGroupResponses(
      workspace_id,
      page,
      limit
    );
  }

  @Get(':workspace_id/files/validate-response-status')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Validate response status',
    description:
            'Validates if response status is one of the valid values (VALUE_CHANGED, NOT_REACHED, DISPLAYED, UNSET, PARTLY_DISPLAYED)'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Response status validation result'
  })
  async validateResponseStatus(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 10
  ): Promise<{
        data: InvalidVariableDto[];
        total: number;
        page: number;
        limit: number;
      }> {
    return this.workspaceFilesService.validateResponseStatus(
      workspace_id,
      page,
      limit
    );
  }

  @Get(':workspace_id/files/validate-duplicate-responses')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Validate duplicate responses',
    description:
            'Identifies duplicate responses (same variable ID for the same unit, booklet, and test taker)'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Duplicate responses validation result'
  })
  async validateDuplicateResponses(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 10
  ): Promise<DuplicateResponsesResultDto> {
    return this.workspaceFilesService.validateDuplicateResponses(
      workspace_id,
      page,
      limit
    );
  }

  @Get(':workspace_id/files/validate-variables')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Validate variables',
    description: 'Validates if variables in responses are defined in Unit-XMLs'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Variables validation result'
  })
  async validateVariables(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 10
  ): Promise<{
        data: InvalidVariableDto[];
        total: number;
        page: number;
        limit: number;
      }> {
    return this.workspaceFilesService.validateVariables(
      workspace_id,
      page,
      limit
    );
  }

  @Get(':workspace_id/files/validate-variable-types')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Validate variable types',
    description:
            'Validates if variable values match their defined types in Unit-XMLs'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Variable types validation result'
  })
  async validateVariableTypes(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 10
  ): Promise<{
        data: InvalidVariableDto[];
        total: number;
        page: number;
        limit: number;
      }> {
    return this.workspaceFilesService.validateVariableTypes(
      workspace_id,
      page,
      limit
    );
  }

  @Delete(':workspace_id/files/invalid-responses')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Delete invalid responses',
    description: 'Deletes invalid responses from the database'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Number of deleted responses',
    type: Number
  })
  async deleteInvalidResponses(
    @Param('workspace_id') workspace_id: number,
      @Query('responseIds') responseIds: string
  ): Promise<number> {
    const ids = responseIds.split(',').map(id => parseInt(id, 10));
    const count = await this.workspaceFilesService.deleteInvalidResponses(
      workspace_id,
      ids
    );
    if (count > 0) {
      await this.invalidateFlatResponseFilterOptionsCache(workspace_id);
    }
    return count;
  }

  @Delete(':workspace_id/files/all-invalid-responses')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Delete all invalid responses',
    description:
            'Deletes all invalid responses of a specific type from the database'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Number of deleted responses',
    type: Number
  })
  async deleteAllInvalidResponses(
    @Param('workspace_id') workspace_id: number,
      @Query('validationType')
                           validationType: 'variables' | 'variableTypes' | 'responseStatus'
  ): Promise<number> {
    const count = await this.workspaceFilesService.deleteAllInvalidResponses(
      workspace_id,
      validationType
    );
    if (count > 0) {
      await this.invalidateFlatResponseFilterOptionsCache(workspace_id);
    }
    return count;
  }

  @Post(':workspace_id/files/create-dummy-testtaker')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Create dummy testtaker file',
    description:
            'Creates a dummy testtaker file that includes all booklets in the workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Dummy testtaker file created successfully',
    type: Boolean
  })
  @ApiBadRequestResponse({
    description: 'Failed to create dummy testtaker file'
  })
  async createDummyTestTakerFile(
    @Param('workspace_id') workspace_id: number
  ): Promise<boolean> {
    return this.workspaceFilesService.createDummyTestTakerFile(workspace_id);
  }
}
