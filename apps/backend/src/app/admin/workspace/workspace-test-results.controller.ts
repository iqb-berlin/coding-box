import {
  BadRequestException,
  Controller,
  Delete,
  Get, Param, Post, Query, UseGuards, UseInterceptors, UploadedFiles
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { logger } from 'nx/src/utils/logger';
import { WorkspaceService } from '../../database/services/workspace.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { UploadResultsService } from '../../database/services/upload-results.service';
import Persons from '../../database/entities/persons.entity';
import { ResponseEntity } from '../../database/entities/response.entity';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsController {
  constructor(
    private workspaceService: WorkspaceService,
    private uploadResults: UploadResultsService
  ) {}

  @Get(':workspace_id/test-results')
  @ApiOperation({ summary: 'Get test results', description: 'Retrieves paginated test results for a workspace' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
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
    description: 'Test results retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve test results' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findTestResults(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20
  ): Promise<{ data: Persons[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.workspaceService.findTestResults(workspace_id, { page, limit });
    return {
      data, total, page, limit
    };
  }

  @Get(':workspace_id/test-results/:personId')
  @ApiOperation({
    summary: 'Get test results for a specific person',
    description: 'Retrieves detailed test results for a specific person in a workspace'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'personId', type: Number, description: 'ID of the person' })
  @ApiOkResponse({
    description: 'Test results retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'ID of the test result' },
          personid: { type: 'number', description: 'ID of the person' },
          name: { type: 'string', description: 'Name of the person' },
          size: { type: 'number', description: 'Size of the test results' },
          logs: {
            type: 'array',
            description: 'Logs associated with the test',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                bookletid: { type: 'number' },
                ts: { type: 'string', description: 'Timestamp' },
                parameter: { type: 'string' },
                key: { type: 'string' }
              }
            }
          },
          units: {
            type: 'array',
            description: 'Units associated with the test',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                bookletid: { type: 'number' },
                name: { type: 'string' },
                alias: { type: 'string', nullable: true },
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number' },
                      unitid: { type: 'number' }
                    }
                  }
                },
                logs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number' },
                      unitid: { type: 'number' },
                      ts: { type: 'string', description: 'Timestamp' },
                      key: { type: 'string' },
                      parameter: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve test results' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findPersonTestResults(
    @Param('workspace_id') workspace_id: number,
      @Param('personId') personId: number
  ): Promise<{
        id: number;
        personid: number;
        name: string;
        size: number;
        logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
        units: {
          id: number;
          bookletid: number;
          name: string;
          alias: string | null;
          results: { id: number; unitid: number }[];
          logs: { id: number; unitid: number; ts: string; key: string; parameter: string }[];
        }[];
      }[]> {
    return this.workspaceService.findPersonTestResults(personId, workspace_id);
  }

  @Delete(':workspace_id/test-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteTestGroups(
    @Query('testPersons')testPersonIds:string,
      @Param('workspace_id')workspaceId:string): Promise<{
        success: boolean;
        report: {
          deletedPersons: string[];
          warnings: string[];
        };
      }> {
    return this.workspaceService.deleteTestPersons(Number(workspaceId), testPersonIds);
  }

  @Get(':workspace_id/responses')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
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
    description: 'Responses retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/ResponseDto' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  async findWorkspaceResponse(@WorkspaceId() id: number, @Query('page') page: number = 1, @Query('limit') limit: number = 20): Promise<{ data: ResponseDto[]; total: number; page: number; limit: number }> {
    const [responses, total] = await this.workspaceService.findWorkspaceResponses(id, { page, limit });
    return {
      data: responses,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/responses/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findResponse(@WorkspaceId() id: number,
    @Param('testPerson') testPerson:string,
    @Param('unitId') unitId:string): Promise<{ responses: { id: string, content: { id: string; value: string; status: string }[] }[] }> {
    return this.workspaceService.findUnitResponse(id, testPerson, unitId);
  }

  @Get(':workspace_id/coding/responses/:status')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'status', type: String })
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
    description: 'Responses with the specified status retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/ResponseEntity' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  async getResponsesByStatus(@WorkspaceId() workspace_id: number, @Param('status') status: string, @Query('page') page: number = 1, @Query('limit') limit: number = 20): Promise<{ data: ResponseEntity[]; total: number; page: number; limit: number }> {
    const [responses, total] = await this.workspaceService.getResponsesByStatus(workspace_id, status, { page, limit });
    return {
      data: responses,
      total,
      page,
      limit
    };
  }

  @Post(':workspace_id/upload/results/:resultType')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload test results',
    description: 'Uploads test results (logs or responses) to a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace to which test results should be uploaded.'
  })
  @ApiParam({
    name: 'resultType',
    enum: ['logs', 'responses'],
    required: true,
    description: 'Type of results to upload (logs or responses)'
  })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary'
          },
          description: 'Result files to upload'
        }
      }
    }
  })
  @ApiTags('workspace')
  @ApiOkResponse({
    description: 'Test results successfully uploaded.',
    type: Boolean
  })
  @ApiBadRequestResponse({
    description: 'Invalid request. Please check your input data.'
  })
  async addTestResults(
    @Param('workspace_id') workspace_id: number,
      @Param('resultType') resultType: 'logs' | 'responses',
      @UploadedFiles() files: Express.Multer.File[]
  ): Promise<boolean> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded.');
    }

    try {
      return await this.uploadResults.uploadTestResults(workspace_id, files, resultType);
    } catch (error) {
      logger.error('Error uploading test results!');
      throw new BadRequestException('Uploading test results failed. Please try again.');
    }
  }
}
