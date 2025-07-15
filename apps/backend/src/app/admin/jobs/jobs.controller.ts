import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { JobService } from '../../database/services/job.service';
import { JobDto } from './dto/job.dto';

@ApiTags('Jobs')
@Controller('admin/workspace/:workspace_id/jobs')
export class JobsController {
  constructor(private readonly jobService: JobService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all jobs for a workspace',
    description: 'Retrieves all jobs for a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiOkResponse({
    description: 'The jobs have been successfully retrieved.',
    type: [JobDto]
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async getJobs(@WorkspaceId() workspaceId: number): Promise<JobDto[]> {
    try {
      const jobs = await this.jobService.getJobs(workspaceId);
      return jobs.map(job => JobDto.fromEntity(job));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve jobs: ${error.message}`);
    }
  }

  @Get(':job_id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a job by ID',
    description: 'Retrieves a job by ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'job_id',
    type: Number,
    required: true,
    description: 'The ID of the job'
  })
  @ApiOkResponse({
    description: 'The job has been successfully retrieved.',
    type: JobDto
  })
  @ApiNotFoundResponse({
    description: 'Job not found.'
  })
  async getJob(
    @WorkspaceId() workspaceId: number,
      @Param('job_id') jobId: number
  ): Promise<JobDto> {
    try {
      const job = await this.jobService.getJob(jobId, workspaceId);
      return JobDto.fromEntity(job);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve job: ${error.message}`);
    }
  }

  @Post(':job_id/cancel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel a job',
    description: 'Cancels a job by ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'job_id',
    type: Number,
    required: true,
    description: 'The ID of the job'
  })
  @ApiOkResponse({
    description: 'The job has been successfully cancelled.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Job not found.'
  })
  async cancelJob(
    @WorkspaceId() workspaceId: number,
      @Param('job_id') jobId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.jobService.getJob(jobId, workspaceId);
      return await this.jobService.cancelJob(jobId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to cancel job: ${error.message}`);
    }
  }
}
