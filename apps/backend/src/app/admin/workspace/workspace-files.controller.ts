import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Put
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { logger } from 'nx/src/utils/logger';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { WorkspaceFilesService, WorkspaceCoreService } from '../../database/services/workspace';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';
import { PersonService } from '../../database/services/test-results';
import { CodingStatisticsService, CodingValidationService } from '../../database/services/coding';

@ApiTags('Admin Workspace Files')
@Controller('admin/workspace')
export class WorkspaceFilesController {
  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceCoreService: WorkspaceCoreService,
    private readonly personService: PersonService,
    private readonly codingStatisticsService: CodingStatisticsService,
    private readonly codingValidationService: CodingValidationService
  ) { }

  @Get(':workspace_id/files')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get workspace files',
    description: 'Retrieves paginated files associated with a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description:
      'The unique ID of the workspace for which the files should be retrieved.'
  })
  @ApiOkResponse({
    description: 'Files retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/FilesDto' }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
        fileTypes: { type: 'array', items: { type: 'string' } }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'The requested workspace could not be found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or error fetching files.'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findFiles(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20,
                           @Query('fileType') fileType?: string,
                           @Query('fileSize') fileSize?: string,
                           @Query('searchText') searchText?: string
  ): Promise<{
        data: FilesDto[];
        total: number;
        page: number;
        limit: number;
        fileTypes: string[];
      }> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }
    try {
      const [files, total, fileTypes] =
        await this.workspaceFilesService.findFiles(workspace_id, {
          page,
          limit,
          fileType,
          fileSize,
          searchText
        });
      return {
        data: files,
        total,
        page,
        limit,
        fileTypes
      };
    } catch (error) {
      throw new BadRequestException(
        `An error occurred while fetching files for workspace ${workspace_id}: ${error.message} `
      );
    }
  }

  @Delete(':workspace_id/files')
  @ApiTags('ws admin test-files')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteTestFiles(
  @Query() query: { fileIds: string },
    @Param('workspace_id') workspace_id: number
  ) {
    const fileIds = query.fileIds.split(/[,;]/).map(id => id.trim()).filter(id => id.length > 0);
    return this.workspaceFilesService.deleteTestFiles(
      workspace_id,
      fileIds
    );
  }

  @Post(':workspace_id/persons/exclude')
  @ApiTags('ws admin test-files')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Mark persons as not to be considered',
    description:
      'Marks persons with specified logins as not to be considered in the persons database'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Persons marked as not to be considered',
    type: Boolean
  })
  async excludePersons(
    @Param('workspace_id') workspaceId: number,
      @Body() body: { logins: string[] }
  ): Promise<boolean> {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (
      !body.logins ||
      !Array.isArray(body.logins) ||
      body.logins.length === 0
    ) {
      throw new BadRequestException(
        'At least one login name must be provided.'
      );
    }

    const success = await this.personService.markPersonsAsNotConsidered(
      workspaceId,
      body.logins
    );

    if (success) {
      await this.codingStatisticsService.invalidateCache(workspaceId);
      await this.codingValidationService.invalidateIncompleteVariablesCache(
        workspaceId
      );
    }

    return success;
  }

  @Post(':workspace_id/persons/consider')
  @ApiTags('ws admin test-files')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Mark persons as considered',
    description:
      'Marks persons with specified logins as to be considered in the persons database'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({ description: 'Persons marked as considered', type: Boolean })
  async considerPersons(
    @Param('workspace_id') workspaceId: number,
      @Body() body: { logins: string[] }
  ): Promise<boolean> {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (
      !body.logins ||
      !Array.isArray(body.logins) ||
      body.logins.length === 0
    ) {
      throw new BadRequestException(
        'At least one login name must be provided.'
      );
    }

    const success = await this.personService.markPersonsAsConsidered(
      workspaceId,
      body.logins
    );

    if (success) {
      await this.codingStatisticsService.invalidateCache(workspaceId);
      await this.codingValidationService.invalidateIncompleteVariablesCache(
        workspaceId
      );
    }

    return success;
  }

  @Post(':workspace_id/upload')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload test files',
    description: 'Uploads test files to a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({
    description: 'Files uploaded successfully',
    type: TestFilesUploadResultDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or no files uploaded'
  })
  @ApiTags('workspace')
  async addTestFiles(
    @Param('workspace_id') workspaceId: number,
      @Query('overwriteExisting') overwriteExisting: string | undefined,
      @Query('overwriteFileIds') overwriteFileIds: string | undefined,
      @UploadedFiles() files: Express.Multer.File[]
  ): Promise<TestFilesUploadResultDto> {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file must be uploaded.');
    }

    try {
      const overwrite = (overwriteExisting || '').toLowerCase() === 'true';
      const overwriteIds = (overwriteFileIds || '')
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean);
      return await this.workspaceFilesService.uploadTestFiles(
        workspaceId,
        files,
        overwrite,
        overwriteIds.length > 0 ? overwriteIds : undefined
      );
    } catch (error) {
      logger.error('Error uploading test files:');
      return {
        total: Array.isArray(files) ? files.length : 0,
        uploaded: 0,
        failed: Array.isArray(files) ? files.length : 0,
        failedFiles: Array.isArray(files) ?
          files.map(f => ({
            filename: f.originalname,
            reason: 'Upload failed'
          })) :
          []
      };
    }
  }

  @Get(':workspace_id/files/:fileId/download')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Download a file',
    description: 'Downloads a specific file from a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'fileId',
    type: Number,
    description: 'ID of the file to download'
  })
  @ApiOkResponse({
    description: 'File downloaded successfully',
    type: FileDownloadDto
  })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID or file ID' })
  @ApiNotFoundResponse({ description: 'File not found' })
  @ApiTags('workspace')
  async downloadFile(
    @Param('workspace_id') workspaceId: number,
      @Param('fileId') fileId: number
  ): Promise<FileDownloadDto> {
    if (!workspaceId) {
      logger.error('Workspace ID is required.');
      throw new BadRequestException('Workspace ID is required.');
    }
    try {
      return await this.workspaceFilesService.downloadTestFile(
        workspaceId,
        fileId
      );
    } catch (error) {
      logger.error(`'Error downloading test file:' ${error} `);
      throw new InternalServerErrorException(
        'Unable to download the file. Please try again later.'
      );
    }
  }

  @Post(':workspace_id/files/download-zip')
  @HttpCode(200)
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Download all workspace files as ZIP',
    description:
      'Creates and downloads a ZIP file containing all files in the workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'ZIP file created successfully',
    schema: {
      type: 'string',
      format: 'binary'
    }
  })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or request body'
  })
  async downloadWorkspaceFilesAsZip(
    @Param('workspace_id') workspaceId: string,
      @Body() body?: { fileTypes?: string[] }
  ): Promise<StreamableFile> {
    const startTime = Date.now();
    const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB limit
    const MAX_FILE_TYPES = 100;

    // Validate and parse workspace ID
    const parsedWorkspaceId = parseInt(workspaceId, 10);
    if (
      !workspaceId ||
      Number.isNaN(parsedWorkspaceId) ||
      parsedWorkspaceId <= 0
    ) {
      logger.warn(`Invalid workspace ID provided: ${workspaceId} `);
      throw new BadRequestException('Workspace ID must be a positive integer.');
    }
    const workspaceIdNum = parsedWorkspaceId;

    // Validate and sanitize file types
    let requestedTypes: string[] = [];
    if (body?.fileTypes) {
      if (!Array.isArray(body.fileTypes)) {
        logger.warn(`Invalid fileTypes format for workspace ${workspaceId}`);
        throw new BadRequestException('fileTypes must be an array of strings.');
      }

      if (body.fileTypes.length > MAX_FILE_TYPES) {
        logger.warn(
          `Too many file types requested for workspace ${workspaceId}: ${body.fileTypes.length} `
        );
        throw new BadRequestException(
          `Maximum ${MAX_FILE_TYPES} file types allowed.`
        );
      }

      // Validate each file type is a non-empty string
      requestedTypes = body.fileTypes.filter(
        (type): type is string => typeof type === 'string' && type.trim().length > 0
      );

      if (requestedTypes.length === 0 && body.fileTypes.length > 0) {
        logger.warn(
          `Invalid file types provided for workspace ${workspaceIdNum}`
        );
        throw new BadRequestException(
          'All file types must be non-empty strings.'
        );
      }
    }

    try {
      logger.log(
        `Starting ZIP download for workspace ${workspaceIdNum} with ${requestedTypes.length} file types`
      );

      const zipBuffer =
        await this.workspaceFilesService.downloadWorkspaceFilesAsZip(
          workspaceIdNum,
          requestedTypes.length > 0 ? requestedTypes : undefined
        );

      // Validate ZIP buffer
      if (!zipBuffer || zipBuffer.length === 0) {
        logger.error(
          `Empty ZIP buffer generated for workspace ${workspaceIdNum}`
        );
        throw new InternalServerErrorException(
          'No files available to download.'
        );
      }

      if (zipBuffer.length > MAX_ZIP_SIZE) {
        logger.error(
          `ZIP file exceeds maximum size for workspace ${workspaceIdNum}: ${zipBuffer.length} bytes`
        );
        throw new InternalServerErrorException(
          'ZIP file is too large. Please select fewer file types.'
        );
      }

      const duration = Date.now() - startTime;
      logger.log(
        `ZIP download completed for workspace ${workspaceIdNum} in ${duration} ms(${zipBuffer.length} bytes)`
      );

      return new StreamableFile(zipBuffer, {
        type: 'application/zip',
        disposition: `attachment; filename = "workspace-${workspaceIdNum}-files.zip"`
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        `Error creating ZIP file for workspace ${workspaceIdNum} after ${duration} ms: ${errorMessage}${errorStack ? `\n${errorStack}` : ''
        } `
      );

      // Re-throw known exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          throw new InternalServerErrorException(
            'One or more files could not be found.'
          );
        }
        if (error.message.includes('EACCES')) {
          throw new InternalServerErrorException(
            'Permission denied accessing files.'
          );
        }
        if (error.message.includes('ENOMEM')) {
          throw new InternalServerErrorException(
            'Insufficient memory to create ZIP file.'
          );
        }
      }

      throw new InternalServerErrorException(
        'Unable to create ZIP file. Please try again later.'
      );
    }
  }

  @Get(':workspace_id/files/ignored-units')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOkResponse({ description: 'List of ignored units', type: [String] })
  async getIgnoredUnits(@Param('workspace_id') workspaceId: number): Promise<string[]> {
    return this.workspaceCoreService.getIgnoredUnits(workspaceId);
  }

  @Put(':workspace_id/files/ignored-units')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOkResponse({ description: 'Ignored units updated' })
  async updateIgnoredUnits(
    @Param('workspace_id') workspaceId: number,
      @Body() body: { ignoredUnits: string[] }
  ): Promise<void> {
    if (!body || !Array.isArray(body.ignoredUnits)) {
      throw new BadRequestException('ignoredUnits must be an array of strings');
    }
    return this.workspaceCoreService.setIgnoredUnits(workspaceId, body.ignoredUnits);
  }
}
