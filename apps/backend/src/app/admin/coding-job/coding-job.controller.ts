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
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingJobDto } from './dto/coding-job.dto';
import { CreateCodingJobDto } from './dto/create-coding-job.dto';
import { UpdateCodingJobDto } from './dto/update-coding-job.dto';
import { AssignCodersDto } from './dto/assign-coders.dto';
import { VariableBundleDto } from '../variable-bundle/dto/variable-bundle.dto';
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
        data: result.data.map(job => CodingJobDto.fromEntity(
          job,
          job.assignedCoders || [],
          job.assignedVariables || [],
          job.assignedVariableBundles || []
        )),
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
      const dto = CodingJobDto.fromEntity(result.codingJob);
      dto.assigned_coders = result.assignedCoders;
      dto.variables = result.variables.map(v => {
        const variableDto = new VariableDto();
        variableDto.unitName = v.unitName;
        variableDto.variableId = v.variableId;
        return variableDto;
      });
      dto.variable_bundles = result.variableBundles.map(vb => VariableBundleDto.fromEntity(vb));
      return dto;
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
      return CodingJobDto.fromEntity(codingJob);
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
    try {
      // Verify the coding job exists in this workspace
      await this.codingJobService.getCodingJob(id, workspaceId);

      // Assign the coders
      await this.codingJobService.assignCoders(id, assignCodersDto.userIds);

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to assign coders: ${error.message}`);
    }
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
    try {
      const codingJobs = await this.codingJobService.getCodingJobsByCoder(coderId);
      return {
        data: codingJobs.map(job => CodingJobDto.fromEntity(job))
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get coding jobs for coder: ${error.message}`);
    }
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
    try {
      const coderIds = await this.codingJobService.getCodersByJobId(jobId);
      const data = coderIds.map(userId => ({ userId }));
      return {
        data,
        total: data.length
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get coders for job: ${error.message}`);
    }
  }
}
