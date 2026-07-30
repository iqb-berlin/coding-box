import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  BadRequestException,
  Req,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiConflictResponse
} from '@nestjs/swagger';
import { CodingStatistics } from '../../database/services/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  AllowWorkspaceTokenScopes,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE
} from '../../auth/workspace-token';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import {
  CodingFreshnessService,
  CodingJobService,
  CodingProcessService,
  CodingResponseQueryService,
  CodingResultsService
} from '../../database/services/coding';
import {
  CodingResponseSortBy,
  CodingResponseSortDirection
} from '../../database/services/coding/coding-response-query.service';
import { ResponseEntity } from '../../database/entities/response.entity';
import { JobQueueService } from '../../job-queue/job-queue.service';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  constructor(
    private codingProcessService: CodingProcessService,
    private codingResponseQueryService: CodingResponseQueryService,
    private codingJobService: CodingJobService,
    private codingResultsService: CodingResultsService,
    private codingFreshnessService: CodingFreshnessService,
    private jobQueueService: JobQueueService
  ) { }

  private getRequestUserId(req: Request): number {
    const user = (req as Request & { user?: { id?: number | string; userId?: number | string } }).user;
    const userId = Number(user?.id ?? user?.userId);

    if (!Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedException('User ID not found in request');
    }

    return userId;
  }

  private parseAutoCoderRun(autoCoderRun?: string | string[]): 1 | 2 {
    if (autoCoderRun === undefined) {
      return 1;
    }

    if (Array.isArray(autoCoderRun)) {
      if (autoCoderRun.length === 1) {
        return this.parseAutoCoderRun(autoCoderRun[0]);
      }

      throw new BadRequestException('autoCoderRun must be 1 or 2');
    }

    const trimmedAutoCoderRun = autoCoderRun.trim();
    if (trimmedAutoCoderRun === '') {
      return 1;
    }

    const parsed = Number(trimmedAutoCoderRun);
    if (Number.isInteger(parsed) && (parsed === 1 || parsed === 2)) {
      return parsed;
    }

    throw new BadRequestException('autoCoderRun must be 1 or 2');
  }

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
  @ApiConflictResponse({
    description: 'A reset coding version job is running for this workspace'
  })
  async codeTestPersons(
    @Query('testPersons') testPersons: string,
      @WorkspaceId() workspace_id: number,
      @Query('autoCoderRun') autoCoderRun: string | string[] | undefined
  ): Promise<CodingStatistics> {
    const autoCoderRunNumber = this.parseAutoCoderRun(autoCoderRun);
    await this.jobQueueService.assertNoDependencyConflicts('test-person-coding', workspace_id);
    await this.codingFreshnessService.assertAutoCodingRunCanStart(
      workspace_id,
      autoCoderRunNumber
    );

    return this.codingProcessService.codeTestPersons(
      workspace_id,
      testPersons,
      autoCoderRunNumber
    );
  }

  @Get(':workspace_id/coding/manual')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'codedStatus',
    required: false,
    description: 'Optional response status_v1 filter, e.g. DERIVE_ERROR'
  })
  async getManualTestPersons(
    @Query('testPersons') testPersons: string,
      @Query('codedStatus') codedStatus: string,
      @WorkspaceId() /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
                          workspace_id: number
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.codingResponseQueryService.getManualTestPersons(
      workspace_id,
      testPersons,
      codedStatus
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
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Column to sort by',
    enum: [
      'unitname',
      'variableid',
      'value',
      'codedstatus',
      'code',
      'score',
      'person_code',
      'person_login',
      'person_group',
      'booklet_id'
    ]
  })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    description: 'Sort direction',
    enum: ['asc', 'desc']
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
                   @Query('limit') limit: number = 100,
                   @Query('sortBy') sortBy?: CodingResponseSortBy,
                   @Query('sortDirection') sortDirection?: CodingResponseSortDirection
  ): Promise<{
        data: ResponseEntity[];
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500

    return this.codingResponseQueryService.getResponsesByStatus(
      workspace_id,
      status,
      version,
      validPage,
      validLimit,
      sortBy,
      sortDirection
    );
  }

  @Get(':workspace_id/coding-job/:codingJobId/notes')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
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
      @Param('codingJobId') codingJobId: number,
      @Req() req: Request
  ): Promise<Record<string, string>> {
    const jobId = Number(codingJobId);
    await this.codingJobService.assertUserCanAccessCodingJob(
      jobId,
      workspace_id,
      this.getRequestUserId(req)
    );
    return this.codingJobService.getCodingNotes(jobId);
  }

  @Post(':workspace_id/coding/apply-empty-responses')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Empty response coding applied successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the operation was successful' },
        updatedCount: { type: 'number', description: 'Number of responses updated' },
        message: { type: 'string', description: 'Status message' }
      }
    }
  })
  async applyEmptyResponseCoding(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        success: boolean;
        updatedCount: number;
        message: string;
      }> {
    return this.codingResultsService.applyEmptyResponseCoding(workspace_id);
  }
}
