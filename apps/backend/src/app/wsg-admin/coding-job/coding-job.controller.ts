import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  ValidationPipe
} from '@nestjs/common';
import { Request } from 'express';

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
import { JwtOrWorkspaceTokenAuthGuard } from '../../auth/jwt-or-workspace-token-auth.guard';
import {
  AllowWorkspaceTokenScopes,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE
} from '../../auth/workspace-token';
import { WorkspaceGuard } from '../../admin/workspace/workspace.guard';
import { WorkspaceId } from '../../admin/workspace/workspace.decorator';
import {
  AccessLevelGuard,
  RequireAccessLevel
} from '../../admin/workspace/access-level.guard';
import {
  CodingJobService,
  CodingReplayService
} from '../../database/services/coding';
import { UsersService } from '../../database/services/users';
import {
  CodingJobListSortBy,
  CodingJobListSortDirection
} from '../../database/services/coding/coding-job.service';
import { CodingJobDto } from '../../admin/coding-job/dto/coding-job.dto';
import { CreateCodingJobDto } from '../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../admin/coding-job/dto/update-coding-job.dto';
import { UpdateCodingJobCommentDto } from '../../admin/coding-job/dto/update-coding-job-comment.dto';
import { UpdateCodingJobStatusDto } from '../../admin/coding-job/dto/update-coding-job-status.dto';
import { SaveCodingProgressDto } from '../../admin/coding-job/dto/save-coding-progress.dto';
import { SaveCodingNotesDto } from '../../admin/coding-job/dto/save-coding-notes.dto';
import { TransferCodingCasesDto } from '../../admin/coding-job/dto/transfer-coding-cases.dto';
import { TransferCodingCasesResultDto } from '../../admin/coding-job/dto/transfer-coding-cases-result.dto';

@ApiTags('WSG Admin Coding Jobs')
@Controller('wsg-admin/workspace/:workspace_id/coding-job')
export class WsgCodingJobController {
  constructor(
    private readonly codingJobService: CodingJobService,
    private readonly codingReplayService: CodingReplayService,
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

  private parseOptionalPositiveInt(
    value: string | undefined,
    fieldName: string
  ): number | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }
    return parsed;
  }

  private normalizeJobScope(
    scope: string | undefined
  ): 'all' | 'training' | 'productive' | undefined {
    if (!scope) {
      return undefined;
    }
    if (scope === 'all' || scope === 'training' || scope === 'productive') {
      return scope;
    }
    throw new BadRequestException(
      'scope must be one of "all", "training", or "productive"'
    );
  }

  private normalizeSortBy(
    sortBy: string | undefined
  ): CodingJobListSortBy | undefined {
    if (!sortBy) {
      return undefined;
    }
    if (
      sortBy === 'name' ||
      sortBy === 'description' ||
      sortBy === 'status' ||
      sortBy === 'createdAt' ||
      sortBy === 'updatedAt'
    ) {
      return sortBy;
    }
    throw new BadRequestException(
      'sortBy must be one of "name", "description", "status", "createdAt", or "updatedAt"'
    );
  }

  private normalizeSortDirection(
    sortDirection: string | undefined
  ): CodingJobListSortDirection | undefined {
    if (!sortDirection) {
      return undefined;
    }
    if (sortDirection === 'asc' || sortDirection === 'desc') {
      return sortDirection;
    }
    throw new BadRequestException('sortDirection must be "asc" or "desc"');
  }

  private async assertCodingJobAccess(
    workspaceId: number,
    codingJobId: number,
    req: Request
  ): Promise<void> {
    await this.codingJobService.assertUserCanAccessCodingJob(
      codingJobId,
      workspaceId,
      this.getRequestUserId(req)
    );
  }

  private async assertCodingJobCodingAccess(
    workspaceId: number,
    codingJobId: number,
    req: Request
  ): Promise<void> {
    await this.codingJobService.assertUserCanCodeCodingJob(
      codingJobId,
      workspaceId,
      this.getRequestUserId(req)
    );
  }

  private async assertCodingIssueReviewAccess(
    workspaceId: number,
    codingJobId: number,
    req: Request
  ): Promise<number> {
    const userId = this.getRequestUserId(req);
    await this.codingJobService.getCodingJob(codingJobId, workspaceId);

    if (await this.usersService.getUserIsAdmin(userId)) {
      return userId;
    }

    const accessLevel = await this.usersService.getUserAccessLevel(
      userId,
      workspaceId
    );
    if ((accessLevel ?? 0) >= 2) {
      return userId;
    }

    throw new ForbiddenException(
      'User is not allowed to review coding issues in this workspace'
    );
  }

  private async shouldRestrictJobListToCurrentUser(
    workspaceId: number,
    req: Request
  ): Promise<boolean> {
    const userId = this.getRequestUserId(req);
    if (await this.usersService.getUserIsAdmin(userId)) {
      return false;
    }

    const accessLevel = await this.usersService.getUserAccessLevel(
      userId,
      workspaceId
    );

    return (accessLevel ?? 0) < 2;
  }

  private async prepareCodingJobReplay(
    workspaceId: number,
    codingJobId: number,
    req: Request,
    onlyOpen: boolean
  ): Promise<{ total: number; firstReplayUrl: string }> {
    const items = await this.codingJobService.getCodingJobUnits(
      codingJobId,
      onlyOpen
    );

    if (items.length === 0) {
      return { total: 0, firstReplayUrl: '' };
    }

    const serverUrl = `${req.protocol}://${req.get('host') ?? ''}`;
    const firstItemWithUrl =
      await this.codingReplayService.generateReplayUrlsForItemsBulk(
        workspaceId,
        [items[0]],
        serverUrl
      );

    return {
      total: items.length,
      firstReplayUrl: firstItemWithUrl[0]?.replayUrl ?? ''
    };
  }

  @Post('transfer-cases')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Transfer coding cases between coders',
    description:
      'Transfers coding jobs/cases assigned to one coder to another coder within the same workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Coding cases transferred successfully',
    type: TransferCodingCasesResultDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid transfer request.'
  })
  async transferCodingCases(
    @WorkspaceId() workspaceId: number,
      @Body() transferCodingCasesDto: TransferCodingCasesDto
  ): Promise<TransferCodingCasesResultDto> {
    return this.codingJobService.transferCodingCases(
      workspaceId,
      transferCodingCasesDto.sourceCoderId,
      transferCodingCasesDto.targetCoderId
    );
  }

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
  @ApiQuery({
    name: 'assignedTo',
    required: false,
    description:
      'Use "me" to return only coding jobs assigned to the authenticated user',
    type: String
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    description: 'Filter jobs by scope: all, training, or productive',
    type: String
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter jobs by status',
    type: String
  })
  @ApiQuery({
    name: 'excludeStatus',
    required: false,
    description: 'Exclude jobs with this status',
    type: String
  })
  @ApiQuery({
    name: 'coderId',
    required: false,
    description: 'Filter jobs assigned to a coder',
    type: Number
  })
  @ApiQuery({
    name: 'jobName',
    required: false,
    description: 'Filter jobs by name fragment',
    type: String
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description:
      'Sort jobs by name, description, status, createdAt, or updatedAt',
    type: String
  })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    description: 'Sort direction: asc or desc',
    type: String
  })
  @ApiQuery({
    name: 'trainingId',
    required: false,
    description: 'Filter jobs by training ID or "none"',
    type: String
  })
  @ApiQuery({
    name: 'includeIssueSummary',
    required: false,
    description:
      'Include aggregated coding issue summaries in the list response',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'List of coding jobs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/CodingJobDto' }
        },
        total: { type: 'number' },
        totalOpenUnits: { type: 'number' },
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
      @Query('limit', new ParseIntPipe({ optional: true }))
                   limit: number | undefined,
                   @Query('assignedTo') assignedTo: string | undefined,
                   @Query('scope') scope: string | undefined,
                   @Query('status') status: string | undefined,
                   @Query('excludeStatus') excludeStatus: string | undefined,
                   @Query('coderId') coderIdParam: string | undefined,
                   @Query('jobName') jobName: string | undefined,
                   @Query('sortBy') sortBy: string | undefined,
                   @Query('sortDirection') sortDirection: string | undefined,
                   @Query('trainingId') trainingIdParam: string | undefined,
                   @Query('includeIssueSummary') includeIssueSummary: string | undefined,
                   @Req() req: Request
  ): Promise<{
        data: CodingJobDto[];
        total: number;
        totalOpenUnits: number;
        page: number;
        limit?: number;
      }> {
    let assignedToUserId: number | undefined;
    if (assignedTo) {
      if (assignedTo !== 'me') {
        throw new BadRequestException('assignedTo must be "me" when provided');
      }
      assignedToUserId = this.getRequestUserId(req);
    } else if (await this.shouldRestrictJobListToCurrentUser(workspaceId, req)) {
      assignedToUserId = this.getRequestUserId(req);
    }

    const trainingId =
      trainingIdParam === 'none' ?
        'none' :
        this.parseOptionalPositiveInt(trainingIdParam, 'trainingId');
    const result = await this.codingJobService.getCodingJobs(
      workspaceId,
      page,
      limit,
      assignedToUserId,
      {
        scope: this.normalizeJobScope(scope),
        status,
        excludeStatus: status ? undefined : excludeStatus,
        coderId: this.parseOptionalPositiveInt(coderIdParam, 'coderId'),
        jobName,
        trainingId,
        includeIssueSummary: includeIssueSummary === 'true',
        sortBy: this.normalizeSortBy(sortBy),
        sortDirection: this.normalizeSortDirection(sortDirection)
      }
    );
    return {
      data: result.data.map(job => CodingJobDto.fromEntity(
        job,
        job.assignedCoders,
        job.assignedVariables,
        job.assignedVariableBundles
      )
      ),
      total: result.total,
      totalOpenUnits: result.totalOpenUnits,
      page: result.page,
      limit: result.limit
    };
  }

  @Get(':id')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
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
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobAccess(workspaceId, id, req);
    const result = await this.codingJobService.getCodingJob(id, workspaceId);
    return CodingJobDto.fromEntity(
      result.codingJob,
      result.assignedCoders,
      result.variables,
      result.variableBundles.map(vb => ({
        name: vb.name,
        variables: vb.variables
      }))
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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

    if (
      Object.prototype.hasOwnProperty.call(
        createCodingJobDto as unknown as Record<string, unknown>,
        'jobDefinitionId'
      )
    ) {
      throw new BadRequestException(
        'jobDefinitionId cannot be set when creating a coding job directly. Use the job definition create-job endpoint.'
      );
    }

    try {
      const codingJob = await this.codingJobService.createCodingJob(
        workspaceId,
        createCodingJobDto
      );
      return CodingJobDto.fromEntity(codingJob);
    } catch (error) {
      throw new BadRequestException(
        `Failed to create coding job: ${error.message}`
      );
    }
  }

  @Put(':id')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
      @Body() updateCodingJobDto: UpdateCodingJobDto,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobAccess(workspaceId, id, req);
    return this.codingJobService.updateCodingJob(
      id,
      workspaceId,
      updateCodingJobDto
    );
  }

  @Put(':id/status')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a coding job status from replay',
    description: 'Updates only the replay-safe status field of a coding job'
  })
  @ApiOkResponse({
    description: 'The coding job status has been successfully updated.',
    type: CodingJobDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async updateCodingJobStatus(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) updateCodingJobStatusDto: UpdateCodingJobStatusDto,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobCodingAccess(workspaceId, id, req);
    return this.codingJobService.updateCodingJob(
      id,
      workspaceId,
      { status: updateCodingJobStatusDto.status }
    );
  }

  @Put(':id/comment')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a coding job comment from replay',
    description: 'Updates only the replay-safe comment field of a coding job'
  })
  @ApiOkResponse({
    description: 'The coding job comment has been successfully updated.',
    type: CodingJobDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async updateCodingJobComment(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) updateCodingJobCommentDto: UpdateCodingJobCommentDto,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobAccess(workspaceId, id, req);
    return this.codingJobService.updateCodingJob(
      id,
      workspaceId,
      { comment: updateCodingJobCommentDto.comment }
    );
  }

  @Post(':id/start')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start a coding job',
    description:
      'Finds all responses matching assigned variables and prepares replay data with URLs'
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
    description: 'Replay data prepared successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        firstReplayUrl: { type: 'string' }
      }
    }
  })
  async startCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<{ total: number; firstReplayUrl: string }> {
    await this.assertCodingJobCodingAccess(workspaceId, id, req);
    const job = await this.codingJobService.getCodingJob(id, workspaceId);

    const onlyOpen = job.codingJob.status === 'open';
    const isFinalizedJob = ['review', 'results_applied'].includes(
      job.codingJob.status
    );

    if (!isFinalizedJob) {
      await this.codingJobService.updateCodingJob(id, workspaceId, {
        status: 'active'
      });
    }

    return this.prepareCodingJobReplay(workspaceId, id, req, onlyOpen);
  }

  @Post(':id/pause')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Pause an assigned coding job',
    description: 'Pauses a coding job assigned to the current coder'
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
    description: 'The coding job has been paused.',
    type: CodingJobDto
  })
  async pauseCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobCodingAccess(workspaceId, id, req);
    const codingJob = await this.codingJobService.pauseCodingJob(
      id,
      workspaceId
    );
    return CodingJobDto.fromEntity(codingJob);
  }

  @Post(':id/resume')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resume an assigned coding job',
    description: 'Marks a coding job assigned to the current coder as active'
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
    description: 'The coding job has been resumed.',
    type: CodingJobDto
  })
  async resumeCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobCodingAccess(workspaceId, id, req);
    const codingJob = await this.codingJobService.resumeCodingJob(
      id,
      workspaceId
    );
    return CodingJobDto.fromEntity(codingJob);
  }

  @Post(':id/submit')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit an assigned coding job',
    description: 'Completes a coding job assigned to the current coder'
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
    description: 'The coding job has been submitted.',
    type: CodingJobDto
  })
  @ApiBadRequestResponse({
    description: 'The coding job cannot be completed yet.'
  })
  async submitCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobCodingAccess(workspaceId, id, req);
    const codingJob = await this.codingJobService.submitCodingJob(
      id,
      workspaceId
    );
    return CodingJobDto.fromEntity(codingJob);
  }

  @Get(':id/review')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Prepare a coding job review',
    description:
      'Prepares replay data for read-only review without changing job state'
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
    description: 'Review replay data prepared successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        firstReplayUrl: { type: 'string' }
      }
    }
  })
  async prepareCodingJobReview(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<{ total: number; firstReplayUrl: string }> {
    await this.assertCodingJobAccess(workspaceId, id, req);
    return this.prepareCodingJobReplay(workspaceId, id, req, false);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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

  @Post(':id/progress')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Save coding progress',
    description:
      'Saves partial coding progress for a specific unit-variable combination'
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
    description: 'Coding progress saved successfully',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async saveCodingProgress(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true }))
                   saveCodingProgressDto: SaveCodingProgressDto,
                   @Req() req: Request
  ): Promise<CodingJobDto> {
    const userId = saveCodingProgressDto.issueReview ?
      await this.assertCodingIssueReviewAccess(workspaceId, id, req) :
      undefined;
    if (!saveCodingProgressDto.issueReview) {
      await this.assertCodingJobCodingAccess(workspaceId, id, req);
      await this.codingJobService.getCodingJob(id, workspaceId);
    }
    const codingJob = saveCodingProgressDto.issueReview ?
      await this.codingJobService.saveCodingIssueReviewProgress(
        id,
        userId as number,
        saveCodingProgressDto
      ) :
      await this.codingJobService.saveCodingProgress(
        id,
        saveCodingProgressDto
      );
    return CodingJobDto.fromEntity(codingJob);
  }

  @Post(':id/notes')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Save coding notes',
    description:
      'Saves coder notes without changing the selected code or coding progress'
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
    description: 'Coding notes saved successfully',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async saveCodingNotes(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true }))
                   saveCodingNotesDto: SaveCodingNotesDto,
                   @Req() req: Request
  ): Promise<CodingJobDto> {
    const userId = saveCodingNotesDto.issueReview ?
      await this.assertCodingIssueReviewAccess(workspaceId, id, req) :
      undefined;
    if (!saveCodingNotesDto.issueReview) {
      await this.assertCodingJobCodingAccess(workspaceId, id, req);
      await this.codingJobService.getCodingJob(id, workspaceId);
    }
    const codingJob = saveCodingNotesDto.issueReview ?
      await this.codingJobService.saveCodingIssueReviewNotes(
        id,
        userId as number,
        saveCodingNotesDto
      ) :
      await this.codingJobService.saveCodingNotes(
        id,
        saveCodingNotesDto
      );
    return CodingJobDto.fromEntity(codingJob);
  }

  @Post(':id/restart-open-units')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restart coding job with only open units',
    description: 'Removes coded units and keeps only open units for recoding'
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
    description: 'Coding job restarted with open units only',
    type: CodingJobDto
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async restartCodingJobWithOpenUnits(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<CodingJobDto> {
    await this.assertCodingJobAccess(workspaceId, id, req);
    const codingJob = await this.codingJobService.restartCodingJobWithOpenUnits(
      id,
      workspaceId
    );
    return CodingJobDto.fromEntity(codingJob);
  }

  @Get(':id/progress')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding progress',
    description: 'Retrieves saved partial coding progress for a coding job'
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
    description: 'Coding progress retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: { type: 'object' }
    }
  })
  @ApiNotFoundResponse({
    description: 'Coding job not found.'
  })
  async getCodingProgress(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request
  ): Promise<Record<string, unknown>> {
    await this.assertCodingJobAccess(workspaceId, id, req);
    await this.codingJobService.getCodingJob(id, workspaceId);
    return this.codingJobService.getCodingProgress(id);
  }

  @Get('progress/bulk')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get bulk coding progress',
    description:
      'Retrieves saved partial coding progress for multiple coding jobs in bulk'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiQuery({
    name: 'jobIds',
    required: true,
    description: 'Comma-separated list of coding job IDs',
    type: String
  })
  @ApiOkResponse({
    description: 'Bulk coding progress retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: { type: 'object' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'One or more coding jobs not found.'
  })
  async getBulkCodingProgress(
    @WorkspaceId() workspaceId: number,
      @Query('jobIds') jobIdsParam: string,
      @Req() req: Request
  ): Promise<Record<number, Record<string, unknown>>> {
    if (!jobIdsParam?.trim()) {
      throw new BadRequestException('Invalid job IDs provided');
    }

    const jobIds = jobIdsParam
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => Number.isFinite(id) && id > 0);

    if (jobIds.length === 0) {
      throw new BadRequestException('Invalid job IDs provided');
    }

    await Promise.all(
      jobIds.map(jobId => this.assertCodingJobAccess(workspaceId, jobId, req))
    );

    return this.codingJobService.getBulkCodingProgress(jobIds, workspaceId);
  }

  @Get(':id/units')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE)
  @UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get coding job units',
    description:
      'Retrieves all units assigned to a coding job without starting it'
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
    description: 'Units retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          responseId: { type: 'number' },
          unitName: { type: 'string' },
          unitAlias: { type: 'string' },
          variableId: { type: 'string' },
          variableAnchor: { type: 'string' },
          variablePage: { type: 'string' },
          bookletName: { type: 'string' },
          personLogin: { type: 'string' },
          personCode: { type: 'string' },
          personGroup: { type: 'string' },
          variableBundleId: { type: 'number', nullable: true },
          bundleContext: {
            type: 'object',
            nullable: true,
            properties: {
              bundleId: { type: 'number' },
              bundleName: { type: 'string' },
              caseKey: { type: 'string' },
              caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    responseId: { type: 'number', nullable: true },
                    unitName: { type: 'string' },
                    variableId: { type: 'string' },
                    variableAnchor: { type: 'string' },
                    variablePage: { type: 'string' },
                    status: { type: 'string' },
                    code: { type: 'number', nullable: true },
                    score: { type: 'number', nullable: true },
                    source: { type: 'string' }
                  }
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
  @ApiQuery({
    name: 'onlyOpen',
    required: false,
    type: Boolean,
    description: 'When true, returns only units that are marked open'
  })
  async getCodingJobUnits(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Req() req: Request,
      @Query('onlyOpen') onlyOpen?: string
  ): Promise<
      Array<{
        responseId: number;
        unitName: string;
        unitAlias: string | null;
        variableId: string;
        variableAnchor: string;
        variablePage: string;
        bookletName: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        variableBundleId: number | null;
        bundleContext: unknown | null;
        isDoubleCoded: boolean;
        otherCoders: string[];
      }>
      > {
    await this.assertCodingJobAccess(workspaceId, id, req);
    await this.codingJobService.getCodingJob(id, workspaceId);
    return this.codingJobService.getCodingJobUnits(id, onlyOpen === 'true');
  }
}
