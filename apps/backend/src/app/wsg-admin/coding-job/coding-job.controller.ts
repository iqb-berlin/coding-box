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
import { SaveCodingProgressDto } from '../../admin/coding-job/dto/save-coding-progress.dto';

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
        totalOpenUnits: { type: 'number' },
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
  ): Promise<{ data: CodingJobDto[]; total: number; totalOpenUnits: number; page: number; limit: number }> {
    try {
      const result = await this.codingJobService.getCodingJobs(workspaceId, page, limit);
      return {
        data: result.data,
        total: result.total,
        totalOpenUnits: result.totalOpenUnits,
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
      return await this.codingJobService.updateCodingJob(
        id,
        workspaceId,
        updateCodingJobDto
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update coding job: ${error.message}`);
    }
  }

  @Post(':id/start')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a coding job',
    description: 'Finds all responses matching assigned variables and prepares replay data'
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
    description: 'Replay data prepared successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number' },
              unitName: { type: 'string' },
              unitAlias: { type: 'string' },
              variableId: { type: 'string' },
              variableAnchor: { type: 'string' },
              bookletName: { type: 'string' },
              personLogin: { type: 'string' },
              personCode: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async startCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<{ total: number; items: Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string }> }> {
    try {
      await this.codingJobService.getCodingJob(id, workspaceId);
      const items = await this.codingJobService.getCodingJobUnits(id, false);
      await this.codingJobService.updateCodingJob(id, workspaceId, { status: 'active' });

      return { total: items.length, items };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to start coding job: ${error.message}`);
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

  @Post(':id/progress')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Save coding progress',
    description: 'Saves partial coding progress for a specific unit-variable combination'
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
    description: 'Coding progress saved successfully',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async saveCodingProgress(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body() saveCodingProgressDto: SaveCodingProgressDto
  ): Promise<CodingJobDto> {
    try {
      await this.codingJobService.getCodingJob(id, workspaceId);
      const codingJob = await this.codingJobService.saveCodingProgress(id, saveCodingProgressDto);
      return CodingJobDto.fromEntity(codingJob);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to save coding progress: ${error.message}`);
    }
  }

  @Post(':id/restart-open-units')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restart coding job with only open units',
    description: 'Removes coded units and keeps only open units for recoding'
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
    description: 'Coding job restarted with open units only',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async restartCodingJobWithOpenUnits(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<CodingJobDto> {
    try {
      const codingJob = await this.codingJobService.restartCodingJobWithOpenUnits(id, workspaceId);
      return CodingJobDto.fromEntity(codingJob);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to restart coding job: ${error.message}`);
    }
  }

  @Get(':id/progress')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding progress',
    description: 'Retrieves saved partial coding progress for a coding job'
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
    description: 'Coding progress retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: { type: 'object' }
    }
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  async getCodingProgress(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<Record<string, unknown>> {
    try {
      await this.codingJobService.getCodingJob(id, workspaceId);
      return await this.codingJobService.getCodingProgress(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve coding progress: ${error.message}`);
    }
  }

  @Get(':id/units')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding job units',
    description: 'Retrieves all units assigned to a coding job without starting it'
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
    description: 'Units retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          responseId: { type: 'number' },
          unitName: { type: 'string' },
          unitAlias: { type: 'string' },
          variableId: { type: 'string' },
          variableAnchor: { type: 'string' },
          bookletName: { type: 'string' },
          personLogin: { type: 'string' },
          personCode: { type: 'string' }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  async getCodingJobUnits(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string }>> {
    try {
      await this.codingJobService.getCodingJob(id, workspaceId);
      return await this.codingJobService.getCodingJobUnits(id, false);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve coding job units: ${error.message}`);
    }
  }
}
