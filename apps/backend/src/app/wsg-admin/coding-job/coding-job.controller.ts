import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { Request } from 'express';

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
import { CodingJobService, CodingReplayService } from '../../database/services/coding';
import { CodingJobDto } from '../../admin/coding-job/dto/coding-job.dto';
import { CreateCodingJobDto } from '../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../admin/coding-job/dto/update-coding-job.dto';
import { SaveCodingProgressDto } from '../../admin/coding-job/dto/save-coding-progress.dto';

@ApiTags('WSG Admin Coding Jobs')
@Controller('wsg-admin/workspace/:workspace_id/coding-job')
export class WsgCodingJobController {
  constructor(
    private readonly codingJobService: CodingJobService,
    private readonly codingReplayService: CodingReplayService
  ) { }

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
      @Query('limit', new ParseIntPipe({ optional: true })) limit?: number
  ): Promise<{ data: CodingJobDto[]; total: number; totalOpenUnits: number; page: number; limit?: number }> {
    const result = await this.codingJobService.getCodingJobs(workspaceId, page, limit);
    return {
      data: result.data.map(job => CodingJobDto.fromEntity(job, job.assignedCoders, job.assignedVariables, job.assignedVariableBundles)),
      total: result.total,
      totalOpenUnits: result.totalOpenUnits,
      page: result.page,
      limit: result.limit
    };
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
    const result = await this.codingJobService.getCodingJob(id, workspaceId);
    return CodingJobDto.fromEntity(result.codingJob, result.assignedCoders, result.variables, result.variableBundles.map(vb => ({ name: vb.name, variables: vb.variables })));
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
    return this.codingJobService.updateCodingJob(
      id,
      workspaceId,
      updateCodingJobDto
    );
  }

  @Post(':id/start')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a coding job',
    description: 'Finds all responses matching assigned variables and prepares replay data with URLs'
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
              personCode: { type: 'string' },
              personGroup: { type: 'string' },
              replayUrl: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async startCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<{ total: number; items: Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string; replayUrl: string }> }> {
    const job = await this.codingJobService.getCodingJob(id, workspaceId);

    const onlyOpen = job.codingJob.status === 'open';
    const items = await this.codingJobService.getCodingJobUnits(id, onlyOpen);

    if (job.codingJob.status !== 'results_applied') {
      await this.codingJobService.updateCodingJob(id, workspaceId, { status: 'active' });
    }

    const serverUrl = `${req.protocol}://${req.get('host') ?? ''}`;
    const itemsWithReplayUrls = await this.codingReplayService.generateReplayUrlsForItems(
      workspaceId,
      items,
      serverUrl
    );

    return { total: itemsWithReplayUrls.length, items: itemsWithReplayUrls };
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
    return this.codingJobService.deleteCodingJob(id, workspaceId);
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
    await this.codingJobService.getCodingJob(id, workspaceId);
    const codingJob = await this.codingJobService.saveCodingProgress(id, saveCodingProgressDto);
    return CodingJobDto.fromEntity(codingJob);
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
    const codingJob = await this.codingJobService.restartCodingJobWithOpenUnits(id, workspaceId);
    return CodingJobDto.fromEntity(codingJob);
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
    await this.codingJobService.getCodingJob(id, workspaceId);
    return this.codingJobService.getCodingProgress(id);
  }

  @Get('progress/bulk')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get bulk coding progress',
    description: 'Retrieves saved partial coding progress for multiple coding jobs in bulk'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiQuery({
    name: 'jobIds',
    required: true,
    description: 'Comma-separated list of coding job IDs',
    type: String
  })
  @ApiOkResponse({
    description: 'Bulk coding progress retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: { type: 'object' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'One or more coding jobs not found.'
  })
  async getBulkCodingProgress(
    @WorkspaceId() workspaceId: number,
      @Query('jobIds') jobIdsParam: string
  ): Promise<Record<number, Record<string, unknown>>> {
    const jobIds = jobIdsParam.split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => Number.isFinite(id) && id > 0);

    if (jobIds.length === 0) {
      throw new BadRequestException('Invalid job IDs provided');
    }

    return this.codingJobService.getBulkCodingProgress(jobIds, workspaceId);
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
  ): Promise<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }>> {
    await this.codingJobService.getCodingJob(id, workspaceId);
    return this.codingJobService.getCodingJobUnits(id, false);
  }
}
