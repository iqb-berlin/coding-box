import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../../admin/workspace/workspace.guard';
import { WorkspaceId } from '../../admin/workspace/workspace.decorator';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingJobDto } from '../../admin/coding-job/dto/coding-job.dto';
import { CreateCodingJobDto } from '../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../admin/coding-job/dto/update-coding-job.dto';

@ApiTags('WSG Admin Coding Jobs')
@Controller('wsg-admin/workspace/:workspace_id/coding-job')
export class WsgCodingJobController {
  constructor(private readonly codingJobService: CodingJobService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all coding jobs',
    description: 'Retrieves all coding jobs for a workspace with pagination'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'Unique identifier for the workspace'
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
    description: 'List of coding jobs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/CodingJobDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async getCodingJobs(
    @WorkspaceId() workspaceId: number,
      @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
      @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number
  ): Promise<{ data: CodingJobDto[]; total: number; page: number; limit: number }> {
    try {
      const result = await this.codingJobService.getCodingJobs(workspaceId, page, limit);
      return {
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve coding jobs: ${error.message}`);
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a coding job by ID',
    description: 'Retrieves a coding job by ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the coding job'
  })
  @ApiOkResponse({
    description: 'The coding job has been successfully retrieved.',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  async getCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<CodingJobDto> {
    try {
      const result = await this.codingJobService.getCodingJob(id, workspaceId);
      return result.codingJob;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve coding job: ${error.message}`);
    }
  }

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new coding job',
    description: 'Creates a new coding job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiCreatedResponse({
    description: 'The coding job has been successfully created.',
    type: CodingJobDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async createCodingJob(
    @WorkspaceId() workspaceId: number,
      @Body() createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJobDto> {
    try {
      const codingJob = await this.codingJobService.createCodingJob(
        workspaceId,
        createCodingJobDto
      );
      return CodingJobDto.fromEntity(codingJob);
    } catch (error) {
      throw new BadRequestException(`Failed to create coding job: ${error.message}`);
    }
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a coding job',
    description: 'Updates a coding job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the coding job'
  })
  @ApiOkResponse({
    description: 'The coding job has been successfully updated.',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async updateCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body() updateCodingJobDto: UpdateCodingJobDto
  ): Promise<CodingJobDto> {
    try {
      const codingJob = await this.codingJobService.updateCodingJob(
        id,
        workspaceId,
        updateCodingJobDto
      );
      return codingJob;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update coding job: ${error.message}`);
    }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a coding job',
    description: 'Deletes a coding job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the coding job'
  })
  @ApiOkResponse({
    description: 'The coding job has been successfully deleted.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  async deleteCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<{ success: boolean }> {
    try {
      return await this.codingJobService.deleteCodingJob(id, workspaceId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to delete coding job: ${error.message}`);
    }
  }
}
