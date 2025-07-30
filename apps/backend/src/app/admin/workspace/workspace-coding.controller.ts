import {
  Controller,
  Get, Param, Post, Query, Res, UseGuards, Body
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam, ApiQuery, ApiTags, ApiBody
} from '@nestjs/swagger';
import { Response } from 'express';
import { CodingStatistics } from '../../database/services/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { WorkspaceCodingService } from '../../database/services/workspace-coding.service';
import { PersonService } from '../../database/services/person.service';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  constructor(
    private workspaceCodingService: WorkspaceCodingService,
    private personService: PersonService
  ) {}

  @Get(':workspace_id/coding')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async codeTestPersons(@Query('testPersons') testPersons: string, @WorkspaceId() workspace_id: number): Promise<CodingStatistics> {
    return this.workspaceCodingService.codeTestPersons(workspace_id, testPersons);
  }

  @Get(':workspace_id/coding/manual')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async getManualTestPersons(@Query('testPersons') testPersons: string, @WorkspaceId() workspace_id: number): Promise<unknown> {
    return this.workspaceCodingService.getManualTestPersons(workspace_id, testPersons);
  }

  @Get(':workspace_id/coding/coding-list')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiQuery({
    name: 'identity',
    required: false,
    description: 'User identity for token generation',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
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
    description: 'List of incomplete coding items retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unit_key: { type: 'string' },
              unit_alias: { type: 'string' },
              login_name: { type: 'string' },
              login_code: { type: 'string' },
              booklet_id: { type: 'string' },
              variable_id: { type: 'string' },
              variable_page: { type: 'string' },
              variable_anchor: { type: 'string' },
              url: { type: 'string' }
            }
          }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  async getCodingList(@WorkspaceId() workspace_id: number, @Query('authToken') authToken: string, @Query('serverUrl') serverUrl: string, @Query('page') page: number = 1, @Query('limit') limit: number = 20): Promise<{
    data: {
      unit_key: string;
      unit_alias: string;
      login_name: string;
      login_code: string;
      booklet_id: string;
      variable_id: string;
      variable_page: string;
      variable_anchor: string;
      url: string;
    }[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [items, total] = await this.workspaceCodingService.getCodingList(workspace_id, authToken, serverUrl, { page, limit });
    return {
      data: items,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/coding/coding-list/csv')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding list exported as CSV',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingListAsCsv(@WorkspaceId() workspace_id: number, @Res() res: Response): Promise<void> {
    const csvData = await this.workspaceCodingService.getCodingListAsCsv(workspace_id);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="coding-list-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvData);
  }

  @Get(':workspace_id/coding/coding-list/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding list exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingListAsExcel(@WorkspaceId() workspace_id: number, @Res() res: Response): Promise<void> {
    const excelData = await this.workspaceCodingService.getCodingListAsExcel(workspace_id);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="coding-list-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(excelData);
  }

  @Get(':workspace_id/coding/statistics')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async getCodingStatistics(@WorkspaceId() workspace_id: number): Promise<CodingStatistics> {
    return this.workspaceCodingService.getCodingStatistics(workspace_id);
  }

  @Get(':workspace_id/coding/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the background job' })
  @ApiOkResponse({
    description: 'Job status retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'paused'],
          description: 'Current status of the job'
        },
        progress: {
          type: 'number',
          description: 'Progress percentage (0-100)'
        },
        result: {
          type: 'object',
          description: 'Result of the job (only available when status is completed)',
          properties: {
            totalResponses: { type: 'number' },
            statusCounts: {
              type: 'object',
              additionalProperties: { type: 'number' }
            }
          }
        },
        error: {
          type: 'string',
          description: 'Error message (only available when status is failed)'
        }
      }
    }
  })
  async getJobStatus(@Param('jobId') jobId: string): Promise<{ status: string; progress: number; result?: CodingStatistics; error?: string } | { error: string }> {
    const status = this.workspaceCodingService.getJobStatus(jobId);
    if (!status) {
      return { error: `Job with ID ${jobId} not found` };
    }
    return status;
  }

  @Get(':workspace_id/coding/job/:jobId/cancel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the background job to cancel' })
  @ApiOkResponse({
    description: 'Job cancellation request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the cancellation request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the cancellation request'
        }
      }
    }
  })
  async cancelJob(@Param('jobId') jobId: string): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.cancelJob(jobId);
  }

  @Get(':workspace_id/coding/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of all jobs retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Unique identifier for the job'
          },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'paused'],
            description: 'Current status of the job'
          },
          progress: {
            type: 'number',
            description: 'Progress percentage (0-100)'
          },
          result: {
            type: 'object',
            description: 'Result of the job (only available when status is completed)',
            properties: {
              totalResponses: { type: 'number' },
              statusCounts: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          },
          error: {
            type: 'string',
            description: 'Error message (only available when status is failed)'
          },
          workspaceId: {
            type: 'number',
            description: 'ID of the workspace the job belongs to'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time when the job was created'
          }
        }
      }
    }
  })
  async getAllJobs(@WorkspaceId() workspace_id: number): Promise<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]> {
    return this.workspaceCodingService.getBullJobs(workspace_id);
  }

  @Get(':workspace_id/coding/bull-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of jobs from Redis Bull retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Unique identifier for the job'
          },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'paused'],
            description: 'Current status of the job'
          },
          progress: {
            type: 'number',
            description: 'Progress percentage (0-100)'
          },
          result: {
            type: 'object',
            description: 'Result of the job (only available when status is completed)',
            properties: {
              totalResponses: { type: 'number' },
              statusCounts: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          },
          error: {
            type: 'string',
            description: 'Error message (only available when status is failed)'
          },
          workspaceId: {
            type: 'number',
            description: 'ID of the workspace the job belongs to'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time when the job was created'
          },
          groupNames: {
            type: 'string',
            description: 'Group names for the job'
          },
          durationMs: {
            type: 'number',
            description: 'Duration of the job in milliseconds'
          },
          completedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time when the job was completed'
          }
        }
      }
    }
  })
  async getBullJobs(@WorkspaceId() workspace_id: number): Promise<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]> {
    return this.workspaceCodingService.getBullJobs(workspace_id);
  }

  @Get(':workspace_id/coding/groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of all test person groups in the workspace retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'string',
        description: 'Group name'
      }
    }
  })
  async getWorkspaceGroups(@WorkspaceId() workspace_id: number): Promise<string[]> {
    return this.personService.getWorkspaceGroups(workspace_id);
  }

  @Get(':workspace_id/coding/job/:jobId/pause')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the background job to pause' })
  @ApiOkResponse({
    description: 'Job pause request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the pause request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the pause request'
        }
      }
    }
  })
  async pauseJob(@Param('jobId') jobId: string): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.pauseJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/resume')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the background job to resume' })
  @ApiOkResponse({
    description: 'Job resume request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the resume request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the resume request'
        }
      }
    }
  })
  async resumeJob(@Param('jobId') jobId: string): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.resumeJob(jobId);
  }

  @Get(':workspace_id/coding/missings-profiles')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of missings profiles retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Label of the missings profile'
          }
        }
      }
    }
  })
  async getMissingsProfiles(@WorkspaceId() workspace_id: number): Promise<{ label: string }[]> {
    return this.workspaceCodingService.getMissingsProfiles(workspace_id);
  }

  @Post(':workspace_id/coding/codebook')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Codebook generation parameters',
    schema: {
      type: 'object',
      properties: {
        missingsProfile: {
          type: 'string',
          description: 'Name of the missings profile to use'
        },
        contentOptions: {
          type: 'object',
          description: 'Options for codebook content generation',
          properties: {
            exportFormat: { type: 'string' },
            missingsProfile: { type: 'string' },
            hasOnlyManualCoding: { type: 'boolean' },
            hasGeneralInstructions: { type: 'boolean' },
            hasDerivedVars: { type: 'boolean' },
            hasOnlyVarsWithCodes: { type: 'boolean' },
            hasClosedVars: { type: 'boolean' },
            codeLabelToUpper: { type: 'boolean' },
            showScore: { type: 'boolean' },
            hideItemVarRelation: { type: 'boolean' }
          }
        },
        unitList: {
          type: 'array',
          items: { type: 'number' },
          description: 'List of unit IDs to include in the codebook'
        }
      },
      required: ['missingsProfile', 'contentOptions', 'unitList']
    }
  })
  @ApiOkResponse({
    description: 'Codebook generated successfully.',
    schema: {
      type: 'string',
      format: 'binary',
      description: 'Generated codebook file'
    }
  })
  async generateCodebook(
    @WorkspaceId() workspace_id: number,
      @Body() body: {
        missingsProfile: string;
        contentOptions: {
          exportFormat: string;
          missingsProfile: string;
          hasOnlyManualCoding: boolean;
          hasGeneralInstructions: boolean;
          hasDerivedVars: boolean;
          hasOnlyVarsWithCodes: boolean;
          hasClosedVars: boolean;
          codeLabelToUpper: boolean;
          showScore: boolean;
          hideItemVarRelation: boolean;
        };
        unitList: number[];
      },
      @Res() res: Response
  ): Promise<void> {
    const { missingsProfile, contentOptions, unitList } = body;

    const codebook = await this.workspaceCodingService.generateCodebook(
      workspace_id,
      missingsProfile,
      contentOptions,
      unitList
    );

    if (!codebook) {
      res.status(404).send('Failed to generate codebook');
      return;
    }

    const contentType = contentOptions.exportFormat === 'docx' ?
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
      'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=codebook.${contentOptions.exportFormat.toLowerCase()}`);
    res.send(codebook);
  }

  @Get(':workspace_id/coding/variable-analysis')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for generating replay URLs',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 100, max: 500)',
    type: Number
  })
  @ApiQuery({
    name: 'unitId',
    required: false,
    description: 'Filter by unit ID',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'derivation',
    required: false,
    description: 'Filter by derivation type',
    type: String
  })
  @ApiOkResponse({
    description: 'Variable analysis data retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              replayUrl: { type: 'string', description: 'Link to the replay of unit with its responses' },
              unitId: { type: 'string', description: 'Unit ID' },
              variableId: { type: 'string', description: 'Variable ID' },
              derivation: { type: 'string', description: 'Derivation' },
              code: { type: 'string', description: 'Code' },
              description: { type: 'string', description: 'Description' },
              score: { type: 'number', description: 'Score' },
              occurrenceCount: { type: 'number', description: 'How often this unitId in combination with variableId with that code is in responses' },
              totalCount: { type: 'number', description: 'Total amount of that combination variableId and unit Id' },
              relativeOccurrence: { type: 'number', description: 'Relative occurrence (for bar chart)' }
            }
          }
        },
        total: { type: 'number', description: 'Total number of items' },
        page: { type: 'number', description: 'Current page number' },
        limit: { type: 'number', description: 'Number of items per page' }
      }
    }
  })
  async getVariableAnalysis(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl?: string,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 100,
                   @Query('unitId') unitId?: string,
                   @Query('variableId') variableId?: string,
                   @Query('derivation') derivation?: string
  ): Promise<{
        data: VariableAnalysisItemDto[];
        total: number;
        page: number;
        limit: number;
      }> {
    // Validate and sanitize pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500

    if (unitId || variableId || derivation) {
      console.log(`Applying filters - unitId: ${unitId || 'none'}, variableId: ${variableId || 'none'}, derivation: ${derivation || 'none'}`);
    }

    return this.workspaceCodingService.getVariableAnalysis(
      workspace_id,
      authToken,
      serverUrl,
      validPage,
      validLimit,
      unitId,
      variableId,
      derivation
    );
  }
}
