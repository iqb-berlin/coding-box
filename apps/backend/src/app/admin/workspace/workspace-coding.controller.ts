import {
  Controller,
  Get, Param, Post, Put, Query, Res, UseGuards, Body, Delete
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
import { CoderTrainingService } from '../../database/services/coder-training.service';
import { CodingListService } from '../../database/services/coding-list.service';
import { PersonService } from '../../database/services/person.service';
import { ResponseEntity } from '../../database/entities/response.entity';
import { JobDefinition } from '../../database/entities/job-definition.entity';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ValidateCodingCompletenessRequestDto } from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ExportValidationResultsRequestDto } from '../../../../../../api-dto/coding/export-validation-results-request.dto';
import { ExternalCodingImportDto } from '../../../../../../api-dto/coding/external-coding-import.dto';
import { MissingsProfilesService } from '../../database/services/missings-profiles.service';
import { JobDefinitionService } from '../../database/services/job-definition.service';
import { CodingJob } from '../../database/entities/coding-job.entity';
import { CreateJobDefinitionDto } from '../coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../coding-job/dto/approve-job-definition.dto';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  constructor(
    private workspaceCodingService: WorkspaceCodingService,
    private jobDefinitionService: JobDefinitionService,
    private missingsProfilesService: MissingsProfilesService,
    private personService: PersonService,
    private codingListService: CodingListService,
    private coderTrainingService: CoderTrainingService
  ) {}

  @Get(':workspace_id/coding')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'autoCoderRun',
    required: false,
    description: 'Autocoder run type: 1 (standard) or 2 (uses v2 as input, saves to v3)',
    enum: [1, 2],
    example: 1
  })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async codeTestPersons(@Query('testPersons') testPersons: string, @WorkspaceId() workspace_id: number, @Query('autoCoderRun') autoCoderRun: number = 1): Promise<CodingStatistics> {
    return this.workspaceCodingService.codeTestPersons(workspace_id, testPersons, autoCoderRun);
  }

  @Get(':workspace_id/coding/manual')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async getManualTestPersons(@Query('testPersons') testPersons: string, @WorkspaceId() /* eslint-disable-next-line @typescript-eslint/no-unused-vars */ workspace_id: number): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.workspaceCodingService.getManualTestPersons(workspace_id, testPersons);
  }

  @Get(':workspace_id/coding/coding-list')
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
  async getCodingListAsCsv(@WorkspaceId() workspace_id: number, @Query('authToken') authToken: string, @Query('serverUrl') serverUrl: string, @Res() res: Response): Promise<void> {
    const csvStream = await this.codingListService.getCodingListCsvStream(workspace_id, authToken || '', serverUrl || '');
    csvStream.pipe(res);
  }

  @Get(':workspace_id/coding/coding-list/excel')
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
  async getCodingListAsExcel(@WorkspaceId() workspace_id: number, @Query('authToken') authToken: string, @Query('serverUrl') serverUrl: string, @Res() res: Response): Promise<void> {
    const excelData = await this.codingListService.getCodingListAsExcel(workspace_id, authToken || '', serverUrl || '');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="coding-list-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(excelData);
  }

  @Get(':workspace_id/coding/statistics')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to get statistics for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
  })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async getCodingStatistics(@WorkspaceId() workspace_id: number, @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1'): Promise<CodingStatistics> {
    return this.workspaceCodingService.getCodingStatistics(workspace_id, version);
  }

  @Post(':workspace_id/coding/statistics/job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics job created successfully.',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  async createCodingStatisticsJob(@WorkspaceId() workspace_id: number): Promise<{ jobId: string; message: string }> {
    return this.workspaceCodingService.createCodingStatisticsJob(workspace_id);
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
    const status = await this.workspaceCodingService.getJobStatus(jobId);
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

  @Get(':workspace_id/coding/job/:jobId/delete')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the background job to delete' })
  @ApiOkResponse({
    description: 'Job deletion request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the deletion request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the deletion request'
        }
      }
    }
  })
  async deleteJob(@Param('jobId') jobId: string): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.deleteJob(jobId);
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
    autoCoderRun?: number;
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

  @Get(':workspace_id/coding/job/:jobId/restart')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the failed background job to restart' })
  @ApiOkResponse({
    description: 'Job restart request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the restart request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the restart request'
        },
        jobId: {
          type: 'string',
          description: 'ID of the new job created from the restart'
        }
      }
    }
  })
  async restartJob(@Param('jobId') jobId: string): Promise<{ success: boolean; message: string; jobId?: string }> {
    return this.workspaceCodingService.restartJob(jobId);
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
    return this.missingsProfilesService.getMissingsProfiles(workspace_id);
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
          description: 'Name of the missings profile to use',
          example: 'IQB-Standard'
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
        missingsProfile: number;
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
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500

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

  @Post(':workspace_id/coding/validate-completeness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Expected combinations to validate with optional pagination',
    type: ValidateCodingCompletenessRequestDto
  })
  @ApiOkResponse({
    description: 'Validation results with pagination support',
    type: ValidateCodingCompletenessResponseDto
  })
  async validateCodingCompleteness(
    @WorkspaceId() workspace_id: number,
      @Body() request: ValidateCodingCompletenessRequestDto
  ): Promise<ValidateCodingCompletenessResponseDto> {
    // Extract and validate pagination parameters
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(Math.max(1, request.pageSize || 50), 500); // Max 500 items per page

    return this.workspaceCodingService.validateCodingCompleteness(
      workspace_id,
      request.expectedCombinations,
      page,
      pageSize
    );
  }

  @Post(':workspace_id/coding/validate-completeness/export-excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Cache key to export validation results from Redis cache',
    type: ExportValidationResultsRequestDto
  })
  @ApiOkResponse({
    description: 'Validation results exported as Excel from cached data',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async validateAndExportCodingCompleteness(
    @WorkspaceId() workspace_id: number,
      @Body() request: ExportValidationResultsRequestDto,
      @Res() res: Response
  ): Promise<void> {
    const excelData = await this.workspaceCodingService.exportValidationResultsAsExcel(
      workspace_id,
      request.cacheKey
    );

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `validation-results-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelData);
  }

  @Get(':workspace_id/coding/incomplete-variables')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiOkResponse({
    description: 'CODING_INCOMPLETE variables retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Unit name' },
          variableId: { type: 'string', description: 'Variable ID' }
        }
      }
    }
  })
  async getCodingIncompleteVariables(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string
  ): Promise<{ unitName: string; variableId: string }[]> {
    return this.workspaceCodingService.getCodingIncompleteVariables(
      workspace_id,
      unitName
    );
  }

  @Post(':workspace_id/coding/external-coding-import/stream')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'External coding file upload (CSV/Excel) with streaming progress',
    type: ExternalCodingImportDto
  })
  @ApiOkResponse({
    description: 'External coding import with progress streaming',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string'
        }
      }
    }
  })
  async importExternalCodingWithProgress(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto,
      @Res() res: Response
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    try {
      const result = await this.workspaceCodingService.importExternalCodingWithProgress(
        workspace_id,
        body,
        (progress: number, message: string) => {
          res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
        }
      );

      // Send final result
      res.write(`data: ${JSON.stringify({
        progress: 100,
        message: 'Import completed',
        result
      })}\n\n`);
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({
        progress: 0,
        message: `Import failed: ${error.message}`,
        error: true
      })}\n\n`);
      res.end();
    }
  }

  @Post(':workspace_id/coding/external-coding-import')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'External coding file upload (CSV/Excel)',
    type: ExternalCodingImportDto
  })
  async importExternalCoding(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto
  ): Promise<{
        message: string;
        processedRows: number;
        updatedRows: number;
        errors: string[];
        affectedRows: Array<{
          unitAlias: string;
          variableId: string;
          personCode?: string;
          personLogin?: string;
          personGroup?: string;
          bookletName?: string;
          originalCodedStatus: string;
          originalCode: number | null;
          originalScore: number | null;
          updatedCodedStatus: string | null;
          updatedCode: number | null;
          updatedScore: number | null;
        }>;
      }> {
    return this.workspaceCodingService.importExternalCoding(workspace_id, body);
  }

  @Post(':workspace_id/coding/coder-training-packages')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Generate coder training packages based on CODING_INCOMPLETE responses for specific variable and unit combinations',
    schema: {
      type: 'object',
      properties: {
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Coder training packages generated successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          coderId: { type: 'number' },
          coderName: { type: 'string' },
          responses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                responseId: { type: 'number' },
                unitAlias: { type: 'string' },
                variableId: { type: 'string' },
                unitName: { type: 'string' },
                value: { type: 'string' },
                personLogin: { type: 'string' },
                personCode: { type: 'string' },
                personGroup: { type: 'string' },
                bookletName: { type: 'string' },
                variable: { type: 'string' }
              }
            }
          }
        }
      }
    }
  })
  async generateCoderTrainingPackages(
    @WorkspaceId() workspace_id: number,
      @Body() body: {
        selectedCoders: { id: number; name: string }[];
        variableConfigs: { variableId: string; unitId: string; sampleCount: number }[];
      }
  ): Promise<{
        coderId: number;
        coderName: string;
        responses: {
          responseId: number;
          unitAlias: string;
          variableId: string;
          unitName: string;
          value: string;
          personLogin: string;
          personCode: string;
          personGroup: string;
          bookletName: string;
          variable: string;
        }[];
      }[]> {
    return this.coderTrainingService.generateCoderTrainingPackages(
      workspace_id,
      body.selectedCoders,
      body.variableConfigs
    );
  }

  @Get(':workspace_id/coding/coder-trainings')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of coder trainings retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Training ID' },
          workspace_id: { type: 'number', description: 'Workspace ID' },
          label: { type: 'string', description: 'Training label' },
          created_at: { type: 'string', format: 'date-time', description: 'Creation date' },
          updated_at: { type: 'string', format: 'date-time', description: 'Last update date' },
          jobsCount: { type: 'number', description: 'Number of coding jobs in this training' }
        }
      }
    }
  })
  async getCoderTrainings(@WorkspaceId() workspace_id: number): Promise<{
    id: number;
    workspace_id: number;
    label: string;
    created_at: Date;
    updated_at: Date;
    jobsCount: number;
  }[]> {
    return this.coderTrainingService.getCoderTrainings(workspace_id);
  }

  @Post(':workspace_id/coding/coder-training-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create persistent coding jobs for coder training',
    schema: {
      type: 'object',
      properties: {
        trainingLabel: { type: 'string', description: 'Label for the coder training session' },
        missingsProfileId: { type: 'number', description: 'ID of the missings profile to assign to all created coding jobs' },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        }
      },
      required: ['trainingLabel', 'selectedCoders', 'variableConfigs']
    }
  })
  @ApiOkResponse({
    description: 'Coding jobs created successfully for coder training',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobsCreated: { type: 'number' },
        message: { type: 'string' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coderId: { type: 'number' },
              coderName: { type: 'string' },
              jobId: { type: 'number' },
              jobName: { type: 'string' }
            }
          }
        },
        trainingId: {
          type: 'number',
          description: 'ID of the created coder training session'
        }
      }
    }
  })
  async createCoderTrainingJobs(
    @WorkspaceId() workspace_id: number,
      @Body() body: {
        trainingLabel: string;
        missingsProfileId?: number;
        selectedCoders: { id: number; name: string }[];
        variableConfigs: { variableId: string; unitId: string; sampleCount: number }[];
      }
  ): Promise<{ success: boolean; jobsCreated: number; message: string; jobs: { coderId: number; coderName: string; jobId: number; jobName: string }[]; trainingId?: number }> {
    return this.coderTrainingService.createCoderTrainingJobs(
      workspace_id,
      body.selectedCoders,
      body.variableConfigs,
      body.trainingLabel,
      body.missingsProfileId
    );
  }

  @Get(':workspace_id/coding/compare-training-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingIds',
    required: true,
    description: 'Comma-separated list of training IDs to compare',
    type: String
  })
  @ApiOkResponse({
    description: 'Comparison of coding results across training components',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Name of the unit' },
          variableId: { type: 'string', description: 'Variable ID' },
          trainings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trainingId: { type: 'number', description: 'Training ID' },
                trainingLabel: { type: 'string', description: 'Training label' },
                code: { type: 'string', description: 'Code given by coders in this training' },
                score: { type: 'number', description: 'Score given by coders in this training' }
              }
            }
          }
        }
      }
    }
  })
  async compareTrainingCodingResults(
    @WorkspaceId() workspace_id: number,
      @Query('trainingIds') trainingIdsQuery: string
  ): Promise<Array<{
        unitName: string;
        variableId: string;
        trainings: Array<{
          trainingId: number;
          trainingLabel: string;
          code: string | null;
          score: number | null;
        }>;
      }>> {
    const trainingIds = trainingIdsQuery.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !Number.isNaN(id));

    if (trainingIds.length === 0) {
      throw new Error('At least one valid training ID must be provided');
    }

    return this.coderTrainingService.getTrainingCodingComparison(workspace_id, trainingIds);
  }

  @Get(':workspace_id/coding/compare-within-training')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingId',
    required: true,
    description: 'ID of the training to compare coders within',
    type: Number
  })
  @ApiOkResponse({
    description: 'Comparison of coding results within a single training by individual coders',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Name of the unit' },
          variableId: { type: 'string', description: 'Variable ID' },
          personCode: { type: 'string', description: 'Person code' },
          testPerson: { type: 'string', description: 'Test person details' },
          givenAnswer: { type: 'string', description: 'Given answer' },
          coders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                jobId: { type: 'number', description: 'Job ID' },
                coderName: { type: 'string', description: 'Name of the coder' },
                code: { type: 'string', description: 'Code given by this coder' },
                score: { type: 'number', description: 'Score given by this coder' }
              }
            }
          }
        }
      }
    }
  })
  async compareWithinTrainingCodingResults(
    @WorkspaceId() workspace_id: number,
      @Query('trainingId') trainingId: number
  ): Promise<Array<{
        unitName: string;
        variableId: string;
        personCode: string;
        testPerson: string;
        givenAnswer: string;
        coders: Array<{
          jobId: number;
          coderName: string;
          code: string | null;
          score: number | null;
        }>;
      }>> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    // Get coding results for all jobs within the training
    return this.coderTrainingService.getWithinTrainingCodingComparison(workspace_id, trainingId);
  }

  @Put(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'trainingId', type: Number, description: 'ID of the coder training to update' })
  @ApiBody({
    description: 'New label for the coder training',
    schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'New label for the coder training'
        }
      },
      required: ['label']
    }
  })
  @ApiOkResponse({
    description: 'Coder training label updated successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the update was successful' },
        message: { type: 'string', description: 'Result message' }
      }
    }
  })
  async updateCoderTrainingLabel(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: { label: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    if (!body.label || body.label.trim().length === 0) {
      throw new Error('Valid label must be provided');
    }

    return this.coderTrainingService.updateCoderTrainingLabel(workspace_id, trainingId, body.label.trim());
  }

  @Get(':workspace_id/coding/coder-trainings/:trainingId/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'trainingId', type: Number, description: 'ID of the coder training' })
  @ApiOkResponse({
    description: 'List of coding jobs for the specified coder training.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job ID' },
          name: { type: 'string', description: 'Job name' },
          description: { type: 'string', description: 'Job description' },
          status: { type: 'string', description: 'Job status' },
          created_at: { type: 'string', format: 'date-time', description: 'Creation date' },
          coder: {
            type: 'object',
            properties: {
              userId: { type: 'number', description: 'Coder user ID' },
              username: { type: 'string', description: 'Coder username' }
            }
          },
          unitsCount: { type: 'number', description: 'Number of coding units in the job' }
        }
      }
    }
  })
  async getCodingJobsForTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<Array<{
        id: number;
        name: string;
        description?: string;
        status: string;
        created_at: Date;
        coder: {
          userId: number;
          username: string;
        };
        unitsCount: number;
      }>> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.getCodingJobsForTraining(workspace_id, trainingId);
  }

  @Delete(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'trainingId', type: Number, description: 'ID of the coder training to delete' })
  @ApiOkResponse({
    description: 'Coder training deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the deletion was successful' },
        message: { type: 'string', description: 'Result message' }
      }
    }
  })
  async deleteCoderTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<{ success: boolean; message: string }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.deleteCoderTraining(workspace_id, trainingId);
  }

  @Get(':workspace_id/coding/responses/:status')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'status', type: String, description: 'Response status to filter by' })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to get responses for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
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
              id: { type: 'number', description: 'Response ID' },
              unitId: { type: 'string', description: 'Unit ID' },
              variableid: { type: 'string', description: 'Variable ID' },
              value: { type: 'string', description: 'Response value' },
              status: { type: 'string', description: 'Response status' },
              codedstatus: { type: 'string', description: 'Coded status' },
              code_v1: { type: 'number', description: 'Code for version 1' },
              score_v1: { type: 'number', description: 'Score for version 1' },
              code_v2: { type: 'number', description: 'Code for version 2' },
              score_v2: { type: 'number', description: 'Score for version 2' },
              code_v3: { type: 'number', description: 'Code for version 3' },
              score_v3: { type: 'number', description: 'Score for version 3' }
            }
          }
        },
        total: { type: 'number', description: 'Total number of items' },
        page: { type: 'number', description: 'Current page number' },
        limit: { type: 'number', description: 'Number of items per page' }
      }
    }
  })
  async getResponsesByStatus(
    @WorkspaceId() workspace_id: number,
      @Param('status') status: string,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1',
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 100
  ): Promise<{
        data: ResponseEntity[];
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500

    return this.workspaceCodingService.getResponsesByStatus(
      workspace_id,
      status,
      version,
      validPage,
      validLimit
    );
  }

  @Post(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create a new job definition',
    type: CreateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition created successfully.'
  })
  async createJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Body() createDto: CreateJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.createJobDefinition(createDto);
  }

  @Get(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of job definitions retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          status: { type: 'string' },
          assigned_variables: { type: 'array' },
          assigned_variable_bundles: { type: 'array' },
          assigned_coders: { type: 'array' },
          duration_seconds: { type: 'number' },
          max_coding_cases: { type: 'number' },
          double_coding_absolute: { type: 'number' },
          double_coding_percentage: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getJobDefinitions(@WorkspaceId() workspace_id: number): Promise<JobDefinition[]> {
    return this.jobDefinitionService.getJobDefinitions(workspace_id);
  }

  @Get(':workspace_id/coding/job-definitions/approved')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of approved job definitions retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          assigned_variables: { type: 'array' },
          assigned_variable_bundles: { type: 'array' },
          assigned_coders: { type: 'array' },
          duration_seconds: { type: 'number' },
          max_coding_cases: { type: 'number' },
          double_coding_absolute: { type: 'number' },
          double_coding_percentage: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getApprovedJobDefinitions(): Promise<JobDefinition[]> {
    return this.jobDefinitionService.getApprovedJobDefinitions();
  }

  @Get(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Job definition retrieved successfully.'
  })
  async getJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.getJobDefinition(id);
  }

  @Put(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Update job definition',
    type: UpdateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition updated successfully.'
  })
  async updateJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body() updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.updateJobDefinition(id, updateDto);
  }

  @Put(':workspace_id/coding/job-definitions/:id/approve')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Approve job definition',
    type: ApproveJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition approved successfully.'
  })
  async approveJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body() approveDto: ApproveJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.approveJobDefinition(id, approveDto);
  }

  @Delete(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Job definition deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<{ success: boolean; message: string }> {
    await this.jobDefinitionService.deleteJobDefinition(id);
    return { success: true, message: 'Job definition deleted successfully' };
  }

  @Post(':workspace_id/coding/job-definitions/:id/create-job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Coding job created successfully from job definition.'
  })
  async createCodingJobFromDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<CodingJob> {
    return this.jobDefinitionService.createCodingJobFromDefinition(id, workspace_id);
  }

  @Post(':workspace_id/coding/jobs/:jobId/apply-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: Number, description: 'Coding job ID to apply results for' })
  @ApiOkResponse({
    description: 'Coding results applied successfully to response database.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the application was successful'
        },
        updatedResponsesCount: {
          type: 'number',
          description: 'Number of responses updated'
        },
        skippedReviewCount: {
          type: 'number',
          description: 'Number of responses skipped for manual review'
        },
        message: {
          type: 'string',
          description: 'Detailed message about the operation'
        }
      }
    }
  })
  async applyCodingResults(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: number
  ): Promise<{
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      }> {
    return this.workspaceCodingService.applyCodingResults(workspace_id, jobId);
  }
}
