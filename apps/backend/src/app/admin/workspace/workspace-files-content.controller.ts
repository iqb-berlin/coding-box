import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceFilesService } from '../../database/services/workspace';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';

@ApiTags('Admin Workspace Files - Content')
@Controller('admin/workspace')
export class WorkspaceFilesContentController {
  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService
  ) { }

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
    description: 'Unit XML content retrieved successfully'
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
    description: 'TestTakers XML content retrieved successfully'
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
}
