import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Req,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { Request } from 'express';
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
import { CodingJobService } from '../../database/services/coding';
import { UsersService } from '../../database/services/users';
import { CodingJobDto } from '../coding-job/dto/coding-job.dto';
import { statusNumberToString } from '../../database/utils/response-status-converter';

@ApiTags('Admin Coding Jobs (Direct)')
@Controller('admin/coding-jobs')
export class CodingJobsController {
  constructor(
    private readonly codingJobService: CodingJobService,
    private readonly usersService: UsersService
  ) {}

  private getRequestUserId(req: Request): number {
    const user = (
      req as Request & {
        user?: { id?: number | string; userId?: number | string };
      }
    ).user;
    const userId = Number(user?.id ?? user?.userId);

    if (!Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedException('User ID not found in request');
    }

    return userId;
  }

  private async assertCanAccessDirectCodingJob(
    codingJobId: number,
    workspaceId: number,
    req: Request
  ): Promise<void> {
    await this.codingJobService.assertUserCanAccessCodingJob(
      codingJobId,
      workspaceId,
      this.getRequestUserId(req)
    );
  }

  private async assertCanQueryCoderJobs(
    coderId: number,
    req: Request
  ): Promise<void> {
    const userId = this.getRequestUserId(req);
    if (coderId === userId) {
      return;
    }

    if (await this.usersService.getUserIsAdmin(userId)) {
      return;
    }

    throw new ForbiddenException('User can only query their own coding jobs');
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding job by ID',
    description: 'Retrieves a specific coding job by its ID'
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
  @ApiBadRequestResponse({
    description: 'Failed to retrieve coding job.'
  })
  async getCodingJobById(
    @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    try {
      const result = await this.codingJobService.getCodingJobById(id);
      await this.assertCanAccessDirectCodingJob(id, result.workspace_id, req);
      return CodingJobDto.fromEntity(result);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve coding job: ${error.message}`);
    }
  }

  @Get(':coderId/coders')
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
  @ApiBadRequestResponse({
    description: 'Failed to get coders for job.'
  })
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
    @Param('coderId', ParseIntPipe) coderId: number,
      @Req() req: Request
  ): Promise<{ data: CodingJobDto[] }> {
    try {
      await this.assertCanQueryCoderJobs(coderId, req);
      const codingJobs = await this.codingJobService.getCodingJobsByCoder(coderId);
      await Promise.all(
        codingJobs.map(job => this.assertCanAccessDirectCodingJob(
          job.id,
          job.workspace_id,
          req
        ))
      );
      return {
        data: codingJobs.map(job => CodingJobDto.fromEntity(job))
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(`Failed to get coding jobs for coder: ${error.message}`);
    }
  }

  @Get(':id/responses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get responses for coding job',
    description: 'Gets all responses that match the variable ids in unit names for a specific coding job'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the coding job'
  })
  @ApiOkResponse({
    description: 'The responses for the coding job.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              unitid: { type: 'number' },
              variableid: { type: 'string' },
              status: { type: 'string' },
              value: { type: 'string' },
              subform: { type: 'string' },
              code_v1: { type: 'number' },
              score_v1: { type: 'number' },
              status_v1: { type: 'string' },
              unit: {
                type: 'object',
                properties: {
                  id: { type: 'number' },
                  name: { type: 'string' },
                  alias: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Failed to get responses for coding job.'
  })
  async getResponsesForCodingJob(
    @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<{ data: {
        id: number;
        unitid: number;
        variableid: string;
        status: string;
        value: string;
        subform: string;
        code_v1: number;
        score_v1: number;
        status_v1: string;
        unit: {
          id: number;
          name: string;
          alias: string;
        };
      }[] }> {
    try {
      const codingJob = await this.codingJobService.getCodingJobById(id);
      await this.assertCanAccessDirectCodingJob(id, codingJob.workspace_id, req);
      const responses = await this.codingJobService.getResponsesForCodingJob(id);
      return {
        data: responses.map(response => ({
          id: response.id,
          unitid: response.unitid,
          variableid: response.variableid,
          status: statusNumberToString(response.status) || 'UNSET',
          value: response.value,
          subform: response.subform,
          code_v1: response.code_v1,
          score_v1: response.score_v1,
          status_v1: statusNumberToString(response.status_v1) || null,
          unit: response.unit ? {
            id: response.unit.id,
            name: response.unit.name,
            alias: response.unit.alias
          } : { id: 0, name: '', alias: '' }
        }))
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(`Failed to get responses for coding job: ${error.message}`);
    }
  }
}
