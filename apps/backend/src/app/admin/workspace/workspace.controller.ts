import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  ParseArrayPipe,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation, ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { logger } from 'nx/src/utils/logger';
import { WorkspaceInListDto } from '../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';
import { WorkspaceCoreService } from '../../database/services/workspace';
import { WorkspaceId } from './workspace.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AdminGuard } from '../admin.guard';
import { AccessRightsMatrixService } from './access-rights-matrix.service';
import { AccessRightsMatrixDto } from '../../../../../../api-dto/workspaces/access-rights-matrix-dto';

@ApiTags('Admin Workspace')
@Controller('admin/workspace')
export class WorkspaceController {
  constructor(
    private workspaceCoreService: WorkspaceCoreService,
    private accessRightsMatrixService: AccessRightsMatrixService
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiTags('admin workspaces')
  @ApiOperation({ summary: 'Get all workspaces', description: 'Retrieves a paginated list of all admin workspaces' })
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
    description: 'List of admin workspaces retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/WorkspaceInListDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve admin workspaces' })
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20
  ): Promise<{ data: WorkspaceInListDto[]; total: number; page: number; limit: number }> {
    try {
      const [workspaces, total] = await this.workspaceCoreService.findAll({ page, limit });
      return {
        data: workspaces,
        total,
        page,
        limit
      };
    } catch (error) {
      throw new BadRequestException('Failed to retrieve admin workspaces. Please try again later.');
    }
  }

  @Get('access-rights-matrix')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get access rights matrix',
    description: 'Retrieves the complete access rights matrix showing which features each access level can access'
  })
  @ApiOkResponse({
    description: 'Access rights matrix retrieved successfully.',
    type: AccessRightsMatrixDto
  })
  @ApiTags('admin workspaces')
  async getAccessRightsMatrix(): Promise<AccessRightsMatrixDto> {
    return this.accessRightsMatrixService.getAccessRightsMatrix();
  }

  @Get(':workspace_id')
  @ApiBearerAuth()
  @ApiTags('admin workspaces')
  @ApiOkResponse({
    description: 'Admin workspace retrieved successfully.',
    type: WorkspaceFullDto
  })
  @ApiNotFoundResponse({ description: 'Admin workspace not found.' })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID.' })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'Unique identifier of the workspace'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findOne(@WorkspaceId() id: number): Promise<WorkspaceFullDto> {
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid workspace ID.');
    }
    try {
      const workspace = await this.workspaceCoreService.findOne(id);
      if (!workspace) {
        logger.error('Admin workspace not found.');
      }
      return workspace;
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve workspace: ${error.message}`);
    }
  }

  @Delete()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete workspaces',
    description: 'Deletes one or more workspaces by their IDs (separated by semicolons)'
  })
  @ApiQuery({
    name: 'ids',
    description: 'Semicolon-separated list of workspace IDs to delete',
    example: '1;2;3',
    type: String
  })
  @ApiOkResponse({ description: 'Admin workspaces deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Admin workspace not found.' })
  @ApiBadRequestResponse({ description: 'Invalid workspace IDs' })
  @ApiTags('admin workspaces')
  async remove(@Query('ids', new ParseArrayPipe({ items: Number, separator: ';' })) ids: number[]): Promise<void> {
    return this.workspaceCoreService.remove(ids);
  }

  @Patch()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Update workspace',
    description: 'Updates an existing workspace with the provided data'
  })
  @ApiBody({
    type: WorkspaceFullDto,
    description: 'Updated workspace data'
  })
  @ApiOkResponse({ description: 'Workspace updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid workspace data' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  @ApiTags('admin workspaces')
  async patch(@Body() workspaces: WorkspaceFullDto) {
    return this.workspaceCoreService.patch(workspaces);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new workspace', description: 'Creates a new workspace with the provided data' })
  @ApiBody({
    type: CreateWorkspaceDto,
    description: 'Workspace data to create'
  })
  @ApiCreatedResponse({
    description: 'Sends back the id of the new workspace in database',
    type: Number
  })
  @ApiBadRequestResponse({ description: 'Invalid workspace data' })
  @ApiTags('admin workspaces')
  async create(@Body() createWorkspaceDto: CreateWorkspaceDto) {
    return this.workspaceCoreService.create(createWorkspaceDto);
  }
}
