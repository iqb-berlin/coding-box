import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { logger } from 'nx/src/utils/logger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { UploadResultsService } from '../../database/services/upload-results.service';
import { TestResultsUploadResultDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsImportController {
  constructor(
    private uploadResults: UploadResultsService,
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

  @Post(':workspace_id/upload/results/:resultType')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload test results',
    description: 'Uploads test results (logs or responses) to a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description:
            'The ID of the workspace to which test results should be uploaded.'
  })
  @ApiParam({
    name: 'resultType',
    enum: ['logs', 'responses'],
    required: true,
    description: 'Type of results to upload (logs or responses)'
  })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary'
          },
          description: 'Result files to upload'
        }
      }
    }
  })
  @ApiTags('workspace')
  @ApiOkResponse({
    description: 'Test results successfully uploaded.',
    type: TestResultsUploadResultDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid request. Please check your input data.'
  })
  @ApiQuery({
    name: 'overwriteExisting',
    type: Boolean,
    required: false,
    description: 'Whether to overwrite existing logs/responses (default: true)'
  })
  @ApiQuery({
    name: 'personMatchMode',
    required: false,
    description:
            'Person matching mode for import (strict: group+login+code; loose: login+code). Default: strict.'
  })
  @ApiQuery({
    name: 'overwriteMode',
    required: false,
    description:
            'Overwrite mode for existing test results: skip (default), merge (insert missing only), replace (delete matching scope then import).'
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description:
            'Scope for import/overwrite: person (default, only persons included in upload) or workspace (potentially affects whole workspace).'
  })
  @ApiQuery({ name: 'groupName', required: false })
  @ApiQuery({ name: 'bookletName', required: false })
  @ApiQuery({ name: 'unitNameOrAlias', required: false })
  @ApiQuery({ name: 'variableId', required: false })
  @ApiQuery({ name: 'subform', required: false })
  async addTestResults(
    @Param('workspace_id') workspace_id: number,
      @Param('resultType') resultType: 'logs' | 'responses',
      @UploadedFiles() files: Express.Multer.File[],
      @Query('overwriteExisting') overwriteExisting?: string,
      @Query('personMatchMode') personMatchMode?: string,
      @Query('overwriteMode') overwriteMode?: string,
      @Query('scope') scope?: string,
      @Query('groupName') groupName?: string,
      @Query('bookletName') bookletName?: string,
      @Query('unitNameOrAlias') unitNameOrAlias?: string,
      @Query('variableId') variableId?: string,
      @Query('subform') subform?: string
  ): Promise<TestResultsUploadResultDto> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded.');
    }
    const shouldOverwrite = overwriteExisting !== 'false';

    logger.log(
      `Uploading test results with overwriteExisting=${shouldOverwrite}`
    );

    try {
      const mode =
                (personMatchMode || '').toLowerCase() === 'loose' ? 'loose' : undefined;
      const requestedOverwriteMode = (overwriteMode || '').toLowerCase();
      const finalOverwriteMode = (() => {
        if (!shouldOverwrite) {
          return 'skip';
        }
        if (requestedOverwriteMode === 'replace') {
          return 'replace';
        }
        if (requestedOverwriteMode === 'merge') {
          return 'merge';
        }
        return 'skip';
      })();
      const finalScope = (scope || '').toLowerCase();
      const allowedScopes = [
        'workspace',
        'person',
        'group',
        'booklet',
        'unit',
        'response'
      ] as const;
            type UploadScope = (typeof allowedScopes)[number];
            const normalizedScope: UploadScope = (
              allowedScopes as readonly string[]
            ).includes(finalScope) ?
              (finalScope as UploadScope) :
              'person';
            const result = await this.uploadResults.uploadTestResults(
              workspace_id,
              files,
              resultType,
              shouldOverwrite,
              mode,
              finalOverwriteMode,
              normalizedScope,
              {
                groupName,
                bookletName,
                unitNameOrAlias,
                variableId,
                subform
              }
            );
            await this.invalidateFlatResponseFilterOptionsCache(workspace_id);
            return result;
    } catch (error) {
      logger.error('Error uploading test results!');
      throw new BadRequestException(
        'Uploading test results failed. Please try again.'
      );
    }
  }
}
