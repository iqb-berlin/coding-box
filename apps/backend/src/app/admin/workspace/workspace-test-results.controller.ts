import {
  BadRequestException,
  Controller,
  Delete,
  Get, Param, Post, Query, Req, UseGuards, UseInterceptors, UploadedFiles, Res
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiResponse, ApiTags
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { logger } from 'nx/src/utils/logger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { UploadResultsService } from '../../database/services/upload-results.service';
import Persons from '../../database/entities/persons.entity';
import { ResponseEntity } from '../../database/entities/response.entity';
import { WorkspaceTestResultsService } from '../../database/services/workspace-test-results.service';
import { DatabaseExportService } from '../database/database-export.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private uploadResults: UploadResultsService,
    private databaseExportService: DatabaseExportService
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
  @ApiQuery({
    name: 'searchText',
    required: false,
    description: 'Text to search for in code, group, or login fields',
    type: String
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
                           @Query('limit') limit: number = 20,
                           @Query('searchText') searchText?: string
  ): Promise<{ data: Persons[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.workspaceTestResultsService.findTestResults(workspace_id, { page, limit, searchText });
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
          id: { type: 'number', description: 'ID of the booklet' },
          name: { type: 'string', description: 'Name of the booklet' },
          logs: {
            type: 'array',
            description: 'Logs associated with the booklet',
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
            description: 'Units associated with the booklet',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                alias: { type: 'string', nullable: true },
                results: {
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
                      code: { type: 'number', nullable: true },
                      score: { type: 'number', nullable: true },
                      codedstatus: { type: 'string', nullable: true }
                    }
                  }
                },
                tags: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number' },
                      unitId: { type: 'number' },
                      tag: { type: 'string' },
                      color: { type: 'string', nullable: true },
                      createdAt: { type: 'string', format: 'date-time' }
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
        name: string;
        logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
        units: {
          id: number;
          name: string;
          alias: string | null;
          results: { id: number; unitid: number; variableid: string; status: string; value: string; subform: string; code?: number; score?: number; codedstatus?: string }[];
          tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
        }[];
      }[]> {
    return this.workspaceTestResultsService.findPersonTestResults(personId, workspace_id);
  }

  @Delete(':workspace_id/test-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteTestGroups(
    @Query('testPersons')testPersonIds:string,
      @Param('workspace_id')workspaceId:string,
      @Req() req): Promise<{
        success: boolean;
        report: {
          deletedPersons: string[];
          warnings: string[];
        };
      }> {
    return this.workspaceTestResultsService.deleteTestPersons(Number(workspaceId), testPersonIds, req.user.id);
  }

  @Delete(':workspace_id/units/:unitId')
  @ApiOperation({
    summary: 'Delete a unit',
    description: 'Deletes a unit and all its associated responses'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'unitId', type: Number, description: 'ID of the unit to delete' })
  @ApiOkResponse({
    description: 'Unit deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        report: {
          type: 'object',
          properties: {
            deletedUnit: { type: 'number', nullable: true },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to delete unit' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteUnit(
    @Param('workspace_id') workspaceId: number,
      @Param('unitId') unitId: number,
      @Req() req
  ): Promise<{
        success: boolean;
        report: {
          deletedUnit: number | null;
          warnings: string[];
        };
      }> {
    return this.workspaceTestResultsService.deleteUnit(workspaceId, unitId, req.user.id);
  }

  @Delete(':workspace_id/responses/:responseId')
  @ApiOperation({
    summary: 'Delete a response',
    description: 'Deletes a response'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'responseId', type: Number, description: 'ID of the response to delete' })
  @ApiOkResponse({
    description: 'Response deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        report: {
          type: 'object',
          properties: {
            deletedResponse: { type: 'number', nullable: true },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to delete response' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteResponse(
    @Param('workspace_id') workspaceId: number,
      @Param('responseId') responseId: number,
      @Req() req
  ): Promise<{
        success: boolean;
        report: {
          deletedResponse: number | null;
          warnings: string[];
        };
      }> {
    return this.workspaceTestResultsService.deleteResponse(workspaceId, responseId, req.user.id);
  }

  @Delete(':workspace_id/booklets/:bookletId')
  @ApiOperation({
    summary: 'Delete a booklet',
    description: 'Deletes a booklet and all its associated units and responses'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'bookletId', type: Number, description: 'ID of the booklet to delete' })
  @ApiOkResponse({
    description: 'Booklet deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        report: {
          type: 'object',
          properties: {
            deletedBooklet: { type: 'number', nullable: true },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to delete booklet' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteBooklet(
    @Param('workspace_id') workspaceId: number,
      @Param('bookletId') bookletId: number,
      @Req() req
  ): Promise<{
        success: boolean;
        report: {
          deletedBooklet: number | null;
          warnings: string[];
        };
      }> {
    return this.workspaceTestResultsService.deleteBooklet(workspaceId, bookletId, req.user.id);
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
  async findWorkspaceResponse(@WorkspaceId() id: number, @Query('page') page: number = 1, @Query('limit') limit: number = 20): Promise<{ data: ResponseEntity[]; total: number; page: number; limit: number }> {
    const [responses, total] = await this.workspaceTestResultsService.findWorkspaceResponses(id, { page, limit });
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
    return this.workspaceTestResultsService.findUnitResponse(id, testPerson, unitId);
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
    const [responses, total] = await this.workspaceTestResultsService.getResponsesByStatus(workspace_id, status, { page, limit });
    return {
      data: responses,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/responses/search')
  @ApiOperation({
    summary: 'Search for responses',
    description: 'Searches for responses across all test persons in a workspace by value, variable ID, unit name, booklet name, and other filters'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiQuery({
    name: 'value',
    required: false,
    description: 'Value to search for in responses',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Variable ID to search for',
    type: String
  })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Name of the unit to search for',
    type: String
  })
  @ApiQuery({
    name: 'bookletName',
    required: false,
    description: 'Name of the booklet to search for',
    type: String
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Status of the response',
    type: String
  })
  @ApiQuery({
    name: 'codedStatus',
    required: false,
    description: 'Coded status of the response',
    type: String
  })
  @ApiQuery({
    name: 'group',
    required: false,
    description: 'Group of the person',
    type: String
  })
  @ApiQuery({
    name: 'code',
    required: false,
    description: 'Code of the person',
    type: String
  })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to filter by: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-based)',
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
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'ID of the response' },
              variableId: { type: 'string', description: 'ID of the variable' },
              value: { type: 'string', description: 'Value of the response' },
              status: { type: 'string', description: 'Status of the response' },
              code: { type: 'number', nullable: true, description: 'Code of the response' },
              score: { type: 'number', nullable: true, description: 'Score of the response' },
              codedStatus: { type: 'string', nullable: true, description: 'Coded status of the response' },
              unitId: { type: 'number', description: 'ID of the unit' },
              unitName: { type: 'string', description: 'Name of the unit' },
              unitAlias: { type: 'string', nullable: true, description: 'Alias of the unit' },
              bookletId: { type: 'number', description: 'ID of the booklet' },
              bookletName: { type: 'string', description: 'Name of the booklet' },
              personId: { type: 'number', description: 'ID of the person' },
              personLogin: { type: 'string', description: 'Login of the person' },
              personCode: { type: 'string', description: 'Code of the person' },
              personGroup: { type: 'string', description: 'Group of the person' }
            }
          }
        },
        total: { type: 'number', description: 'Total number of items' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to search for responses' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async searchResponses(
    @Param('workspace_id') workspace_id: number,
      @Query('value') value?: string,
      @Query('variableId') variableId?: string,
      @Query('unitName') unitName?: string,
      @Query('bookletName') bookletName?: string,
      @Query('status') status?: string,
      @Query('codedStatus') codedStatus?: string,
      @Query('group') group?: string,
      @Query('code') code?: string,
      @Query('version') version?: 'v1' | 'v2' | 'v3',
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<{
        data: {
          responseId: number;
          variableId: string;
          value: string;
          status: string;
          code?: number;
          score?: number;
          codedStatus?: string;
          unitId: number;
          unitName: string;
          unitAlias: string | null;
          bookletId: number;
          bookletName: string;
          personId: number;
          personLogin: string;
          personCode: string;
          personGroup: string;
        }[];
        total: number;
      }> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    try {
      return await this.workspaceTestResultsService.searchResponses(
        workspace_id,
        {
          value,
          variableId,
          unitName,
          bookletName,
          status,
          codedStatus,
          group,
          code,
          version
        },
        { page, limit }
      );
    } catch (error) {
      logger.error(`Error searching for responses: ${error}`);
      throw new BadRequestException(`Failed to search for responses. ${error.message}`);
    }
  }

  @Get(':workspace_id/booklets/search')
  @ApiOperation({
    summary: 'Search for booklets by name',
    description: 'Searches for booklets with a specific name across all test persons in a workspace'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiQuery({
    name: 'bookletName',
    required: true,
    description: 'Name of the booklet to search for',
    type: String
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-based)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiOkResponse({
    description: 'Booklets retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              bookletId: { type: 'number', description: 'ID of the booklet' },
              bookletName: { type: 'string', description: 'Name of the booklet' },
              personId: { type: 'number', description: 'ID of the person' },
              personLogin: { type: 'string', description: 'Login of the person' },
              personCode: { type: 'string', description: 'Code of the person' },
              personGroup: { type: 'string', description: 'Group of the person' },
              units: {
                type: 'array',
                description: 'Units in the booklet',
                items: {
                  type: 'object',
                  properties: {
                    unitId: { type: 'number', description: 'ID of the unit' },
                    unitName: { type: 'string', description: 'Name of the unit' },
                    unitAlias: { type: 'string', nullable: true, description: 'Alias of the unit' }
                  }
                }
              }
            }
          }
        },
        total: { type: 'number', description: 'Total number of items' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to search for booklets' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findBookletsByName(
    @Param('workspace_id') workspace_id: number,
      @Query('bookletName') bookletName: string,
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<{
        data: {
          bookletId: number;
          bookletName: string;
          personId: number;
          personLogin: string;
          personCode: string;
          personGroup: string;
          units: {
            unitId: number;
            unitName: string;
            unitAlias: string | null;
          }[];
        }[];
        total: number;
      }> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!bookletName) {
      throw new BadRequestException('Booklet name is required.');
    }

    try {
      return await this.workspaceTestResultsService.findBookletsByName(
        workspace_id,
        bookletName,
        { page, limit }
      );
    } catch (error) {
      logger.error(`Error searching for booklets: ${error}`);
      throw new BadRequestException(`Failed to search for booklets. ${error.message}`);
    }
  }

  @Get(':workspace_id/units/search')
  @ApiOperation({
    summary: 'Search for units by name',
    description: 'Searches for units with a specific name across all test persons in a workspace'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiQuery({
    name: 'unitName',
    required: true,
    description: 'Name of the unit to search for',
    type: String
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-based)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiOkResponse({
    description: 'Units retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitId: { type: 'number', description: 'ID of the unit' },
              unitName: { type: 'string', description: 'Name of the unit' },
              unitAlias: { type: 'string', nullable: true, description: 'Alias of the unit' },
              bookletId: { type: 'number', description: 'ID of the booklet' },
              bookletName: { type: 'string', description: 'Name of the booklet' },
              personId: { type: 'number', description: 'ID of the person' },
              personLogin: { type: 'string', description: 'Login of the person' },
              personCode: { type: 'string', description: 'Code of the person' },
              personGroup: { type: 'string', description: 'Group of the person' },
              tags: {
                type: 'array',
                description: 'Tags associated with the unit',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    unitId: { type: 'number' },
                    tag: { type: 'string' },
                    color: { type: 'string', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' }
                  }
                }
              },
              responses: {
                type: 'array',
                description: 'Responses associated with the unit',
                items: {
                  type: 'object',
                  properties: {
                    variableId: { type: 'string', description: 'ID of the variable' },
                    value: { type: 'string', description: 'Value of the response' },
                    status: { type: 'string', description: 'Status of the response' },
                    code: { type: 'number', nullable: true, description: 'Code of the response' },
                    score: { type: 'number', nullable: true, description: 'Score of the response' },
                    codedStatus: { type: 'string', nullable: true, description: 'Coded status of the response' }
                  }
                }
              }
            }
          }
        },
        total: { type: 'number', description: 'Total number of items' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Failed to search for units' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findUnitsByName(
    @Param('workspace_id') workspace_id: number,
      @Query('unitName') unitName: string,
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<{
        data: {
          unitId: number;
          unitName: string;
          unitAlias: string | null;
          bookletId: number;
          bookletName: string;
          personId: number;
          personLogin: string;
          personCode: string;
          personGroup: string;
          tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
          responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
        }[];
        total: number;
      }> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!unitName) {
      throw new BadRequestException('Unit name is required.');
    }

    try {
      return await this.workspaceTestResultsService.findUnitsByName(workspace_id, unitName, { page, limit });
    } catch (error) {
      logger.error(`Error searching for units with name ${unitName}: ${error}`);
      throw new BadRequestException(`Failed to search for units with name ${unitName}. ${error.message}`);
    }
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
  @ApiQuery({
    name: 'overwriteExisting',
    type: Boolean,
    required: false,
    description: 'Whether to overwrite existing logs/responses (default: true)'
  })
  async addTestResults(
    @Param('workspace_id') workspace_id: number,
      @Param('resultType') resultType: 'logs' | 'responses',
      @UploadedFiles() files: Express.Multer.File[],
      @Query('overwriteExisting') overwriteExisting?: string
  ): Promise<boolean> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded.');
    }
    const shouldOverwrite = overwriteExisting !== 'false';

    logger.log(`Uploading test results with overwriteExisting=${shouldOverwrite}`);

    try {
      return await this.uploadResults.uploadTestResults(workspace_id, files, resultType, shouldOverwrite);
    } catch (error) {
      logger.error('Error uploading test results!');
      throw new BadRequestException('Uploading test results failed. Please try again.');
    }
  }

  @Get(':workspace_id/export/sqlite')
  @ApiOperation({
    summary: 'Export workspace test results to SQLite',
    description: 'Exports workspace-specific test results data to SQLite format with streaming support'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiResponse({
    status: 200,
    description: 'SQLite database file downloaded successfully',
    content: {
      'application/x-sqlite3': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async exportWorkspaceToSqlite(
    @Param('workspace_id') workspace_id: number,
      @Res() response: Response
  ): Promise<void> {
    try {
      response.setHeader('Content-Type', 'application/x-sqlite3');
      response.setHeader('Content-Disposition', `attachment; filename=workspace-${workspace_id}-export-${new Date().toISOString().split('T')[0]}.sqlite`);

      await this.databaseExportService.exportWorkspaceToSqliteStream(response, workspace_id);
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({ error: 'Failed to export workspace database to SQLite' });
      }
    }
  }
}
