import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFiles
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { logger } from 'nx/src/utils/logger';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { WorkspaceFilesService } from '../../workspaces/services/workspace-files.service';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto } from '../../../../../../api-dto/files/testtakers-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';
import { PersonService } from '../../workspaces/services/person.service';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';
import { CodingStatisticsService } from '../../coding/services/coding-statistics.service';
import { WorkspaceCodingService } from '../../coding/services/workspace-coding.service';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceBullQueueService } from '../../workspaces/services/workspace-bull-queue.service';

@ApiTags('Admin Workspace Files')
@Controller('admin/workspace')
export class WorkspaceFilesController {
  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly personService: PersonService,
    private readonly codingStatisticsService: CodingStatisticsService,
    private readonly workspaceCodingService: WorkspaceCodingService,
    private readonly cacheService: CacheService,
    private readonly workspaceBullQueueService: WorkspaceBullQueueService
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
    name: 'fileType',
    required: false,
    description: 'Filter by file type',
    type: String
  })
  @ApiQuery({
    name: 'fileSize',
    required: false,
    description:
      'Filter by file size range (e.g. 0-10KB, 10KB-100KB, 100KB-1MB, 1MB-10MB, 10MB+)',
    type: String
  })
  @ApiQuery({
    name: 'searchText',
    required: false,
    description: 'Filter by search text (filename, type, date)',
    type: String
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
        `An error occurred while fetching files for workspace ${workspace_id}: ${error.message}`
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
    return this.workspaceFilesService.deleteTestFiles(
      workspace_id,
      query.fileIds.split(';')
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
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        logins: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of login names to mark as not to be considered'
        }
      }
    }
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
      await this.workspaceCodingService.invalidateIncompleteVariablesCache(
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
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        logins: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of login names to mark as considered'
        }
      }
    }
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
      await this.workspaceCodingService.invalidateIncompleteVariablesCache(
        workspaceId
      );
    }

    return success;
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
  @ApiQuery({
    name: 'excludeModes',
    type: String,
    required: false,
    description:
      'Comma-separated list of modes to exclude from filtering (e.g., "run-hot-return,run-hot-restart,run-trial")'
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
        .split(';')
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
      logger.error(`'Error downloading test file:' ${error}`);
      throw new InternalServerErrorException(
        'Unable to download the file. Please try again later.'
      );
    }
  }

  @Get(':workspace_id/unit/:unit_id/content')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get unit XML content',
    description: 'Retrieves the XML content of a unit file'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The unique ID of the workspace'
  })
  @ApiParam({
    name: 'unit_id',
    type: Number,
    required: true,
    description: 'The unique ID of the unit'
  })
  @ApiOkResponse({
    description: 'Unit XML content retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Unit not found'
  })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or unit ID'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getUnitContent(
    @Param('workspace_id') workspace_id: number,
      @Param('unit_id') unit_id: number
  ): Promise<{ content: string }> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }
    if (!unit_id || unit_id <= 0) {
      throw new BadRequestException(
        'Invalid unit ID. Please provide a valid ID.'
      );
    }

    try {
      const content = await this.workspaceFilesService.getUnitContent(
        workspace_id,
        unit_id
      );
      return { content };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(
          `Unit with ID ${unit_id} not found in workspace ${workspace_id}`
        );
      }
      throw new InternalServerErrorException(
        `Error retrieving unit content: ${error.message}`
      );
    }
  }

  @Get(':workspace_id/files/testtakers/:testtaker_id/content')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get TestTakers XML content',
    description: 'Retrieves the XML content of a TestTakers file by its file_id'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The unique ID of the workspace'
  })
  @ApiParam({
    name: 'testtaker_id',
    type: String,
    required: true,
    description: 'The file_id of the TestTakers file'
  })
  @ApiOkResponse({
    description: 'TestTakers XML content retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'TestTakers file not found' })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or TestTakers file_id'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getTestTakerContent(
    @Param('workspace_id') workspace_id: number,
      @Param('testtaker_id') testtaker_id: string
  ): Promise<{ content: string }> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }

    if (!testtaker_id) {
      throw new BadRequestException(
        'Invalid TestTakers file_id. Please provide a valid id.'
      );
    }

    try {
      const content = await this.workspaceFilesService.getTestTakerContent(
        workspace_id,
        testtaker_id
      );
      return { content };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(
          `TestTakers file with id ${testtaker_id} not found in workspace ${workspace_id}`
        );
      }

      throw new InternalServerErrorException(
        `Error retrieving TestTakers content: ${error.message}`
      );
    }
  }

  @Get(':workspace_id/files/coding-scheme/:coding_scheme_ref')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding scheme file',
    description: 'Retrieves a coding scheme file by its reference name'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The unique ID of the workspace'
  })
  @ApiParam({
    name: 'coding_scheme_ref',
    type: String,
    required: true,
    description: 'The reference name of the coding scheme'
  })
  @ApiOkResponse({
    description: 'Coding scheme file retrieved successfully',
    type: FileDownloadDto
  })
  @ApiNotFoundResponse({
    description: 'Coding scheme file not found'
  })
  @ApiBadRequestResponse({
    description: 'Invalid workspace ID or coding scheme reference'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getCodingSchemeFile(
    @Param('workspace_id') workspace_id: number,
      @Param('coding_scheme_ref') coding_scheme_ref: string
  ): Promise<FileDownloadDto> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }
    if (!coding_scheme_ref) {
      throw new BadRequestException(
        'Invalid coding scheme reference. Please provide a valid reference.'
      );
    }

    try {
      return await this.workspaceFilesService.getCodingSchemeByRef(
        workspace_id,
        coding_scheme_ref
      );
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error retrieving coding scheme file: ${error.message}`
      );
    }
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
    description: 'Group responses validation result',
    schema: {
      type: 'object',
      properties: {
        testTakersFound: { type: 'boolean' },
        groupsWithResponses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string' },
              hasResponse: { type: 'boolean' }
            }
          }
        },
        allGroupsHaveResponses: { type: 'boolean' },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
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
    description: 'Response status validation result',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/InvalidVariableDto' }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
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
    description: 'Duplicate responses validation result',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              unitId: { type: 'number' },
              variableId: { type: 'string' },
              bookletName: { type: 'string' },
              testTakerLogin: { type: 'string' },
              duplicates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    responseId: { type: 'number' },
                    value: { type: 'string' },
                    status: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
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
    description: 'Variables validation result',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/InvalidVariableDto' }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
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
    description: 'Variable types validation result',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/InvalidVariableDto' }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
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
  @ApiQuery({
    name: 'responseIds',
    type: String,
    description: 'Comma-separated list of response IDs to delete'
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
  @ApiQuery({
    name: 'validationType',
    enum: ['variables', 'variableTypes', 'responseStatus'],
    description: 'Type of validation to use for identifying invalid responses'
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

  @Get(':workspace_id/files/units-with-file-ids')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get units with file IDs',
    description:
      'Retrieves a list of units with file_type "Unit" and their file IDs'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Units with file IDs retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitId: { type: 'string' },
          fileName: { type: 'string' }
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve units with file IDs'
  })
  async getUnitsWithFileIds(
    @Param('workspace_id') workspace_id: number
  ): Promise<{ unitId: string; fileName: string }[]> {
    return this.workspaceFilesService.getUnitsWithFileIds(workspace_id);
  }

  @Get(':workspace_id/files/unit-variables')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get unit variables with details',
    description:
      'Retrieves detailed information about all units and their variables from Unit XML files, including types and coding scheme references. Units with no variables are excluded.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Unit variables details retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Name of the unit' },
          unitId: { type: 'string', description: 'ID of the unit' },
          variables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Variable ID' },
                alias: { type: 'string', description: 'Variable alias' },
                type: {
                  type: 'string',
                  description:
                    'Variable type (string, integer, number, boolean, etc.)'
                },
                hasCodingScheme: {
                  type: 'boolean',
                  description: 'Whether the unit has a coding scheme'
                },
                codingSchemeRef: {
                  type: 'string',
                  description: 'Coding scheme filename (if exists)'
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve unit variables details'
  })
  async getUnitVariables(
    @Param('workspace_id') workspace_id: number
  ): Promise<UnitVariableDetailsDto[]> {
    if (!workspace_id) {
      throw new BadRequestException('Workspace ID is required.');
    }

    return this.workspaceFilesService.getUnitVariableDetails(workspace_id);
  }

  @Get(':workspace_id/files/variable-info/:scheme_file_id')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get variable info for scheme',
    description:
      'Retrieves variable information from Unit files for a specific scheme file ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'scheme_file_id',
    type: String,
    description: 'ID of the scheme file'
  })
  @ApiOkResponse({
    description: 'Variable information retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          alias: { type: 'string' },
          type: { type: 'string' },
          multiple: { type: 'boolean' },
          nullable: { type: 'boolean' },
          values: { type: 'array', items: { type: 'string' } },
          valuesComplete: { type: 'boolean' },
          page: { type: 'string' }
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve variable information'
  })
  async getVariableInfoForScheme(
    @Param('workspace_id') workspace_id: number,
      @Param('scheme_file_id') scheme_file_id: string
  ): Promise<VariableInfo[]> {
    return this.workspaceFilesService.getVariableInfoForScheme(
      workspace_id,
      scheme_file_id
    );
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
  @ApiBody({
    description: 'Optional file types to include in the ZIP',
    required: false,
    schema: {
      type: 'object',
      properties: {
        fileTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file types to include'
        }
      }
    }
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
      logger.warn(`Invalid workspace ID provided: ${workspaceId}`);
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
          `Too many file types requested for workspace ${workspaceId}: ${body.fileTypes.length}`
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
        `ZIP download completed for workspace ${workspaceIdNum} in ${duration}ms (${zipBuffer.length} bytes)`
      );

      return new StreamableFile(zipBuffer, {
        type: 'application/zip',
        disposition: `attachment; filename="workspace-${workspaceIdNum}-files.zip"`
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        `Error creating ZIP file for workspace ${workspaceIdNum} after ${duration}ms: ${errorMessage}${
          errorStack ? `\n${errorStack}` : ''
        }`
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
}
