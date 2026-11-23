import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Put,
  ParseIntPipe, Req,
  ParseBoolPipe, DefaultValuePipe, Res
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiConflictResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBadRequestResponse,
  ApiQuery,
  getSchemaPath
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { ValidatedBody } from '../../http/validated-body.decorator';
import { FilesInListDto } from '../../../../../../api-dto/files/files-in-list.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { WorkspaceFilesService, WorkspaceCoreService } from '../../database/services/workspace';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';
import { PersonService } from '../../database/services/test-results';
import { CodingStatisticsService, CodingValidationService } from '../../database/services/coding';
import { toRegexSearchException } from '../../utils/regex-search.util';
import { WorkspaceSettingsService } from '../../workspace/workspace-settings.service';

import { WorkspaceZipDownload } from './workspace-zip-download';
import { workspaceDownloadPath } from './workspace-download-ticket';

const MAX_FILE_TYPES = 100;
const MAX_ZIP_SIZE = 500 * 1024 * 1024;

function readZipFileTypes(fileTypes?: string[]): string[] {
  if (!fileTypes) return [];
  if (!Array.isArray(fileTypes)) {
    throw new BadRequestException('File types must be an array of strings.');
  }
  if (fileTypes.length > MAX_FILE_TYPES) {
    throw new BadRequestException(`Maximum ${MAX_FILE_TYPES} file types allowed.`);
  }
  const requestedTypes = fileTypes.filter(type => typeof type === 'string' && type.trim().length > 0);
  if (!requestedTypes.length && fileTypes.length > 0) {
    throw new BadRequestException('All file types must be non-empty strings.');
  }
  return requestedTypes;
}

@ApiTags('Admin Workspace Files')
@Controller('admin/workspace')
export class WorkspaceFilesController {
  private readonly logger = new Logger(WorkspaceFilesController.name);
  private readonly zipDownload = new WorkspaceZipDownload();

  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceCoreService: WorkspaceCoreService,
    private readonly personService: PersonService,
    private readonly codingStatisticsService: CodingStatisticsService,
    private readonly codingValidationService: CodingValidationService,
    private readonly workspaceSettings: WorkspaceSettingsService
  ) { }

  @Get(':workspace_id/files')
  @ApiExtraModels(FilesInListDto)
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
          items: { $ref: getSchemaPath(FilesInListDto) }
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
    @Query('searchText') searchText?: string,
    @Query('regexSearch', new ParseBoolPipe({ optional: true })) regexSearch?: boolean
  ): Promise<{
    data: FilesInListDto[];
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
      const effectiveRegexSearch = regexSearch === true &&
        await this.workspaceSettings.isRegexSearchEnabled(workspace_id);
      const [files, total, fileTypes] =
        await this.workspaceFilesService.findFiles(workspace_id, {
          page,
          limit,
          fileType,
          fileSize,
          searchText,
          regexSearch: effectiveRegexSearch
        });
      return {
        data: files,
        total,
        page,
        limit,
        fileTypes
      };
    } catch (error) {
      const regexError = toRegexSearchException(error, 'searchText');
      if (regexError) {
        throw regexError;
      }

      throw error;
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
    @ValidatedBody('WorkspaceFilesController_excludePersons') body: RequestBody<'WorkspaceFilesController_excludePersons'>
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
    @ValidatedBody('WorkspaceFilesController_considerPersons') body: RequestBody<'WorkspaceFilesController_considerPersons'>
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
    @Query('overwriteExisting', new ParseBoolPipe({ optional: true })) overwriteExisting: boolean | undefined,
    @Query('overwriteFileIds') overwriteFileIds: string | undefined,
    @UploadedFiles() files: Express.Multer.File[]
  ): Promise<TestFilesUploadResultDto> {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file must be uploaded.');
    }

    const overwrite = overwriteExisting === true;
    const overwriteIds = (overwriteFileIds || '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);
    return this.workspaceFilesService.uploadTestFiles(
      workspaceId,
      files,
      overwrite,
      overwriteIds.length > 0 ? overwriteIds : undefined
    );
  }

  @Get(':workspace_id/files/:fileId/metadata')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read a workspace metadata resource' })
  @ApiOkResponse({ type: FileDownloadDto })
  @ApiNotFoundResponse({ description: 'Metadata resource not found in this workspace' })
  async readMetadataFile(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Param('fileId', ParseIntPipe) fileId: number
  ): Promise<FileDownloadDto> {
    return this.workspaceFilesService.readMetadataFile(workspaceId, fileId);
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
      this.logger.error('Workspace ID is required.');
      throw new BadRequestException('Workspace ID is required.');
    }
    try {
      return await this.workspaceFilesService.downloadTestFile(
        workspaceId,
        fileId
      );
    } catch (error) {
      this.logger.error(`'Error downloading test file:' ${error} `);
      throw error;
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
    description: 'ZIP file or segment with X-Archive-Range and X-Archive-Id headers',
    schema: {
      type: 'string',
      format: 'binary'
    }
  })
  @ApiQuery({ name: 'segmented', required: false, type: Boolean })
  @ApiQuery({ name: 'prepare', required: false, type: Boolean })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or request body'
  })
  async downloadWorkspaceFilesAsZip(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('segmented', new DefaultValuePipe(false), ParseBoolPipe) segmented: boolean,
    @Query('prepare', new DefaultValuePipe(false), ParseBoolPipe) prepare: boolean,
    @ValidatedBody('WorkspaceFilesController_downloadWorkspaceFilesAsZip', true) body?: RequestBody<'WorkspaceFilesController_downloadWorkspaceFilesAsZip'>
  ): Promise<StreamableFile | { id: string }> {
    if (workspaceId <= 0) {
      throw new BadRequestException('Workspace ID must be a positive integer.');
    }
    const startTime = Date.now();
    const requestedTypes = readZipFileTypes(body?.fileTypes);

    let zipBuffer: Buffer;
    try {
      this.logger.log(
        `Starting ZIP download for workspace ${workspaceId} with ${requestedTypes.length} file types`
      );

      zipBuffer =
        await this.workspaceFilesService.downloadWorkspaceFilesAsZip(
          workspaceId,
          requestedTypes.length > 0 ? requestedTypes : undefined
        );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        ` Error creating ZIP file for workspace ${workspaceId} after ${duration} ms: ${errorMessage}${errorStack ? `\n${errorStack}` : ''
        } `
      );

      // Re-throw generic exceptions if needed, though they aren't caught locally anymore.
      throw error;
    }

    // Validate ZIP buffer outside try/catch
    if (!zipBuffer || zipBuffer.length === 0) {
      this.logger.error(
        `Empty ZIP buffer generated for workspace ${workspaceId}`
      );
      throw new InternalServerErrorException(
        'No files available to download.'
      );
    }

    if (zipBuffer.length > MAX_ZIP_SIZE) {
      this.logger.error(
        `ZIP file exceeds maximum size for workspace ${workspaceId}: ${zipBuffer.length} bytes`
      );
      throw new InternalServerErrorException(
        'ZIP file is too large. Please select fewer file types.'
      );
    }

    this.logger.log(
      `ZIP download completed for workspace ${workspaceId} in ${Date.now() - startTime} ms(${zipBuffer.length} bytes)`
    );

    if (prepare) {
      return this.zipDownload.prepare(workspaceId, zipBuffer, workspaceDownloadPath(request), response);
    }
    return this.zipDownload.start(workspaceId, zipBuffer, segmented, response);
  }

  @Get(':workspace_id/files/download-zip/:archiveId/download')
  @ApiOperation({ summary: 'Download a prepared workspace ZIP using its download cookie' })
  downloadPreparedWorkspaceZip(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Param('archiveId') archiveId: string,
    @Req() request: Request,
    @Res() response: Response
  ): void {
    this.zipDownload.download(workspaceId, archiveId, workspaceDownloadPath(request), request.get('cookie'), response);
  }

  @Get(':workspace_id/files/download-zip/:archiveId')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({ summary: 'Download the next segment of a workspace ZIP' })
  @ApiQuery({ name: 'offset', required: true, type: Number })
  @ApiOkResponse({
    description: 'ZIP segment with X-Archive-Range and X-Archive-Id headers',
    schema: { type: 'string', format: 'binary' }
  })
  downloadWorkspaceZipSegment(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
    @Param('archiveId') archiveId: string,
    @Query('offset', ParseIntPipe) offset: number,
    @Res({ passthrough: true }) response: Response
  ): StreamableFile {
    return this.zipDownload.segment(workspaceId, archiveId, offset, response);
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
  @ApiConflictResponse({
    description: 'Workspace settings are currently locked by another mutation.'
  })
  async updateIgnoredUnits(
    @Param('workspace_id') workspaceId: number,
    @ValidatedBody('WorkspaceFilesController_updateIgnoredUnits') body: RequestBody<'WorkspaceFilesController_updateIgnoredUnits'>,
    @Req() request?: { user: { id: number } }
  ): Promise<void> {
    if (!body || !Array.isArray(body.ignoredUnits)) {
      throw new BadRequestException('ignoredUnits must be an array of strings');
    }
    return this.workspaceCoreService.setIgnoredUnits(workspaceId, body.ignoredUnits, request?.user.id);
  }

  @Get(':workspace_id/settings')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOkResponse({ description: 'Workspace Settings returned' })
  async getWorkspaceSettings(@Param('workspace_id') workspaceId: number) {
    return this.workspaceCoreService.getWorkspaceSettings(workspaceId);
  }

  @Put(':workspace_id/settings')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOkResponse({ description: 'Workspace Settings updated' })
  @ApiConflictResponse({
    description: 'Workspace settings are currently locked by another mutation.'
  })
  async updateWorkspaceSettings(
    @Param('workspace_id') workspaceId: number,
    @ValidatedBody('WorkspaceSettingsDto') body: RequestBody<'WorkspaceSettingsDto'>,
    @Req() request?: { user: { id: number } }
  ): Promise<void> {
    if (!body) {
      throw new BadRequestException('Request body is required');
    }
    return this.workspaceCoreService.setWorkspaceSettings(workspaceId, body, request?.user.id);
  }
}
