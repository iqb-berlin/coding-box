import {
  BadRequestException,
  Controller,
  Delete,
  Get, InternalServerErrorException, NotFoundException, Param, Post, Query, UseGuards, UseInterceptors, UploadedFiles
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
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto } from '../../../../../../api-dto/files/testtakers-validation.dto';

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
  @ApiQuery({
    name: 'fileType',
    required: false,
    description: 'Filter by file type',
    type: String
  })
  @ApiQuery({
    name: 'fileSize',
    required: false,
    description: 'Filter by file size range (e.g. 0-10KB, 10KB-100KB, 100KB-1MB, 1MB-10MB, 10MB+)',
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
        data: { type: 'array', items: { $ref: '#/components/schemas/FilesDto' } },
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findFiles(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20,
                           @Query('fileType') fileType?: string,
                           @Query('fileSize') fileSize?: string,
                           @Query('searchText') searchText?: string
  ): Promise<{ data: FilesDto[]; total: number; page: number; limit: number; fileTypes: string[] }> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }
    try {
      const [files, total, fileTypes] = await this.workspaceFilesService.findFiles(workspace_id, {
        page, limit, fileType, fileSize, searchText
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
  @ApiOperation({ summary: 'Upload test files', description: 'Uploads test files to a workspace' })
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
  @ApiOkResponse({ description: 'Files uploaded successfully', type: Boolean })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID or no files uploaded' })
  @ApiTags('workspace')
  async addTestFiles(
    @Param('workspace_id') workspaceId: number,
      @UploadedFiles() files: Express.Multer.File[]
  ): Promise<boolean> {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file must be uploaded.');
    }

    try {
      return await this.workspaceFilesService.uploadTestFiles(workspaceId, files);
    } catch (error) {
      logger.error('Error uploading test files:');
      return false;
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

  @Get(':workspace_id/unit/:unit_id/content')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get unit XML content', description: 'Retrieves the XML content of a unit file' })
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
      throw new BadRequestException('Invalid workspace ID. Please provide a valid ID.');
    }
    if (!unit_id || unit_id <= 0) {
      throw new BadRequestException('Invalid unit ID. Please provide a valid ID.');
    }

    try {
      const content = await this.workspaceFilesService.getUnitContent(workspace_id, unit_id);
      return { content };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(`Unit with ID ${unit_id} not found in workspace ${workspace_id}`);
      }
      throw new InternalServerErrorException(`Error retrieving unit content: ${error.message}`);
    }
  }

  @Get(':workspace_id/files/coding-scheme/:coding_scheme_ref')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coding scheme file', description: 'Retrieves a coding scheme file by its reference name' })
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
      throw new BadRequestException('Invalid workspace ID. Please provide a valid ID.');
    }
    if (!coding_scheme_ref) {
      throw new BadRequestException('Invalid coding scheme reference. Please provide a valid reference.');
    }

    try {
      const codingSchemeFile = await this.workspaceFilesService.getCodingSchemeByRef(workspace_id, coding_scheme_ref);

      if (!codingSchemeFile) {
        throw new NotFoundException(`Coding scheme file '${coding_scheme_ref}' not found in workspace ${workspace_id}`);
      }

      return codingSchemeFile;
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      throw new InternalServerErrorException(`Error retrieving coding scheme file: ${error.message}`);
    }
  }

  @Get(':workspace_id/files/validate-testtakers')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Validate TestTakers', description: 'Validates TestTakers XML files and checks if each person from the persons table is found' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiOkResponse({
    description: 'TestTakers validation result'
  })
  async validateTestTakers(
    @Param('workspace_id') workspace_id: number): Promise<TestTakersValidationDto> {
    return this.workspaceFilesService.validateTestTakers(workspace_id);
  }

  @Get(':workspace_id/files/validate-group-responses')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Validate group responses', description: 'Validates if there\'s at least one response for each group found in TestTakers XML files' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
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
        allGroupsHaveResponses: { type: 'boolean' }
      }
    }
  })
  async validateGroupResponses(
    @Param('workspace_id') workspace_id: number
  ): Promise<{ testTakersFound: boolean; groupsWithResponses: { group: string; hasResponse: boolean }[]; allGroupsHaveResponses: boolean }> {
    return this.workspaceFilesService.validateGroupResponses(workspace_id);
  }

  @Get(':workspace_id/files/validate-response-status')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Validate response status', description: 'Validates if response status is one of the valid values (VALUE_CHANGED, NOT_REACHED, DISPLAYED, UNSET, PARTLY_DISPLAYED)' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
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
        data: { type: 'array', items: { $ref: '#/components/schemas/InvalidVariableDto' } },
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
  ): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    return this.workspaceFilesService.validateResponseStatus(workspace_id, page, limit);
  }

  @Get(':workspace_id/files/validate-variables')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Validate variables', description: 'Validates if variables in responses are defined in Unit-XMLs' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
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
        data: { type: 'array', items: { $ref: '#/components/schemas/InvalidVariableDto' } },
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
  ): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    return this.workspaceFilesService.validateVariables(workspace_id, page, limit);
  }

  @Get(':workspace_id/files/validate-variable-types')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Validate variable types', description: 'Validates if variable values match their defined types in Unit-XMLs' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
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
        data: { type: 'array', items: { $ref: '#/components/schemas/InvalidVariableDto' } },
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
  ): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    return this.workspaceFilesService.validateVariableTypes(workspace_id, page, limit);
  }

  @Delete(':workspace_id/files/invalid-responses')
  @ApiTags('test files validation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Delete invalid responses', description: 'Deletes invalid responses from the database' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiQuery({ name: 'responseIds', type: String, description: 'Comma-separated list of response IDs to delete' })
  @ApiOkResponse({
    description: 'Number of deleted responses',
    type: Number
  })
  async deleteInvalidResponses(
    @Param('workspace_id') workspace_id: number,
      @Query('responseIds') responseIds: string): Promise<number> {
    const ids = responseIds.split(',').map(id => parseInt(id, 10));
    return this.workspaceFilesService.deleteInvalidResponses(workspace_id, ids);
  }
}
