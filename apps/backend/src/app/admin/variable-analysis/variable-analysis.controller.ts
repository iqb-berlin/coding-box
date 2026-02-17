import {
  BadRequestException,
  Controller,
  ConflictException,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { VariableAnalysisService } from '../../database/services/test-results';
import { VariableAnalysisResultDto } from './dto/variable-analysis-result.dto';
import { VariableAnalysisJobDto } from './dto/variable-analysis-job.dto';

@ApiTags('Variable Analysis')
@Controller('admin/workspace/:workspace_id/variable-analysis')
export class VariableAnalysisController {
  constructor(private readonly variableAnalysisService: VariableAnalysisService) { }

  @Post('jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new variable analysis job',
    description: 'Initiates an asynchronous variable analysis job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiQuery({
    name: 'unitId',
    type: Number,
    required: false,
    description: 'Optional unit ID to filter by'
  })
  @ApiQuery({
    name: 'variableId',
    type: String,
    required: false,
    description: 'Optional variable ID to filter by'
  })
  @ApiCreatedResponse({
    description: 'The variable analysis job has been successfully created.',
    type: VariableAnalysisJobDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  @ApiConflictResponse({
    description: 'A variable analysis job is already in progress for this workspace.'
  })
  async createAnalysisJob(
    @WorkspaceId() workspaceId: number,
      @Query('unitId') unitId?: number,
      @Query('variableId') variableId?: string
  ): Promise<VariableAnalysisJobDto> {
    try {
      return await this.variableAnalysisService.createAnalysisJob(
        workspaceId,
        unitId,
        variableId
      );
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create variable analysis job: ${error.message}`);
    }
  }

  @Get('jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all variable analysis jobs for a workspace',
    description: 'Retrieves all variable analysis jobs for a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiOkResponse({
    description: 'The variable analysis jobs have been successfully retrieved.',
    type: [VariableAnalysisJobDto]
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async getAnalysisJobs(
    @WorkspaceId() workspaceId: number
  ): Promise<VariableAnalysisJobDto[]> {
    try {
      return await this.variableAnalysisService.getAnalysisJobs(workspaceId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve variable analysis jobs: ${error.message}`);
    }
  }

  @Get('jobs/:job_id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a variable analysis job by ID',
    description: 'Retrieves a variable analysis job by ID'
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
    description: 'The variable analysis job has been successfully retrieved.',
    type: VariableAnalysisJobDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Job not found.'
  })
  async getAnalysisJob(
    @WorkspaceId() workspaceId: number,
      @Param('job_id') jobId: string
  ): Promise<VariableAnalysisJobDto> {
    try {
      return await this.variableAnalysisService.getAnalysisJob(jobId, workspaceId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error.message && error.message.includes('not found in workspace')) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException(`Failed to retrieve variable analysis job: ${error.message}`);
    }
  }

  @Get('jobs/:job_id/results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the results of a variable analysis job',
    description: 'Retrieves the results of a completed variable analysis job'
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
    description: 'The variable analysis results have been successfully retrieved.',
    type: VariableAnalysisResultDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data or job not completed.'
  })
  @ApiNotFoundResponse({
    description: 'Job not found.'
  })
  async getAnalysisResults(
    @WorkspaceId() workspaceId: number,
      @Param('job_id') jobId: string
  ): Promise<VariableAnalysisResultDto> {
    try {
      return await this.variableAnalysisService.getAnalysisResults(jobId, workspaceId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error.message && error.message.includes('not found in workspace')) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException(`Failed to retrieve variable analysis results: ${error.message}`);
    }
  }

  @Delete('jobs/:job_id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a variable analysis job',
    description: 'Deletes a variable analysis job by ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'job_id',
    type: String,
    required: true,
    description: 'The ID of the job'
  })
  @ApiOkResponse({
    description: 'The variable analysis job has been successfully deleted.'
  })
  async deleteJob(
    @WorkspaceId() workspaceId: number,
      @Param('job_id') jobId: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const success = await this.variableAnalysisService.deleteJob(workspaceId, jobId);
      return { success };
    } catch (error) {
      throw new BadRequestException(`Failed to delete variable analysis job: ${error.message}`);
    }
  }

  @Delete('jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'All variable analysis jobs deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async deleteAllJobs(
    @WorkspaceId() workspaceId: number
  ): Promise<{ success: boolean }> {
    try {
      await this.variableAnalysisService.deleteAllJobs(workspaceId);
      return { success: true };
    } catch (error) {
      throw new BadRequestException(`Failed to delete all variable analysis jobs: ${error.message}`);
    }
  }

  @Post('jobs/:job_id/cancel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel a variable analysis job',
    description: 'Cancels a running variable analysis job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'job_id',
    type: String,
    required: true,
    description: 'The ID of the job'
  })
  @ApiOkResponse({
    description: 'The variable analysis job has been successfully cancelled.'
  })
  async cancelJob(
    @WorkspaceId() workspaceId: number,
      @Param('job_id') jobId: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const success = await this.variableAnalysisService.cancelJob(workspaceId, jobId);
      return { success };
    } catch (error) {
      throw new BadRequestException(`Failed to cancel variable analysis job: ${error.message}`);
    }
  }
}
