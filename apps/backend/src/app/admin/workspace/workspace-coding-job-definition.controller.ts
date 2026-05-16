import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  UseGuards,
  Body,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { JobDefinitionService } from '../../database/services/jobs';
import type { JobDefinitionWithCreatedJobsCount } from '../../database/services/jobs';
import { JobDefinition } from '../../database/entities/job-definition.entity';
import { CreateJobDefinitionDto } from '../coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../coding-job/dto/approve-job-definition.dto';

@ApiTags('Admin Workspace Job Definition')
@Controller('admin/workspace')
export class WorkspaceCodingJobDefinitionController {
  constructor(
    private jobDefinitionService: JobDefinitionService
  ) { }

  @Post(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create a new job definition',
    type: CreateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition created successfully.'
  })
  async createJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) createDto: CreateJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.createJobDefinition(
      createDto,
      workspace_id
    );
  }

  @Get(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of job definitions retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          status: { type: 'string' },
          assigned_variables: { type: 'array' },
          assigned_variable_bundles: { type: 'array' },
          assigned_coders: { type: 'array' },
          assigned_coder_configs: { type: 'array' },
          distribution_seed: { type: 'string' },
          duration_seconds: { type: 'number' },
          max_coding_cases: { type: 'number' },
          double_coding_absolute: { type: 'number' },
          double_coding_percentage: { type: 'number' },
          show_score: { type: 'boolean' },
          allow_comments: { type: 'boolean' },
          suppress_general_instructions: { type: 'boolean' },
          createdJobsCount: { type: 'number' },
          created_jobs_count: { type: 'number' },
          blockingCreatedJobsCount: { type: 'number' },
          blocking_created_jobs_count: { type: 'number' },
          openCreatedJobsCount: { type: 'number' },
          open_created_jobs_count: { type: 'number' },
          plannedVariableUsage: {
            type: 'object',
            additionalProperties: { type: 'number' }
          },
          planned_variable_usage: {
            type: 'object',
            additionalProperties: { type: 'number' }
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getJobDefinitions(
    @WorkspaceId() workspace_id: number
  ): Promise<JobDefinitionWithCreatedJobsCount[]> {
    return this.jobDefinitionService.getJobDefinitions(workspace_id);
  }

  @Get(':workspace_id/coding/job-definitions/approved')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of approved job definitions retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          assigned_variables: { type: 'array' },
          assigned_variable_bundles: { type: 'array' },
          assigned_coders: { type: 'array' },
          assigned_coder_configs: { type: 'array' },
          distribution_seed: { type: 'string' },
          duration_seconds: { type: 'number' },
          max_coding_cases: { type: 'number' },
          double_coding_absolute: { type: 'number' },
          double_coding_percentage: { type: 'number' },
          show_score: { type: 'boolean' },
          allow_comments: { type: 'boolean' },
          suppress_general_instructions: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getApprovedJobDefinitions(
    @WorkspaceId() workspaceId: number
  ): Promise<JobDefinition[]> {
    return this.jobDefinitionService.getApprovedJobDefinitions(workspaceId);
  }

  @Get(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Job definition retrieved successfully.'
  })
  async getJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.getJobDefinition(id);
  }

  @Put(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Update job definition',
    type: UpdateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition updated successfully.'
  })
  async updateJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.updateJobDefinition(id, updateDto);
  }

  @Put(':workspace_id/coding/job-definitions/:id/approve')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Approve job definition',
    type: ApproveJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition approved successfully.'
  })
  async approveJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) approveDto: ApproveJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.approveJobDefinition(id, approveDto);
  }

  @Delete(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Job definition deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<{ success: boolean; message: string }> {
    await this.jobDefinitionService.deleteJobDefinition(id);
    return { success: true, message: 'Job definition deleted successfully' };
  }

  @Post(':workspace_id/coding/job-definitions/:id/create-job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Distributed coding jobs created successfully from job definition.'
  })
  async createCodingJobFromDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<Awaited<ReturnType<JobDefinitionService['createCodingJobFromDefinition']>>> {
    return this.jobDefinitionService.createCodingJobFromDefinition(
      id,
      workspace_id
    );
  }
}
