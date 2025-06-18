import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get, InternalServerErrorException, Param, Post, Query, UseGuards, UseInterceptors, UploadedFiles
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth, ApiBody, ApiConsumes, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { logger } from 'nx/src/utils/logger';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { WorkspaceFilesService } from '../../database/services/workspace-files.service';
import { TestResultValidationDto } from '../../../../../../api-dto/test-groups/test-result-validation.dto';

@ApiTags('Admin Workspace Files')
@Controller('admin/workspace')
export class WorkspaceFilesController {
  constructor(
    private workspaceFilesService: WorkspaceFilesService
  ) {}

  @Get(':workspace_id/files')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get workspace files', description: 'Retrieves paginated files associated with a workspace' })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The unique ID of the workspace for which the files should be retrieved.'
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
    description: 'Files retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/FilesDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'The requested workspace could not be found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or error fetching files.'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findFiles(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20
  ): Promise<{ data: FilesDto[]; total: number; page: number; limit: number }> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }
    try {
      const [files, total] = await this.workspaceFilesService.findFiles(workspace_id, { page, limit });
      return {
        data: files,
        total,
        page,
        limit
      };
    } catch (error) {
      throw new BadRequestException(
        `An error occurred while fetching files for workspace ${workspace_id}: ${error.message}`
      );
    }
  }

  @Delete(':workspace_id/files')
  @ApiTags('ws admin test-files')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteTestFiles(@Query() query: { fileIds: string },
    @Param('workspace_id') workspace_id: number) {
    return this.workspaceFilesService.deleteTestFiles(workspace_id, query.fileIds.split(';'));
  }

  @Get(':workspace_id/files/validation')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Validate test files', description: 'Validates test files and returns a hierarchical view of expected files and their status' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiOkResponse({
    description: 'Files validation result',
    type: FileValidationResultDto
  })
  async validateTestFiles(
    @Param('workspace_id') workspace_id: number): Promise<FileValidationResultDto> {
    return this.workspaceFilesService.validateTestFiles(workspace_id);
  }

  @Post(':workspace_id/upload')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload test files', description: 'Uploads test files to a workspace and returns validation results' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
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
          }
        }
      }
    }
  })
  @ApiOkResponse({ description: 'Files uploaded and validated successfully', type: FileValidationResultDto })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID, no files uploaded, or upload/validation failed' })
  @ApiTags('workspace')
  async addTestFiles(
    @Param('workspace_id') workspaceId: number,
      @UploadedFiles() files: Express.Multer.File[]
  ): Promise<FileValidationResultDto | boolean> { // Return type updated
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file must be uploaded.');
    }

    try {
      return await this.workspaceFilesService.uploadTestFiles(workspaceId, files);
    } catch (error) {
      throw new InternalServerErrorException('Error uploading or validating test files.');
    }
  }

  @Get(':workspace_id/files/:fileId/download')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Download a file', description: 'Downloads a specific file from a workspace' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'fileId', type: Number, description: 'ID of the file to download' })
  @ApiOkResponse({
    description: 'File downloaded successfully',
    type: FileDownloadDto
  })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID or file ID' })
  @ApiNotFoundResponse({ description: 'File not found' })
  @ApiTags('workspace')
  async downloadFile(
    @Param('workspace_id') workspaceId: number, @Param('fileId') fileId: number
  ): Promise<FileDownloadDto> {
    if (!workspaceId) {
      logger.error('Workspace ID is required.');
      throw new BadRequestException('Workspace ID is required.');
    }
    try {
      return await this.workspaceFilesService.downloadTestFile(workspaceId, fileId);
    } catch (error) {
      logger.error(`'Error downloading test file:' ${error}`);
      throw new InternalServerErrorException('Unable to download the file. Please try again later.');
    }
  }

  @Get(':workspace_id/test-results/validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate test results against unit definitions' })
  @ApiParam({ name: 'workspace_id', type: Number, required: true })
  @ApiOkResponse({
    description: 'Returns a list of validation errors for test results.',
    type: [TestResultValidationDto]
  })
  async validateTestResults(
    @Param('workspace_id') workspaceId: number
  ): Promise<TestResultValidationDto[]> {
    return this.workspaceFilesService.validateTestResults(workspaceId);
  }

  @Delete(':workspace_id/test-results/by-ids')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete test results by their IDs' })
  @ApiParam({ name: 'workspace_id', type: Number, required: true })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' } } } } })
  @ApiOkResponse({ description: 'Test results deleted successfully.', type: Boolean })
  async deleteTestResultsByIds(
    @Param('workspace_id') workspaceId: number, // Keep for guard
      @Body('ids') ids: number[]
  ): Promise<boolean> {
    return this.workspaceFilesService.deleteTestResults(ids);
  }
}
