import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
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
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { CodingJobService } from '../../database/services/coding';
import { CodingJobDto } from './dto/coding-job.dto';
import { CreateCodingJobDto } from './dto/create-coding-job.dto';
import { UpdateCodingJobDto } from './dto/update-coding-job.dto';
import { AssignCodersDto } from './dto/assign-coders.dto';
import { VariableDto } from '../variable-bundle/dto/variable.dto';

@ApiTags('Admin Coding Jobs')
@Controller('admin/workspace/:workspace_id/coding-job')
export class CodingJobController {
  constructor(private readonly codingJobService: CodingJobService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all coding jobs',
    description: 'Retrieves all coding jobs for a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'Unique identifier for the workspace'
  })
  @ApiOkResponse({
    description: 'List of coding jobs retrieved successfully',
    type: [CodingJobDto]
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async getCodingJobs(
    @WorkspaceId() workspaceId: number
  ): Promise<CodingJobDto[]> {
    const result = await this.codingJobService.getCodingJobs(workspaceId);
    return result.data.map(job => CodingJobDto.fromEntity(
      job,
      job.assignedCoders || [],
      job.assignedVariables || [],
      job.assignedVariableBundles || []
    ));
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
    const dto = CodingJobDto.fromEntity(result.codingJob);
    dto.assigned_coders = result.assignedCoders;
    dto.variables = result.variables.map(v => {
      const variableDto = new VariableDto();
      variableDto.unitName = v.unitName;
      variableDto.variableId = v.variableId;
      return variableDto;
    });
    return dto;
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
    if (!createCodingJobDto) {
      throw new BadRequestException('Request body is required');
    }

    if (Object.prototype.hasOwnProperty.call(
      createCodingJobDto as unknown as Record<string, unknown>,
      'jobDefinitionId'
    )) {
      throw new BadRequestException(
        'jobDefinitionId cannot be set when creating a coding job directly. Use the job definition create-job endpoint.'
      );
    }

    const codingJob = await this.codingJobService.createCodingJob(
      workspaceId,
      createCodingJobDto
    );
    return CodingJobDto.fromEntity(codingJob);
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
    const codingJob = await this.codingJobService.updateCodingJob(
      id,
      workspaceId,
      updateCodingJobDto
    );
    return CodingJobDto.fromEntity(codingJob);
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

  @Post(':id/assign-coders')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Assign coders to a coding job',
    description: 'Assigns coders to a coding job'
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
    description: 'Coders have been successfully assigned to the coding job.',
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
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async assignCoders(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body() assignCodersDto: AssignCodersDto
  ): Promise<{ success: boolean }> {
    // Verify the coding job exists in this workspace
    await this.codingJobService.getCodingJob(id, workspaceId);

    // Assign the coders
    await this.codingJobService.assignCoders(id, assignCodersDto.userIds);

    return { success: true };
  }

  @Get('/coder/:coderId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding jobs by coder',
    description: 'Gets all coding jobs assigned to a specific coder'
  })
  @ApiParam({
    name: 'coderId',
    type: Number,
    required: true,
    description: 'The ID of the coder'
  })
  @ApiOkResponse({
    description: 'The coding jobs assigned to the coder.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/CodingJobDto' }
        }
      }
    }
  })
  async getCodingJobsByCoder(
    @Param('coderId', ParseIntPipe) coderId: number
  ): Promise<{ data: CodingJobDto[] }> {
    const codingJobs = await this.codingJobService.getCodingJobsByCoder(coderId);
    return {
      data: codingJobs.map(job => CodingJobDto.fromEntity(job))
    };
  }

  @Get(':jobId/coders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coders by job ID',
    description: 'Gets all coders assigned to a specific coding job'
  })
  @ApiParam({
    name: 'jobId',
    type: Number,
    required: true,
    description: 'The ID of the coding job'
  })
  @ApiOkResponse({
    description: 'The coders assigned to the coding job.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'number' }
            }
          }
        },
        total: { type: 'number' }
      }
    }
  })
  async getCodersByJobId(
    @Param('jobId', ParseIntPipe) jobId: number
  ): Promise<{ data: { userId: number }[], total: number }> {
    const coderIds = await this.codingJobService.getCodersByJobId(jobId);
    const data = coderIds.map(userId => ({ userId }));
    return {
      data,
      total: data.length
    };
  }
}
