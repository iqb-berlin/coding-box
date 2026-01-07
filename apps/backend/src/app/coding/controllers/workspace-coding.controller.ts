import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
  Delete,
  Logger
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CodingStatistics } from '../../workspaces/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from '../../admin/workspace/access-level.guard';
import { WorkspaceGuard } from '../../admin/workspace/workspace.guard';
import { WorkspaceId } from '../../admin/workspace/workspace.decorator';
import { WorkspaceCodingService } from '../services/workspace-coding.service';
import { CoderTrainingService } from '../services/coder-training.service';
import {
  CodingListService,
  CodingItem
} from '../services/coding-list.service';
import { PersonService } from '../../workspaces/services/person.service';
import { CodingJobService } from '../services/coding-job.service';
import { CodingExportService } from '../services/coding-export.service';
import { CodingStatisticsService } from '../services/coding-statistics.service';
import {
  JobQueueService,
  ExportJobData,
  ExportJobResult
} from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { ResponseEntity } from '../../workspaces/entities/response.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ValidateCodingCompletenessRequestDto } from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ExportValidationResultsRequestDto } from '../../../../../../api-dto/coding/export-validation-results-request.dto';
import { ExternalCodingImportDto } from '../../../../../../api-dto/coding/external-coding-import.dto';
import { MissingsProfilesService } from '../services/missings-profiles.service';
import { JobDefinitionService } from '../services/job-definition.service';
import { JournalService } from '../../workspaces/services/journal.service';
import { CodingJob } from '../entities/coding-job.entity';
import { CreateJobDefinitionDto } from '../dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../dto/approve-job-definition.dto';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    id: string;
    name: string;
    workspace: string;
  };
}

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  private readonly logger = new Logger(WorkspaceCodingController.name);
  constructor(
    private workspaceCodingService: WorkspaceCodingService,
    private jobDefinitionService: JobDefinitionService,
    private missingsProfilesService: MissingsProfilesService,
    private personService: PersonService,
    private codingListService: CodingListService,
    private coderTrainingService: CoderTrainingService,
    private codingJobService: CodingJobService,
    private codingExportService: CodingExportService,
    private codingStatisticsService: CodingStatisticsService,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService,
    private journalService: JournalService
  ) {}

  @Get(':workspace_id/coding')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'autoCoderRun',
    required: false,
    description:
      'Autocoder run type: 1 (standard) or 2 (uses v2 as input, saves to v3)',
    enum: [1, 2],
    example: 1
  })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async codeTestPersons(
    @Query('testPersons') testPersons: string,
      @WorkspaceId() workspace_id: number,
      @Query('autoCoderRun') autoCoderRun: string
  ): Promise<CodingStatistics> {
    const autoCoderRunNumber = parseInt(autoCoderRun, 10) || 1;
    return this.workspaceCodingService.codeTestPersons(
      workspace_id,
      testPersons,
      autoCoderRunNumber
    );
  }

  @Get(':workspace_id/coding/manual')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async getManualTestPersons(
    @Query('testPersons') testPersons: string,
      @WorkspaceId() /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
                          workspace_id: number
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.workspaceCodingService.getManualTestPersons(
      workspace_id,
      testPersons
    );
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
  async getCodingListAsCsv(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Res() res: Response
  ): Promise<void> {
    const csvStream = await this.codingListService.getCodingListCsvStream(
      workspace_id,
      authToken || '',
      serverUrl || ''
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );
    res.setHeader('Cache-Control', 'no-cache');

    // Excel compatibility: UTF-8 BOM
    res.write('\uFEFF');
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
  async getCodingListAsExcel(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Res() res: Response
  ): Promise<void> {
    const excelData = await this.codingListService.getCodingListAsExcel(
      workspace_id,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`
    );
    res.send(excelData);
  }

  @Get(':workspace_id/coding/coding-list/json')
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
    description: 'Coding list exported as JSON',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unit_key: { type: 'string' },
              unit_alias: { type: 'string' },
              person_login: { type: 'string' },
              person_code: { type: 'string' },
              person_group: { type: 'string' },
              booklet_name: { type: 'string' },
              variable_id: { type: 'string' },
              variable_page: { type: 'string' },
              variable_anchor: { type: 'string' },
              url: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async getCodingListAsJson(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Res() res: Response
  ): Promise<void> {
    this.logger.log(`Starting JSON export for workspace ${workspace_id}`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      res.write('[');
      const stream = await this.codingListService.getCodingListJsonStream(
        workspace_id,
        authToken || '',
        serverUrl || ''
      );
      let first = true;
      stream.on('data', (item: CodingItem) => {
        if (!first) {
          res.write(',');
        } else {
          first = false;
        }
        res.write(JSON.stringify(item));

        // Force garbage collection hint
        if (global.gc) {
          global.gc();
        }
      });

      stream.on('end', () => {
        res.write(']');
        res.end();
        this.logger.log(`JSON export completed for workspace ${workspace_id}`);
      });

      stream.on('error', (error: Error) => {
        this.logger.error(`Error during JSON export: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Export failed' });
        } else {
          res.end();
        }
      });
    } catch (error) {
      this.logger.error(`Failed to start JSON export: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export initialization failed' });
      }
    }
  }

  @Get(':workspace_id/coding/results-by-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: true,
    description: 'Coding version to export: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3']
  })
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
    name: 'includeReplayUrls',
    required: false,
    description: 'Include replay URLs in the export',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'Coding results for specified version exported as CSV',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingResultsByVersion(
    @WorkspaceId() workspace_id: number,
      @Query('version') version: 'v1' | 'v2' | 'v3',
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('includeReplayUrls', { transform: value => value === 'true' })
                   includeReplayUrls: boolean,
                   @Res() res: Response
  ): Promise<void> {
    const includeReplay = includeReplayUrls ?? false;
    const csvStream =
      await this.codingListService.getCodingResultsByVersionCsvStream(
        workspace_id,
        version,
        authToken || '',
        serverUrl || '',
        includeReplay
      );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-results-${version}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );
    res.setHeader('Cache-Control', 'no-cache');

    // Excel compatibility: UTF-8 BOM
    res.write('\uFEFF');
    csvStream.pipe(res);
  }

  @Get(':workspace_id/coding/results-by-version/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: true,
    description: 'Coding version to export: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3']
  })
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
    name: 'includeReplayUrls',
    required: false,
    description: 'Include replay URLs in the export',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'Coding results for specified version exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingResultsByVersionAsExcel(
    @WorkspaceId() workspace_id: number,
      @Query('version') version: 'v1' | 'v2' | 'v3',
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('includeReplayUrls', { transform: value => value === 'true' })
                   includeReplayUrls: boolean,
                   @Res() res: Response
  ): Promise<void> {
    const includeReplay = includeReplayUrls ?? false;
    const excelData =
      await this.codingListService.getCodingResultsByVersionAsExcel(
        workspace_id,
        version,
        authToken || '',
        serverUrl || '',
        includeReplay
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-results-${version}-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`
    );
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
  async getCodingStatistics(
    @WorkspaceId() workspace_id: number,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<CodingStatistics> {
    return this.workspaceCodingService.getCodingStatistics(
      workspace_id,
      version
    );
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
  async createCodingStatisticsJob(
    @WorkspaceId() workspace_id: number
  ): Promise<{ jobId: string; message: string }> {
    return this.workspaceCodingService.createCodingStatisticsJob(workspace_id);
  }

  @Get(':workspace_id/coding/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job'
  })
  @ApiOkResponse({
    description: 'Job status retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            'pending',
            'processing',
            'completed',
            'failed',
            'cancelled',
            'paused'
          ],
          description: 'Current status of the job'
        },
        progress: {
          type: 'number',
          description: 'Progress percentage (0-100)'
        },
        result: {
          type: 'object',
          description:
            'Result of the job (only available when status is completed)',
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
  async getJobStatus(@Param('jobId') jobId: string): Promise<
  | {
    status: string;
    progress: number;
    result?: CodingStatistics;
    error?: string;
  }
  | { error: string }
  > {
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
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to cancel'
  })
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
          description:
            'Message describing the result of the cancellation request'
        }
      }
    }
  })
  async cancelJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.cancelJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/delete')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to delete'
  })
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
  async deleteJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
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
            enum: [
              'pending',
              'processing',
              'completed',
              'failed',
              'cancelled',
              'paused'
            ],
            description: 'Current status of the job'
          },
          progress: {
            type: 'number',
            description: 'Progress percentage (0-100)'
          },
          result: {
            type: 'object',
            description:
              'Result of the job (only available when status is completed)',
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
  async getAllJobs(@WorkspaceId() workspace_id: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
    autoCoderRun?: number;
  }[]
  > {
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
            enum: [
              'pending',
              'processing',
              'completed',
              'failed',
              'cancelled',
              'paused'
            ],
            description: 'Current status of the job'
          },
          progress: {
            type: 'number',
            description: 'Progress percentage (0-100)'
          },
          result: {
            type: 'object',
            description:
              'Result of the job (only available when status is completed)',
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
  async getBullJobs(@WorkspaceId() workspace_id: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]
  > {
    return this.workspaceCodingService.getBullJobs(workspace_id);
  }

  @Get(':workspace_id/coding/groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'List of all test person groups in the workspace retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'string',
        description: 'Group name'
      }
    }
  })
  async getWorkspaceGroups(
    @WorkspaceId() workspace_id: number
  ): Promise<string[]> {
    return this.personService.getWorkspaceGroups(workspace_id);
  }

  @Get(':workspace_id/coding/groups/stats')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'List of all test person groups in the workspace with coding statistics.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Group name' },
          testPersonCount: {
            type: 'number',
            description: 'Number of test persons in this group'
          },
          responsesToCode: {
            type: 'number',
            description:
              'Number of responses that still need to be coded for this group'
          }
        }
      }
    }
  })
  async getWorkspaceGroupCodingStats(
    @WorkspaceId() workspace_id: number
  ): Promise<
      { groupName: string; testPersonCount: number; responsesToCode: number }[]
      > {
    return this.personService.getWorkspaceGroupCodingStats(workspace_id);
  }

  @Get(':workspace_id/coding/job/:jobId/pause')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to pause'
  })
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
  async pauseJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.pauseJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/resume')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to resume'
  })
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
  async resumeJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.workspaceCodingService.resumeJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/restart')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the failed background job to restart'
  })
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
  async restartJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
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
  async getMissingsProfiles(
    @WorkspaceId() workspace_id: number
  ): Promise<{ label: string }[]> {
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
      @Body()
                   body: {
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

    const contentType =
      contentOptions.exportFormat === 'docx' ?
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
        'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=codebook.${contentOptions.exportFormat.toLowerCase()}`
    );
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
              replayUrl: {
                type: 'string',
                description: 'Link to the replay of unit with its responses'
              },
              unitId: { type: 'string', description: 'Unit ID' },
              variableId: { type: 'string', description: 'Variable ID' },
              derivation: { type: 'string', description: 'Derivation' },
              code: { type: 'string', description: 'Code' },
              description: { type: 'string', description: 'Description' },
              score: { type: 'number', description: 'Score' },
              occurrenceCount: {
                type: 'number',
                description:
                  'How often this unitId in combination with variableId with that code is in responses'
              },
              totalCount: {
                type: 'number',
                description:
                  'Total amount of that combination variableId and unit Id'
              },
              relativeOccurrence: {
                type: 'number',
                description: 'Relative occurrence (for bar chart)'
              }
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
    const excelData =
      await this.workspaceCodingService.exportValidationResultsAsExcel(
        workspace_id,
        request.cacheKey
      );

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `validation-results-${timestamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
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
          variableId: { type: 'string', description: 'Variable ID' },
          responseCount: {
            type: 'number',
            description: 'Number of responses for this variable'
          },
          casesInJobs: {
            type: 'number',
            description:
              'Number of unique cases already assigned to coding jobs'
          },
          availableCases: {
            type: 'number',
            description: 'Number of cases available for new job assignments'
          }
        }
      }
    }
  })
  async getCodingIncompleteVariables(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string
  ): Promise<
      {
        unitName: string;
        variableId: string;
        responseCount: number;
        casesInJobs: number;
        availableCases: number;
      }[]
      > {
    return this.workspaceCodingService.getCodingIncompleteVariables(
      workspace_id,
      unitName
    );
  }

  @Post(':workspace_id/coding/applied-results-count')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'List of CODING_INCOMPLETE variables to check for applied results',
    schema: {
      type: 'object',
      properties: {
        incompleteVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Unit name' },
              variableId: { type: 'string', description: 'Variable ID' }
            }
          },
          description: 'List of variables that are CODING_INCOMPLETE'
        }
      },
      required: ['incompleteVariables']
    }
  })
  @ApiOkResponse({
    description: 'Count of applied results for CODING_INCOMPLETE variables.',
    schema: {
      type: 'number',
      description:
        'Number of responses that were CODING_INCOMPLETE but have been changed to final statuses in status_v2'
    }
  })
  async getAppliedResultsCount(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: { incompleteVariables: { unitName: string; variableId: string }[] }
  ): Promise<number> {
    return this.workspaceCodingService.getAppliedResultsCount(
      workspace_id,
      body.incompleteVariables
    );
  }

  @Get(':workspace_id/coding/progress-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding progress overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalCasesToCode: {
          type: 'number',
          description: 'Total number of cases that need to be coded'
        },
        completedCases: {
          type: 'number',
          description:
            'Number of cases that have been completed through coding jobs'
        },
        completionPercentage: {
          type: 'number',
          description: 'Percentage of coding completion'
        }
      }
    }
  })
  async getCodingProgressOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalCasesToCode: number;
        completedCases: number;
        completionPercentage: number;
      }> {
    return this.workspaceCodingService.getCodingProgressOverview(workspace_id);
  }

  @Get(':workspace_id/coding/case-coverage-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Case coverage overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalCasesToCode: {
          type: 'number',
          description: 'Total number of cases that need to be coded'
        },
        casesInJobs: {
          type: 'number',
          description: 'Number of cases assigned to coding jobs'
        },
        doubleCodedCases: {
          type: 'number',
          description: 'Number of cases that are double-coded'
        },
        singleCodedCases: {
          type: 'number',
          description: 'Number of cases that are single-coded'
        },
        unassignedCases: {
          type: 'number',
          description: 'Number of cases not assigned to any coding job'
        },
        coveragePercentage: {
          type: 'number',
          description: 'Percentage of cases covered by coding jobs'
        }
      }
    }
  })
  async getCaseCoverageOverview(@WorkspaceId() workspace_id: number): Promise<{
    totalCasesToCode: number;
    casesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    coveragePercentage: number;
  }> {
    return this.workspaceCodingService.getCaseCoverageOverview(workspace_id);
  }

  @Get(':workspace_id/coding/variable-coverage-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Variable coverage overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalVariables: {
          type: 'number',
          description: 'Total number of potential variables from unit XML files'
        },
        coveredVariables: {
          type: 'number',
          description: 'Total number of variables covered by job definitions'
        },
        coveredByDraft: {
          type: 'number',
          description: 'Number of variables covered by draft job definitions'
        },
        coveredByPendingReview: {
          type: 'number',
          description:
            'Number of variables covered by pending review job definitions'
        },
        coveredByApproved: {
          type: 'number',
          description: 'Number of variables covered by approved job definitions'
        },
        conflictedVariables: {
          type: 'number',
          description:
            'Number of variables assigned to multiple job definitions'
        },
        missingVariables: {
          type: 'number',
          description: 'Number of variables not covered by job definitions'
        },
        partiallyAbgedeckteVariablen: {
          type: 'number',
          description: 'Number of variables with partial case coverage'
        },
        fullyAbgedeckteVariablen: {
          type: 'number',
          description: 'Number of variables with full case coverage'
        },
        coveragePercentage: {
          type: 'number',
          description: 'Percentage of variables covered by job definitions'
        },
        variableCaseCounts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Unit name' },
              variableId: { type: 'string', description: 'Variable ID' },
              caseCount: {
                type: 'number',
                description: 'Number of coding cases for this variable'
              }
            }
          },
          description: 'List of all variables with their case counts'
        },
        coverageByStatus: {
          type: 'object',
          properties: {
            draft: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by draft definitions'
            },
            pending_review: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by pending review definitions'
            },
            approved: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by approved definitions'
            },
            conflicted: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  variableKey: {
                    type: 'string',
                    description: 'Variable key in format unitName:variableId'
                  },
                  conflictingDefinitions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: {
                          type: 'number',
                          description: 'Job definition ID'
                        },
                        status: {
                          type: 'string',
                          description: 'Job definition status'
                        }
                      }
                    }
                  }
                }
              },
              description:
                'Variables assigned to multiple definitions with conflict details'
            }
          },
          description: 'Coverage breakdown by job definition status'
        }
      }
    }
  })
  async getVariableCoverageOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalVariables: number;
        coveredVariables: number;
        coveredByDraft: number;
        coveredByPendingReview: number;
        coveredByApproved: number;
        conflictedVariables: number;
        missingVariables: number;
        partiallyAbgedeckteVariablen: number;
        fullyAbgedeckteVariablen: number;
        coveragePercentage: number;
        variableCaseCounts: {
          unitName: string;
          variableId: string;
          caseCount: number;
        }[];
        coverageByStatus: {
          draft: string[];
          pending_review: string[];
          approved: string[];
          conflicted: Array<{
            variableKey: string;
            conflictingDefinitions: Array<{
              id: number;
              status: string;
            }>;
          }>;
        };
      }> {
    return this.workspaceCodingService.getVariableCoverageOverview(
      workspace_id
    );
  }

  @Get(':workspace_id/coding/response-analysis')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'Response analysis retrieved successfully. Identifies empty responses and duplicate values based on response matching settings.',
    schema: {
      type: 'object',
      properties: {
        emptyResponses: {
          type: 'object',
          properties: {
            total: {
              type: 'number',
              description: 'Total number of empty responses'
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  unitAlias: { type: 'string', nullable: true },
                  variableId: { type: 'string' },
                  personLogin: { type: 'string' },
                  personCode: { type: 'string' },
                  bookletName: { type: 'string' },
                  responseId: { type: 'number' }
                }
              }
            }
          }
        },
        duplicateValues: {
          type: 'object',
          properties: {
            total: {
              type: 'number',
              description: 'Total number of duplicate value groups'
            },
            totalResponses: {
              type: 'number',
              description: 'Total number of responses in duplicate groups'
            },
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  unitAlias: { type: 'string', nullable: true },
                  variableId: { type: 'string' },
                  normalizedValue: { type: 'string' },
                  originalValue: { type: 'string' },
                  occurrences: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        personLogin: { type: 'string' },
                        personCode: { type: 'string' },
                        bookletName: { type: 'string' },
                        responseId: { type: 'number' },
                        value: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Response matching flags used for normalization'
        },
        analysisTimestamp: {
          type: 'string',
          description: 'ISO timestamp of when the analysis was performed'
        }
      }
    }
  })
  async getResponseAnalysis(@WorkspaceId() workspace_id: number) {
    return this.workspaceCodingService.getResponseAnalysis(workspace_id);
  }

  @Post(':workspace_id/coding/external-coding-import/stream')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'External coding file upload (CSV/Excel) with streaming progress',
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
      const result =
        await this.workspaceCodingService.importExternalCodingWithProgress(
          workspace_id,
          body,
          (progress: number, message: string) => {
            res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
          }
        );

      // Send final result
      res.write(
        `data: ${JSON.stringify({
          progress: 100,
          message: 'Import completed',
          result
        })}\n\n`
      );
      res.end();
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          progress: 0,
          message: `Import failed: ${error.message}`,
          error: true
        })}\n\n`
      );
      res.end();
    }
  }

  @Post(':workspace_id/coding/external-coding-import')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
    description:
      'Generate coder training packages based on CODING_INCOMPLETE responses for specific variable and unit combinations',
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
      @Body()
                   body: {
                     selectedCoders: { id: number; name: string }[];
                     variableConfigs: {
                       variableId: string;
                       unitId: string;
                       sampleCount: number;
                     }[];
                   }
  ): Promise<
      {
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
      }[]
      > {
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
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Creation date'
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Last update date'
          },
          jobsCount: {
            type: 'number',
            description: 'Number of coding jobs in this training'
          }
        }
      }
    }
  })
  async getCoderTrainings(@WorkspaceId() workspace_id: number): Promise<
  {
    id: number;
    workspace_id: number;
    label: string;
    created_at: Date;
    updated_at: Date;
    jobsCount: number;
  }[]
  > {
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
        trainingLabel: {
          type: 'string',
          description: 'Label for the coder training session'
        },
        missingsProfileId: {
          type: 'number',
          description:
            'ID of the missings profile to assign to all created coding jobs'
        },
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
      @Body()
                   body: {
                     trainingLabel: string;
                     missingsProfileId?: number;
                     selectedCoders: { id: number; name: string }[];
                     variableConfigs: {
                       variableId: string;
                       unitId: string;
                       sampleCount: number;
                     }[];
                   }
  ): Promise<{
        success: boolean;
        jobsCreated: number;
        message: string;
        jobs: {
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
        }[];
        trainingId?: number;
      }> {
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
                trainingLabel: {
                  type: 'string',
                  description: 'Training label'
                },
                code: {
                  type: 'string',
                  description: 'Code given by coders in this training'
                },
                score: {
                  type: 'number',
                  description: 'Score given by coders in this training'
                }
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
  ): Promise<
      Array<{
        unitName: string;
        variableId: string;
        trainings: Array<{
          trainingId: number;
          trainingLabel: string;
          code: string | null;
          score: number | null;
        }>;
      }>
      > {
    const trainingIds = trainingIdsQuery
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !Number.isNaN(id));

    if (trainingIds.length === 0) {
      throw new Error('At least one valid training ID must be provided');
    }

    return this.coderTrainingService.getTrainingCodingComparison(
      workspace_id,
      trainingIds
    );
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
    description:
      'Comparison of coding results within a single training by individual coders',
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
                code: {
                  type: 'string',
                  description: 'Code given by this coder'
                },
                score: {
                  type: 'number',
                  description: 'Score given by this coder'
                }
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
  ): Promise<
      Array<{
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
      }>
      > {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    // Get coding results for all jobs within the training
    return this.coderTrainingService.getWithinTrainingCodingComparison(
      workspace_id,
      trainingId
    );
  }

  @Put(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to update'
  })
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
        success: {
          type: 'boolean',
          description: 'Whether the update was successful'
        },
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

    return this.coderTrainingService.updateCoderTrainingLabel(
      workspace_id,
      trainingId,
      body.label.trim()
    );
  }

  @Get(':workspace_id/coding/coder-trainings/:trainingId/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
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
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Creation date'
          },
          coder: {
            type: 'object',
            properties: {
              userId: { type: 'number', description: 'Coder user ID' },
              username: { type: 'string', description: 'Coder username' }
            }
          },
          unitsCount: {
            type: 'number',
            description: 'Number of coding units in the job'
          }
        }
      }
    }
  })
  async getCodingJobsForTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<
      Array<{
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
      }>
      > {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.getCodingJobsForTraining(
      workspace_id,
      trainingId
    );
  }

  @Get(':workspace_id/coding/cohens-kappa')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiOkResponse({
    description:
      "Cohen's Kappa statistics for double-coded variables with workspace summary.",
    schema: {
      type: 'object',
      properties: {
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              coderPairs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coder1Id: { type: 'number', description: 'First coder ID' },
                    coder1Name: {
                      type: 'string',
                      description: 'First coder name'
                    },
                    coder2Id: {
                      type: 'number',
                      description: 'Second coder ID'
                    },
                    coder2Name: {
                      type: 'string',
                      description: 'Second coder name'
                    },
                    kappa: {
                      type: 'number',
                      nullable: true,
                      description: "Cohen's Kappa coefficient"
                    },
                    agreement: {
                      type: 'number',
                      description: 'Observed agreement percentage'
                    },
                    totalItems: {
                      type: 'number',
                      description: 'Total items coded by both coders'
                    },
                    validPairs: {
                      type: 'number',
                      description: 'Number of valid coding pairs'
                    },
                    interpretation: {
                      type: 'string',
                      description: 'Interpretation of the Kappa value'
                    }
                  }
                },
                description: "Cohen's Kappa statistics for each coder pair"
              }
            }
          },
          description: "Per-variable Cohen's Kappa statistics"
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalDoubleCodedResponses: {
              type: 'number',
              description: 'Total number of double-coded responses'
            },
            totalCoderPairs: {
              type: 'number',
              description: 'Total number of coder pairs analyzed'
            },
            averageKappa: {
              type: 'number',
              nullable: true,
              description: "Average Cohen's Kappa across all coder pairs"
            },
            variablesIncluded: {
              type: 'number',
              description: 'Number of variables included in the analysis'
            },
            codersIncluded: {
              type: 'number',
              description: 'Number of coders included in the analysis'
            }
          },
          description: 'Workspace-wide summary statistics'
        }
      }
    }
  })
  async getCohensKappaStatistics(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string,
      @Query('variableId') variableId?: string
  ): Promise<{
        variables: Array<{
          unitName: string;
          variableId: string;
          coderPairs: Array<{
            coder1Id: number;
            coder1Name: string;
            coder2Id: number;
            coder2Name: string;
            kappa: number | null;
            agreement: number;
            totalItems: number;
            validPairs: number;
            interpretation: string;
          }>;
        }>;
        workspaceSummary: {
          totalDoubleCodedResponses: number;
          totalCoderPairs: number;
          averageKappa: number | null;
          variablesIncluded: number;
          codersIncluded: number;
        };
      }> {
    try {
      this.logger.log(
        `Calculating Cohen's Kappa for workspace ${workspace_id}${
          unitName ? `, unit: ${unitName}` : ''
        }${variableId ? `, variable: ${variableId}` : ''}`
      );

      // Get all double-coded data
      const doubleCodedData =
        await this.workspaceCodingService.getDoubleCodedVariablesForReview(
          workspace_id,
          1,
          10000
        ); // Get all data

      // Group by unit and variable
      const groupedData = new Map<
      string,
      Array<{
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }>
      >();

      doubleCodedData.data.forEach(item => {
        // Apply filters if provided
        if (unitName && item.unitName !== unitName) return;
        if (variableId && item.variableId !== variableId) return;

        const key = `${item.unitName}:${item.variableId}`;
        if (!groupedData.has(key)) {
          groupedData.set(key, []);
        }
        groupedData.get(key)!.push(item);
      });

      const variables = [];
      const allKappaResults: Array<{ kappa: number | null }> = [];
      const uniqueVariables = new Set<string>();
      const uniqueCoders = new Set<number>();

      for (const [key, items] of groupedData.entries()) {
        const [unitNameKey, variableIdKey] = key.split(':');

        uniqueVariables.add(key);

        // Get all unique coders for this unit/variable combination
        const allCoders = new Set<number>();
        items.forEach(item => {
          item.coderResults.forEach(cr => {
            allCoders.add(cr.coderId);
            uniqueCoders.add(cr.coderId);
          });
        });

        const coderArray = Array.from(allCoders);
        const coderPairs = [];

        // Calculate Kappa for each pair of coders
        for (let i = 0; i < coderArray.length; i++) {
          for (let j = i + 1; j < coderArray.length; j++) {
            const coder1Id = coderArray[i];
            const coder2Id = coderArray[j];

            // Find coder names
            let coder1Name = '';
            let coder2Name = '';
            items.forEach(item => {
              item.coderResults.forEach(cr => {
                if (cr.coderId === coder1Id) coder1Name = cr.coderName;
                if (cr.coderId === coder2Id) coder2Name = cr.coderName;
              });
            });

            // Collect coding pairs for these two coders
            const codes = [];
            items.forEach(item => {
              const coder1Result = item.coderResults.find(
                cr => cr.coderId === coder1Id
              );
              const coder2Result = item.coderResults.find(
                cr => cr.coderId === coder2Id
              );

              if (coder1Result && coder2Result) {
                codes.push({
                  code1: coder1Result.code,
                  code2: coder2Result.code
                });
              }
            });

            if (codes.length > 0) {
              coderPairs.push({
                coder1Id,
                coder1Name,
                coder2Id,
                coder2Name,
                codes
              });
            }
          }
        }

        if (coderPairs.length > 0) {
          // Calculate Cohen's Kappa for all pairs
          const kappaResults =
            this.codingStatisticsService.calculateCohensKappa(coderPairs);

          // Collect all kappa results for later averaging
          allKappaResults.push(...kappaResults);

          variables.push({
            unitName: unitNameKey,
            variableId: variableIdKey,
            coderPairs: kappaResults
          });
        }
      }

      // Calculate workspace summary by averaging all collected kappa values
      let totalKappa = 0;
      let validKappaCount = 0;
      allKappaResults.forEach(result => {
        if (result.kappa !== null && !Number.isNaN(result.kappa)) {
          totalKappa += result.kappa;
          validKappaCount += 1;
        }
      });

      // Calculate workspace summary - return 0 instead of null when no valid kappa values
      const averageKappa =
        validKappaCount > 0 ?
          Math.round((totalKappa / validKappaCount) * 1000) / 1000 :
          0;

      const workspaceSummary = {
        totalDoubleCodedResponses: doubleCodedData.total,
        totalCoderPairs: validKappaCount,
        averageKappa,
        variablesIncluded: uniqueVariables.size,
        codersIncluded: uniqueCoders.size
      };

      this.logger.log(
        `Calculated Cohen's Kappa for ${variables.length} unit/variable combinations in workspace ${workspace_id}, average kappa: ${averageKappa}`
      );

      return {
        variables,
        workspaceSummary
      };
    } catch (error) {
      this.logger.error(
        `Error calculating Cohen's Kappa: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not calculate Cohen's Kappa statistics. Please check the database connection."
      );
    }
  }

  @Delete(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to delete'
  })
  @ApiOkResponse({
    description: 'Coder training deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the deletion was successful'
        },
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

    return this.coderTrainingService.deleteCoderTraining(
      workspace_id,
      trainingId
    );
  }

  @Get(':workspace_id/coding/responses/:status')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'status',
    type: String,
    description: 'Response status to filter by'
  })
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

  @Get(':workspace_id/coding/responses/:responseId/replay-url')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'responseId',
    type: Number,
    description: 'ID of the response'
  })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for the replay URL',
    type: String
  })
  @ApiOkResponse({
    description: 'Replay URL generated successfully.',
    schema: {
      type: 'object',
      properties: {
        replayUrl: { type: 'string', description: 'The generated replay URL' }
      }
    }
  })
  async getReplayUrl(
    @WorkspaceId() workspace_id: number,
      @Param('responseId') responseId: number,
      @Query('authToken') authToken: string,
      @Req() req: Request
  ): Promise<{ replayUrl: string }> {
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    return this.workspaceCodingService.generateReplayUrlForResponse(
      workspace_id,
      responseId,
      serverUrl,
      authToken
    );
  }

  @Post(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
    return this.jobDefinitionService.createJobDefinition(
      createDto,
      workspace_id
    );
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
  async getJobDefinitions(
    @WorkspaceId() workspace_id: number
  ): Promise<JobDefinition[]> {
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
  async getApprovedJobDefinitions(
    @WorkspaceId() workspaceId: number
  ): Promise<JobDefinition[]> {
    return this.jobDefinitionService.getApprovedJobDefinitions(workspaceId);
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
    return this.jobDefinitionService.createCodingJobFromDefinition(
      id,
      workspace_id
    );
  }

  @Post(':workspace_id/coding/jobs/:jobId/apply-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: Number,
    description: 'Coding job ID to apply results for'
  })
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
        messageKey: {
          type: 'string',
          description: 'Translation key for the message'
        },
        messageParams: {
          type: 'object',
          description: 'Parameters for the translation'
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
        messageKey: string;
        messageParams?: Record<string, unknown>;
      }> {
    return this.workspaceCodingService.applyCodingResults(workspace_id, jobId);
  }

  @Post(':workspace_id/coding/jobs/bulk-apply-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Bulk apply coding results for all jobs without issues.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the bulk operation was successful'
        },
        jobsProcessed: {
          type: 'number',
          description: 'Number of jobs processed'
        },
        totalUpdatedResponses: {
          type: 'number',
          description: 'Total number of responses updated across all jobs'
        },
        totalSkippedReview: {
          type: 'number',
          description: 'Total number of responses skipped for manual review'
        },
        message: {
          type: 'string',
          description: 'Summary message of the bulk operation'
        },
        results: {
          type: 'array',
          description: 'Detailed results for each job',
          items: {
            type: 'object',
            properties: {
              jobId: { type: 'number', description: 'Job ID' },
              jobName: { type: 'string', description: 'Job name' },
              hasIssues: {
                type: 'boolean',
                description: 'Whether the job has coding issues'
              },
              skipped: {
                type: 'boolean',
                description: 'Whether the job was skipped'
              },
              result: {
                type: 'object',
                description: 'Apply result (only present if not skipped)',
                properties: {
                  success: { type: 'boolean' },
                  updatedResponsesCount: { type: 'number' },
                  skippedReviewCount: { type: 'number' },
                  message: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  })
  async bulkApplyCodingResults(@WorkspaceId() workspace_id: number): Promise<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    message: string;
    results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }>;
  }> {
    return this.workspaceCodingService.bulkApplyCodingResults(workspace_id);
  }

  @Post(':workspace_id/coding/calculate-distribution')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Calculate distribution for coding jobs (preview mode)',
    schema: {
      type: 'object',
      properties: {
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' }
            }
          }
        },
        doubleCodingAbsolute: { type: 'number' },
        doubleCodingPercentage: { type: 'number' }
      },
      required: ['selectedVariables', 'selectedCoders']
    }
  })
  @ApiOkResponse({
    description: 'Distribution calculated successfully.',
    schema: {
      type: 'object',
      properties: {
        distribution: {
          type: 'object',
          description: 'Case distribution matrix',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          description: 'Double coding information',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        }
      }
    }
  })
  async calculateDistribution(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedVariables: { unitName: string; variableId: string }[];
                     selectedVariableBundles?: {
                       id: number;
                       name: string;
                       variables: { unitName: string; variableId: string }[];
                     }[];
                     selectedCoders: { id: number; name: string; username: string }[];
                     doubleCodingAbsolute?: number;
                     doubleCodingPercentage?: number;
                     caseOrderingMode?: 'continuous' | 'alternating';
                     maxCodingCases?: number;
                   }
  ): Promise<{
        distribution: Record<string, Record<string, number>>;
        doubleCodingInfo: Record<
        string,
        {
          totalCases: number;
          doubleCodedCases: number;
          singleCodedCasesAssigned: number;
          doubleCodedCasesPerCoder: Record<string, number>;
        }
        >;
      }> {
    return this.codingJobService.calculateDistribution(workspace_id, body);
  }

  @Post(':workspace_id/coding/create-distributed-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create distributed coding jobs with equal case distribution',
    schema: {
      type: 'object',
      properties: {
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' }
            }
          }
        },
        doubleCodingAbsolute: { type: 'number' },
        doubleCodingPercentage: { type: 'number' }
      },
      required: ['selectedVariables', 'selectedCoders']
    }
  })
  @ApiOkResponse({
    description: 'Distributed coding jobs created successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobsCreated: { type: 'number' },
        message: { type: 'string' },
        distribution: {
          type: 'object',
          description: 'Case distribution matrix',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          description: 'Double coding information',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coderId: { type: 'number' },
              coderName: { type: 'string' },
              variable: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  variableId: { type: 'string' }
                }
              },
              jobId: { type: 'number' },
              jobName: { type: 'string' },
              caseCount: { type: 'number' }
            }
          }
        }
      }
    }
  })
  async createDistributedCodingJobs(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedVariables: { unitName: string; variableId: string }[];
                     selectedVariableBundles?: {
                       id: number;
                       name: string;
                       variables: { unitName: string; variableId: string }[];
                     }[];
                     selectedCoders: { id: number; name: string; username: string }[];
                     doubleCodingAbsolute?: number;
                     doubleCodingPercentage?: number;
                     caseOrderingMode?: 'continuous' | 'alternating';
                     maxCodingCases?: number;
                   }
  ): Promise<{
        success: boolean;
        jobsCreated: number;
        message: string;
        distribution: Record<string, Record<string, number>>;
        doubleCodingInfo: Record<
        string,
        {
          totalCases: number;
          doubleCodedCases: number;
          singleCodedCasesAssigned: number;
          doubleCodedCasesPerCoder: Record<string, number>;
        }
        >;
        jobs: {
          coderId: number;
          coderName: string;
          variable: { unitName: string; variableId: string };
          jobId: number;
          jobName: string;
          caseCount: number;
        }[];
      }> {
    return this.workspaceCodingService.createDistributedCodingJobs(
      workspace_id,
      body
    );
  }

  @Post(':workspace_id/coding/export/start')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Export job configuration',
    schema: {
      type: 'object',
      required: ['exportType', 'userId'],
      properties: {
        exportType: {
          type: 'string',
          enum: [
            'aggregated',
            'by-coder',
            'by-variable',
            'detailed',
            'coding-times'
          ],
          description: 'Type of export to generate'
        },
        userId: {
          type: 'number',
          description: 'ID of the user requesting the export'
        },
        outputCommentsInsteadOfCodes: { type: 'boolean' },
        includeReplayUrl: { type: 'boolean' },
        anonymizeCoders: { type: 'boolean' },
        usePseudoCoders: { type: 'boolean' },
        doubleCodingMethod: {
          type: 'string',
          enum: [
            'new-row-per-variable',
            'new-column-per-coder',
            'most-frequent'
          ]
        },
        includeComments: { type: 'boolean' },
        includeModalValue: { type: 'boolean' },
        includeDoubleCoded: { type: 'boolean' },
        excludeAutoCoded: { type: 'boolean' },
        authToken: { type: 'string' }
      }
    }
  })
  @ApiOkResponse({
    description: 'Export job created successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'ID of the created export job' },
        message: { type: 'string' }
      }
    }
  })
  async startExportJob(
    @WorkspaceId() workspace_id: number,
      @Body() body: Omit<ExportJobData, 'workspaceId'>
  ): Promise<{ jobId: string; message: string }> {
    try {
      const job = await this.jobQueueService.addExportJob({
        ...body,
        workspaceId: workspace_id
      });

      this.logger.log(
        `Export job ${job.id} created for workspace ${workspace_id}, type: ${body.exportType}`
      );

      return {
        jobId: job.id.toString(),
        message: `Export job created successfully. Job ID: ${job.id}`
      };
    } catch (error) {
      this.logger.error(
        `Error creating export job: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  @Get(':workspace_id/coding/export/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the export job'
  })
  @ApiOkResponse({
    description: 'Export job status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
          description: 'Current status of the export job'
        },
        progress: {
          type: 'number',
          description: 'Progress percentage (0-100)'
        },
        result: {
          type: 'object',
          description:
            'Export metadata (only available when status is completed)'
        },
        error: {
          type: 'string',
          description: 'Error message (only available when status is failed)'
        }
      }
    }
  })
  async getExportJobStatus(@Param('jobId') jobId: string): Promise<
  | {
    status: string;
    progress: number;
    result?: {
      fileId: string;
      fileName: string;
      filePath: string;
      fileSize: number;
      workspaceId: number;
      userId: number;
      exportType: string;
      createdAt: number;
    };
    error?: string;
  }
  | { error: string }
  > {
    try {
      const job = await this.jobQueueService.getExportJob(jobId);
      if (!job) {
        return { error: `Export job with ID ${jobId} not found` };
      }

      const state = await job.getState();
      const progress = await job.progress();
      const failedReason = job.failedReason;

      let status: string;
      switch (state) {
        case 'completed':
          status = 'completed';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'active':
          status = 'processing';
          break;
        case 'waiting':
        case 'delayed':
          status = 'pending';
          break;
        case 'paused':
          status = 'paused';
          break;
        default:
          status = state;
      }

      return {
        status,
        progress: typeof progress === 'number' ? progress : 0,
        ...(status === 'completed' && job.returnvalue ?
          { result: job.returnvalue } :
          {}),
        ...(status === 'failed' && failedReason ? { error: failedReason } : {})
      };
    } catch (error) {
      this.logger.error(
        `Error getting export job status: ${error.message}`,
        error.stack
      );
      return { error: error.message };
    }
  }

  @Get(':workspace_id/coding/export/job/:jobId/download')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the export job'
  })
  @ApiOkResponse({
    description: 'Export file downloaded successfully',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async downloadExport(
    @Param('jobId') jobId: string,
      @WorkspaceId() workspace_id: number,
      @Res() res: Response
  ): Promise<void> {
    try {
      const metadata = await this.cacheService.get<ExportJobResult>(
        `export-result:${jobId}`
      );

      if (!metadata) {
        res.status(404).json({ error: 'Export file not found or expired' });
        return;
      }

      if (metadata.workspaceId !== workspace_id) {
        res.status(403).json({ error: 'Access denied to this export' });
        return;
      }

      const filePath = metadata.filePath;
      const fs = await import('fs');

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Export file not found on disk' });
        return;
      }

      const isCsv =
        metadata.fileName.toLowerCase().endsWith('.csv') ||
        metadata.exportType === 'detailed';
      res.setHeader(
        'Content-Type',
        isCsv ?
          'text/csv; charset=utf-8' :
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${metadata.fileName}"`
      );
      res.setHeader('Content-Length', metadata.fileSize);

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      this.logger.error(
        `Error downloading export: ${error.message}`,
        error.stack
      );
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of export jobs for the workspace',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          status: { type: 'string' },
          progress: { type: 'number' },
          exportType: { type: 'string' },
          createdAt: { type: 'number' }
        }
      }
    }
  })
  async getExportJobs(@WorkspaceId() workspace_id: number): Promise<
  Array<{
    jobId: string;
    status: string;
    progress: number;
    exportType: string;
    createdAt: number;
  }>
  > {
    try {
      const jobs = await this.jobQueueService.getExportJobs(workspace_id);

      return await Promise.all(
        jobs.map(async job => {
          const state = await job.getState();
          const progress = await job.progress();

          return {
            jobId: job.id.toString(),
            status: state,
            progress: typeof progress === 'number' ? progress : 0,
            exportType: job.data.exportType,
            createdAt: job.timestamp
          };
        })
      );
    } catch (error) {
      this.logger.error(
        `Error getting export jobs: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  @Delete(':workspace_id/coding/export/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the export job to delete'
  })
  @ApiOkResponse({
    description: 'Export job deleted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteExportJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const success = await this.jobQueueService.deleteExportJob(jobId);

      if (success) {
        const metadata = await this.cacheService.get<ExportJobResult>(
          `export-result:${jobId}`
        );
        if (metadata && metadata.filePath) {
          const fs = await import('fs');
          if (fs.existsSync(metadata.filePath)) {
            fs.unlinkSync(metadata.filePath);
          }
        }
        await this.cacheService.delete(`export-result:${jobId}`);

        return {
          success: true,
          message: 'Export job deleted successfully'
        };
      }

      return {
        success: false,
        message: 'Export job not found'
      };
    } catch (error) {
      this.logger.error(
        `Error deleting export job: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        message: error.message
      };
    }
  }

  @Post(':workspace_id/coding/export/job/:jobId/cancel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the export job to cancel'
  })
  @ApiOkResponse({
    description: 'Export job cancelled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async cancelExportJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // First, check the job state
      const job = await this.jobQueueService.getExportJob(jobId);
      if (!job) {
        return {
          success: false,
          message: 'Export job not found'
        };
      }

      const state = await job.getState();

      // Check if job is already completed or failed
      if (state === 'completed') {
        return {
          success: false,
          message: 'Job already completed'
        };
      }

      if (state === 'failed') {
        return {
          success: false,
          message: 'Job already failed'
        };
      }

      // Mark the job as cancelled (for active jobs to check)
      await this.jobQueueService.markExportJobCancelled(jobId);

      // Try to remove the job from queue
      const removed = await this.jobQueueService.cancelExportJob(jobId);

      // Clean up any cached metadata and temp files
      const metadata = await this.cacheService.get<ExportJobResult>(
        `export-result:${jobId}`
      );
      if (metadata && metadata.filePath) {
        const fs = await import('fs');
        if (fs.existsSync(metadata.filePath)) {
          fs.unlinkSync(metadata.filePath);
          this.logger.log(`Cleaned up export file: ${metadata.filePath}`);
        }
      }
      await this.cacheService.delete(`export-result:${jobId}`);

      if (removed) {
        this.logger.log(`Export job ${jobId} cancelled and removed from queue`);
        return {
          success: true,
          message: 'Export job cancelled successfully'
        };
      }
      // Job was marked as cancelled but couldn't be removed (may be actively processing)
      this.logger.log(
        `Export job ${jobId} marked as cancelled (job is actively processing)`
      );
      return {
        success: true,
        message:
          'Export job cancellation requested (job will stop at next checkpoint)'
      };
    } catch (error) {
      this.logger.error(
        `Error cancelling export job: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        message: error.message
      };
    }
  }

  @Get(':workspace_id/coding/export/aggregated')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code columns instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description: 'Anonymize coder names in the export'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names (K1, K2) for double-coding'
  })
  @ApiQuery({
    name: 'doubleCodingMethod',
    required: false,
    enum: ['new-row-per-variable', 'new-column-per-coder', 'most-frequent'],
    description:
      'Method for handling double-coding: new-row-per-variable, new-column-per-coder, or most-frequent (default)'
  })
  @ApiQuery({
    name: 'includeComments',
    required: false,
    type: Boolean,
    description: 'Include comments column with all coder comments'
  })
  @ApiQuery({
    name: 'includeModalValue',
    required: false,
    type: Boolean,
    description: 'Include modal value and deviation count columns'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Aggregated coding results exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsAggregated(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('doubleCodingMethod') doubleCodingMethod?: string,
                   @Query('includeComments') includeComments?: string,
                   @Query('includeModalValue') includeModalValue?: string,
                   @Query('authToken') authToken?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const doubleCodingMethodParam =
        (doubleCodingMethod as
          | 'new-row-per-variable'
          | 'new-column-per-coder'
          | 'most-frequent') || 'most-frequent';
      const includeCommentsParam = includeComments === 'true';
      const includeModalValueParam = includeModalValue === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true'; // Default false

      const buffer =
        await this.codingExportService.exportCodingResultsAggregated(
          workspace_id,
          outputCommentsParam,
          includeReplayUrlParam,
          anonymizeCodersParam,
          usePseudoCodersParam,
          doubleCodingMethodParam,
          includeCommentsParam,
          includeModalValueParam,
          authToken || '',
          req,
          excludeAutoCodedParam
        );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-aggregated-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/by-coder')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code columns instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Coding results by coder exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsByCoder(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer = await this.codingExportService.exportCodingResultsByCoder(
        workspace_id,
        outputCommentsParam,
        includeReplayUrlParam,
        anonymizeCodersParam,
        usePseudoCodersParam,
        authToken || '',
        req,
        excludeAutoCodedParam
      );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-by-coder-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/by-variable')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'includeModalValue',
    required: false,
    type: Boolean,
    description: 'Include modal value and deviation count columns'
  })
  @ApiQuery({
    name: 'includeDoubleCoded',
    required: false,
    type: Boolean,
    description: 'Include double coding indicator column (0 or 1)'
  })
  @ApiQuery({
    name: 'includeComments',
    required: false,
    type: Boolean,
    description: 'Include comments column with all coders comments'
  })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code columns instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Coding results by variable exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsByVariable(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('includeModalValue') includeModalValue?: string,
      @Query('includeDoubleCoded') includeDoubleCoded?: string,
      @Query('includeComments') includeComments?: string,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const includeModal = includeModalValue === 'true';
      const includeDouble = includeDoubleCoded === 'true';
      const includeCommentsParam = includeComments === 'true';
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer =
        await this.codingExportService.exportCodingResultsByVariable(
          workspace_id,
          includeModal,
          includeDouble,
          includeCommentsParam,
          outputCommentsParam,
          includeReplayUrlParam,
          anonymizeCodersParam,
          usePseudoCodersParam,
          authToken || '',
          req,
          excludeAutoCodedParam
        );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-by-variable-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/detailed')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code column instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Detailed coding results exported as CSV',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsDetailed(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer = await this.codingExportService.exportCodingResultsDetailed(
        workspace_id,
        outputCommentsParam,
        includeReplayUrlParam,
        anonymizeCodersParam,
        usePseudoCodersParam,
        authToken || '',
        req,
        excludeAutoCodedParam
      );

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-detailed-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/coding-times')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Coding times report exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingTimesReport(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Query('anonymizeCoders') anonymizeCoders?: string,
      @Query('usePseudoCoders') usePseudoCoders?: string,
      @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer = await this.codingExportService.exportCodingTimesReport(
        workspace_id,
        anonymizeCodersParam,
        usePseudoCodersParam,
        excludeAutoCodedParam
      );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-times-report-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/double-coded-review')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 50, max: 100)',
    type: Number
  })
  @ApiOkResponse({
    description: 'Double-coded variables retrieved for review',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'Response ID' },
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              personLogin: { type: 'string', description: 'Person login' },
              personCode: { type: 'string', description: 'Person code' },
              bookletName: { type: 'string', description: 'Booklet name' },
              givenAnswer: {
                type: 'string',
                description: 'The given answer by the test person'
              },
              coderResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coderId: { type: 'number', description: 'Coder user ID' },
                    coderName: { type: 'string', description: 'Coder name' },
                    jobId: { type: 'number', description: 'Coding job ID' },
                    code: {
                      type: 'number',
                      nullable: true,
                      description: 'Code given by the coder'
                    },
                    score: {
                      type: 'number',
                      nullable: true,
                      description: 'Score given by the coder'
                    },
                    notes: {
                      type: 'string',
                      nullable: true,
                      description: 'Notes from the coder'
                    },
                    codedAt: {
                      type: 'string',
                      format: 'date-time',
                      description: 'When the coding was done'
                    }
                  }
                },
                description: 'Results from all coders who coded this variable'
              }
            }
          }
        },
        total: {
          type: 'number',
          description: 'Total number of double-coded variables'
        },
        page: { type: 'number', description: 'Current page number' },
        limit: { type: 'number', description: 'Number of items per page' }
      }
    }
  })
  async getDoubleCodedVariablesForReview(
    @WorkspaceId() workspace_id: number,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 50
  ): Promise<{
        data: Array<{
          responseId: number;
          unitName: string;
          variableId: string;
          personLogin: string;
          personCode: string;
          bookletName: string;
          givenAnswer: string;
          coderResults: Array<{
            coderId: number;
            coderName: string;
            jobId: number;
            code: number | null;
            score: number | null;
            notes: string | null;
            codedAt: Date;
          }>;
        }>;
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100); // Max 100 items per page for review

    return this.workspaceCodingService.getDoubleCodedVariablesForReview(
      workspace_id,
      validPage,
      validLimit
    );
  }

  @Post(':workspace_id/coding/double-coded-review/apply-resolutions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Apply resolutions for double-coded variables',
    schema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'Response ID' },
              selectedJobId: {
                type: 'number',
                description: 'Selected coding job ID'
              },
              resolutionComment: {
                type: 'string',
                nullable: true,
                description: 'Optional resolution comment'
              }
            },
            required: ['responseId', 'selectedJobId']
          }
        }
      },
      required: ['decisions']
    }
  })
  @ApiOkResponse({
    description: 'Resolutions applied successfully',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the operation was successful'
        },
        appliedCount: {
          type: 'number',
          description: 'Number of resolutions applied'
        },
        failedCount: {
          type: 'number',
          description: 'Number of resolutions that failed'
        },
        skippedCount: {
          type: 'number',
          description: 'Number of resolutions skipped'
        },
        message: { type: 'string', description: 'Summary message' }
      }
    }
  })
  async applyDoubleCodedResolutions(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     decisions: Array<{
                       responseId: number;
                       selectedJobId: number;
                       resolutionComment?: string;
                     }>;
                   }
  ): Promise<{
        success: boolean;
        appliedCount: number;
        failedCount: number;
        skippedCount: number;
        message: string;
      }> {
    return this.workspaceCodingService.applyDoubleCodedResolutions(
      workspace_id,
      body.decisions
    );
  }

  @Get(':workspace_id/coding/cohens-kappa/workspace-summary')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      "Workspace-wide Cohen's Kappa statistics for double-coded incomplete variables.",
    schema: {
      type: 'object',
      properties: {
        coderPairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coder1Id: { type: 'number', description: 'First coder ID' },
              coder1Name: { type: 'string', description: 'First coder name' },
              coder2Id: { type: 'number', description: 'Second coder ID' },
              coder2Name: { type: 'string', description: 'Second coder name' },
              kappa: {
                type: 'number',
                nullable: true,
                description: "Cohen's Kappa coefficient"
              },
              agreement: {
                type: 'number',
                description: 'Observed agreement percentage'
              },
              totalSharedResponses: {
                type: 'number',
                description: 'Total responses coded by both coders'
              },
              validPairs: {
                type: 'number',
                description: 'Number of valid coding pairs'
              },
              interpretation: {
                type: 'string',
                description: 'Interpretation of the Kappa value'
              }
            }
          },
          description:
            "Cohen's Kappa statistics for each coder pair across all double-coded work"
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalDoubleCodedResponses: {
              type: 'number',
              description: 'Total number of double-coded responses'
            },
            totalCoderPairs: {
              type: 'number',
              description: 'Total number of coder pairs analyzed'
            },
            averageKappa: {
              type: 'number',
              nullable: true,
              description: "Average Cohen's Kappa across all coder pairs"
            },
            variablesIncluded: {
              type: 'number',
              description: 'Number of variables included in the analysis'
            },
            codersIncluded: {
              type: 'number',
              description: 'Number of coders included in the analysis'
            }
          },
          description: 'Summary statistics for the entire workspace'
        }
      }
    }
  })
  async getWorkspaceCohensKappaSummary(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        coderPairs: Array<{
          coder1Id: number;
          coder1Name: string;
          coder2Id: number;
          coder2Name: string;
          kappa: number | null;
          agreement: number;
          totalSharedResponses: number;
          validPairs: number;
          interpretation: string;
        }>;
        workspaceSummary: {
          totalDoubleCodedResponses: number;
          totalCoderPairs: number;
          averageKappa: number | null;
          variablesIncluded: number;
          codersIncluded: number;
        };
      }> {
    return this.workspaceCodingService.getWorkspaceCohensKappaSummary(
      workspace_id
    );
  }

  @Get(':workspace_id/coding-job/:codingJobId/notes')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'codingJobId',
    type: Number,
    description: 'ID of the coding job'
  })
  @ApiOkResponse({
    description: 'Coding notes retrieved successfully.',
    schema: {
      type: 'object',
      description: 'Map of composite keys to notes',
      additionalProperties: { type: 'string' }
    }
  })
  async getCodingJobNotes(
    @WorkspaceId() workspace_id: number,
      @Param('codingJobId') codingJobId: number
  ): Promise<Record<string, string>> {
    return this.codingJobService.getCodingNotes(codingJobId);
  }

  @Post(':workspace_id/coding/reset-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiBody({
    description: 'Reset coding version request',
    schema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          enum: ['v1', 'v2', 'v3'],
          description: 'Coding version to reset'
        },
        unitFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional unit names to filter by'
        },
        variableFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional variable IDs to filter by'
        }
      },
      required: ['version']
    }
  })
  @ApiOkResponse({
    description: 'Coding version reset successfully',
    schema: {
      type: 'object',
      properties: {
        affectedResponseCount: {
          type: 'number',
          description: 'Number of responses that were reset'
        },
        cascadeResetVersions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Versions that were also reset due to cascade'
        },
        message: {
          type: 'string',
          description: 'Summary message of the reset operation'
        }
      }
    }
  })
  async resetCodingVersion(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     version: 'v1' | 'v2' | 'v3';
                     unitFilters?: string[];
                     variableFilters?: string[];
                   },
                   @Req() request: RequestWithUser
  ): Promise<{
        affectedResponseCount: number;
        cascadeResetVersions: ('v2' | 'v3')[];
        message: string;
      }> {
    const result = await this.workspaceCodingService.resetCodingVersion(
      workspace_id,
      body.version,
      body.unitFilters,
      body.variableFilters
    );

    // Invalidate statistics cache for reset versions
    await this.codingStatisticsService.invalidateCache(
      workspace_id,
      body.version
    );
    if (result.cascadeResetVersions.length > 0) {
      for (const cascadeVersion of result.cascadeResetVersions) {
        await this.codingStatisticsService.invalidateCache(
          workspace_id,
          cascadeVersion
        );
      }
    }

    // Log to journal
    const userId = request.user?.id || 'unknown';
    await this.journalService.createEntry(
      userId,
      workspace_id,
      'RESET_VERSION',
      'CODING',
      workspace_id,
      {
        version: body.version,
        affectedResponseCount: result.affectedResponseCount,
        unitFilters: body.unitFilters || [],
        variableFilters: body.variableFilters || [],
        cascadeResetVersions: result.cascadeResetVersions
      }
    );

    return result;
  }
}
