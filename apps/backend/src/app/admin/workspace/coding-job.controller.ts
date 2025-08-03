import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
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
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingJob } from '../../database/entities/coding-job.entity';
import WorkspaceUser from '../../database/entities/workspace_user.entity';

@ApiTags('Admin Workspace Coding Jobs')
@Controller('admin/workspace')
export class CodingJobController {
  constructor(
    private codingJobService: CodingJobService
  ) {}

  @Post(':workspace_id/coding-jobs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a coding job', description: 'Creates a new coding job in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the coding job' },
        description: { type: 'string', description: 'Description of the coding job' },
        variableBundleIds: { type: 'array', items: { type: 'number' }, description: 'IDs of variable bundles to include' },
        variableBundleGroupIds: { type: 'array', items: { type: 'number' }, description: 'IDs of variable bundle groups to include' }
      }
    }
  })
  @ApiCreatedResponse({ description: 'Coding job created successfully', type: CodingJob })
  @ApiBadRequestResponse({ description: 'Invalid input parameters' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async createCodingJob(
    @Param('workspace_id') workspaceId: number,
      @Body() body: {
        name: string;
        description?: string;
        variableBundleIds?: number[];
        variableBundleGroupIds?: number[];
      }
  ): Promise<CodingJob> {
    if (!body.name) {
      throw new BadRequestException('Name is required');
    }

    return this.codingJobService.createCodingJob(
      workspaceId,
      body.name,
      body.description,
      body.variableBundleIds || [],
      body.variableBundleGroupIds || []
    );
  }

  @Get(':workspace_id/coding-jobs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coding jobs', description: 'Gets all coding jobs in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiQuery({
    name: 'page', required: false, description: 'Page number for pagination', type: Number
  })
  @ApiQuery({
    name: 'limit', required: false, description: 'Number of items per page', type: Number
  })
  @ApiOkResponse({
    description: 'Coding jobs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/CodingJob' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getCodingJobs(
    @Param('workspace_id') workspaceId: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20
  ): Promise<{ data: CodingJob[]; total: number; page: number; limit: number }> {
    const [jobs, total] = await this.codingJobService.getCodingJobs(workspaceId, { page, limit });
    return {
      data: jobs,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/coding-jobs/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a coding job', description: 'Gets a coding job by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the coding job' })
  @ApiOkResponse({ description: 'Coding job retrieved successfully', type: CodingJob })
  @ApiNotFoundResponse({ description: 'Coding job not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getCodingJob(
    @Param('workspace_id') workspaceId: number,
      @Param('id') id: number
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobService.getCodingJob(workspaceId, id);
    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }
    return codingJob;
  }

  @Put(':workspace_id/coding-jobs/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a coding job', description: 'Updates a coding job by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the coding job' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the coding job' },
        description: { type: 'string', description: 'Description of the coding job' },
        status: { type: 'string', description: 'Status of the coding job' },
        variableBundleIds: { type: 'array', items: { type: 'number' }, description: 'IDs of variable bundles to include' },
        variableBundleGroupIds: { type: 'array', items: { type: 'number' }, description: 'IDs of variable bundle groups to include' }
      }
    }
  })
  @ApiOkResponse({ description: 'Coding job updated successfully', type: CodingJob })
  @ApiNotFoundResponse({ description: 'Coding job not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async updateCodingJob(
    @Param('workspace_id') workspaceId: number,
      @Param('id') id: number,
      @Body() body: {
        name?: string;
        description?: string;
        status?: string;
        variableBundleIds?: number[];
        variableBundleGroupIds?: number[];
      }
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobService.updateCodingJob(
      workspaceId,
      id,
      body.name,
      body.description,
      body.status,
      body.variableBundleIds,
      body.variableBundleGroupIds
    );
    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }
    return codingJob;
  }

  @Delete(':workspace_id/coding-jobs/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a coding job', description: 'Deletes a coding job by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the coding job' })
  @ApiOkResponse({ description: 'Coding job deleted successfully', type: Boolean })
  @ApiNotFoundResponse({ description: 'Coding job not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteCodingJob(
    @Param('workspace_id') workspaceId: number,
      @Param('id') id: number
  ): Promise<{ success: boolean }> {
    const success = await this.codingJobService.deleteCodingJob(workspaceId, id);
    if (!success) {
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }
    return { success };
  }

  @Post(':workspace_id/coding-jobs/:id/assign/:coder_id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a coder to a coding job', description: 'Assigns a coder to a coding job in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the coding job' })
  @ApiParam({ name: 'coder_id', required: true, description: 'ID of the coder' })
  @ApiOkResponse({ description: 'Coder assigned successfully', type: CodingJob })
  @ApiNotFoundResponse({ description: 'Coding job or coder not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async assignCoder(
    @Param('workspace_id') workspaceId: number,
      @Param('id') id: number,
      @Param('coder_id') coderId: number
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobService.assignCoder(workspaceId, id, coderId);
    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} or coder with ID ${coderId} not found in workspace ${workspaceId}`);
    }
    return codingJob;
  }

  @Delete(':workspace_id/coding-jobs/:id/assign/:coder_id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unassign a coder from a coding job', description: 'Unassigns a coder from a coding job in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the coding job' })
  @ApiParam({ name: 'coder_id', required: true, description: 'ID of the coder' })
  @ApiOkResponse({ description: 'Coder unassigned successfully', type: CodingJob })
  @ApiNotFoundResponse({ description: 'Coding job not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async unassignCoder(
    @Param('workspace_id') workspaceId: number,
      @Param('id') id: number,
      @Param('coder_id') coderId: number
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobService.unassignCoder(workspaceId, id, coderId);
    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }
    return codingJob;
  }

  @Get(':workspace_id/coding-jobs/:id/coders')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coders by coding job', description: 'Gets all coders assigned to a coding job in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the coding job' })
  @ApiOkResponse({
    description: 'Coders retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'number' },
              workspaceId: { type: 'number' },
              accessLevel: { type: 'number' },
              username: { type: 'string' }
            }
          }
        },
        total: { type: 'number' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Coding job not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getCodersByCodingJob(
    @Param('workspace_id') workspaceId: number,
      @Param('id') id: number
  ): Promise<{ data: WorkspaceUser[]; total: number }> {
    const codingJob = await this.codingJobService.getCodingJob(workspaceId, id);
    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }

    return {
      data: codingJob.assignedCoders || [],
      total: codingJob.assignedCoders?.length || 0
    };
  }

  @Get(':workspace_id/coders/:coder_id/coding-jobs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coding jobs by coder', description: 'Gets all coding jobs assigned to a coder in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'coder_id', required: true, description: 'ID of the coder' })
  @ApiOkResponse({
    description: 'Coding jobs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/CodingJob' } }
      }
    }
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getCodingJobsByCoder(
    @Param('workspace_id') workspaceId: number,
      @Param('coder_id') coderId: number
  ): Promise<{ data: CodingJob[] }> {
    const jobs = await this.codingJobService.getCodingJobsByCoder(workspaceId, coderId);
    return {
      data: jobs
    };
  }
}
