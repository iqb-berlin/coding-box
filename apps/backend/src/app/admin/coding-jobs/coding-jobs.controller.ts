import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
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
import { CodingJobService } from '../../database/services/coding';
import { CodingJobDto } from '../coding-job/dto/coding-job.dto';
import { statusNumberToString } from '../../database/utils/response-status-converter';

@ApiTags('Admin Coding Jobs (Direct)')
@Controller('admin/coding-jobs')
export class CodingJobsController {
  constructor(private readonly codingJobService: CodingJobService) {}

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
    @Param('id', ParseIntPipe) id: number
  ): Promise<CodingJobDto> {
    try {
      const result = await this.codingJobService.getCodingJobById(id);
      return CodingJobDto.fromEntity(result);
    } catch (error) {
      if (error instanceof NotFoundException) {
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
    @Param('id', ParseIntPipe) id: number
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
      throw new BadRequestException(`Failed to get responses for coding job: ${error.message}`);
    }
  }
}
