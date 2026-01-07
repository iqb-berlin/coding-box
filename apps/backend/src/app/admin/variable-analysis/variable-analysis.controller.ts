import {
  BadRequestException,
  Controller,
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
import { VariableAnalysisService } from '../../coding/services/variable-analysis.service';
import { VariableAnalysisResultDto } from './dto/variable-analysis-result.dto';
import { VariableAnalysisJobDto } from './dto/variable-analysis-job.dto';

@ApiTags('Variable Analysis')
@Controller('admin/workspace/:workspace_id/variable-analysis')
export class VariableAnalysisController {
  constructor(private readonly variableAnalysisService: VariableAnalysisService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get variable frequencies synchronously',
    description: 'Retrieves frequency analysis for variables in a workspace (synchronous operation)'
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
  @ApiQuery({
    name: 'page',
    type: Number,
    required: false,
    description: 'Page number for pagination'
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: 'Number of items per page'
  })
  @ApiOkResponse({
    description: 'The variable frequencies have been successfully retrieved.',
    type: VariableAnalysisResultDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async getVariableFrequencies(@WorkspaceId() workspaceId: number, @Query('unitId') unitId?: number, @Query('variableId') variableId?: string): Promise<VariableAnalysisResultDto> {
    try {
      return await this.variableAnalysisService.getVariableFrequencies(
        workspaceId,
        unitId,
        variableId
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve variable frequencies: ${error.message}`);
    }
  }

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
  async createAnalysisJob(
    @WorkspaceId() workspaceId: number,
      @Query('unitId') unitId?: number,
      @Query('variableId') variableId?: string
  ): Promise<VariableAnalysisJobDto> {
    try {
      const job = await this.variableAnalysisService.createAnalysisJob(
        workspaceId,
        unitId,
        variableId
      );
      return VariableAnalysisJobDto.fromEntity(job);
    } catch (error) {
      if (error instanceof NotFoundException) {
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
      const jobs = await this.variableAnalysisService.getAnalysisJobs(workspaceId);
      return jobs.map(job => VariableAnalysisJobDto.fromEntity(job));
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
      @Param('job_id') jobId: number
  ): Promise<VariableAnalysisJobDto> {
    try {
      const job = await this.variableAnalysisService.getAnalysisJob(jobId, workspaceId);
      return VariableAnalysisJobDto.fromEntity(job);
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
      @Param('job_id') jobId: number
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
}
