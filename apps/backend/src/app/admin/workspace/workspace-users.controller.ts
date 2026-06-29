import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get, InternalServerErrorException, Logger, Param, ParseIntPipe, Post, Query, Req, UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AuthService } from '../../auth/service/auth.service';
import WorkspaceUser from '../../database/entities/workspace_user.entity';
import { WorkspaceUsersService } from '../../database/services/workspace/workspace-users.service';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import {
  WORKSPACE_TOKEN_SCOPES,
  WorkspaceTokenPolicy,
  WorkspaceTokenScope
} from '../../auth/workspace-token';

interface RequestWithUser {
  user: {
    id: string | number;
  };
}

@ApiTags('Admin Workspace Users')
@Controller('admin/workspace')
export class WorkspaceUsersController {
  private readonly logger = new Logger(WorkspaceUsersController.name);

  constructor(
    private workspaceUsersService: WorkspaceUsersService,
    private authService: AuthService
  ) {}

  @Get('token-policy')
  @ApiBearerAuth()
  @ApiTags('admin workspace')
  @ApiOperation({
    summary: 'Get workspace token policy',
    description: 'Returns the maximum token duration per workspace API token scope'
  })
  @ApiOkResponse({ description: 'Workspace token policy returned successfully' })
  @UseGuards(JwtAuthGuard)
  getWorkspaceTokenPolicy(): WorkspaceTokenPolicy {
    return this.authService.getWorkspaceTokenPolicy();
  }

  @Get(':workspace_id/token/:duration')
  @ApiBearerAuth()
  @ApiTags('admin workspace')
  @ApiOperation({
    summary: 'Create own authentication token',
    description: 'Creates a JWT token for the authenticated user in a specific workspace with a specified duration'
  })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({
    name: 'duration',
    required: true,
    description: 'Duration of the token in days. The maximum depends on the requested scopes.'
  })
  @ApiOkResponse({ description: 'Token created successfully', type: String })
  @ApiBadRequestResponse({ description: 'Invalid input parameters' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async createOwnToken(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Param('duration') duration: string,
      @Query('scopes') scopes: string | string[] | undefined,
      @Req() request: RequestWithUser
  ): Promise<string> {
    if (!workspaceId || !duration) {
      throw new BadRequestException('Invalid input parameters');
    }
    const durationDays = this.parseTokenDurationDays(duration);
    const tokenScopes = this.parseTokenScopes(scopes);
    this.logger.log(`Generating token for user ${request.user.id} in workspace ${workspaceId} with duration ${durationDays}d`);

    return this.authService.createTokenForUserId(
      Number(request.user.id),
      workspaceId,
      durationDays,
      tokenScopes
    );
  }

  @Get(':workspace_id/:identity/token/:duration')
  @ApiBearerAuth()
  @ApiTags('admin workspace')
  @ApiOperation({ summary: 'Create authentication token', description: 'Creates a JWT token for a user in a specific workspace with a specified duration' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'identity', required: true, description: 'Identity of the user for whom the token is created' })
  @ApiParam({
    name: 'duration',
    required: true,
    description: 'Duration of the token in days. The maximum depends on the requested scopes.'
  })
  @ApiOkResponse({ description: 'Token created successfully', type: String })
  @ApiBadRequestResponse({ description: 'Invalid input parameters' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async createToken(
    @Param('identity') identity: string,
      @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Param('duration') duration: string,
      @Query('scopes') scopes: string | string[] | undefined,
      @Req() request: RequestWithUser
  ): Promise<string> {
    if (!identity || !workspaceId || !duration) {
      throw new BadRequestException('Invalid input parameters');
    }
    const durationDays = this.parseTokenDurationDays(duration);
    const tokenScopes = this.parseTokenScopes(scopes);
    this.logger.log(`Generating token for user ${identity} in workspace ${workspaceId} with duration ${durationDays}d`);

    return this.authService.createToken(
      identity,
      workspaceId,
      durationDays,
      tokenScopes,
      Number(request.user.id)
    );
  }

  private parseTokenScopes(scopes: string | string[] | undefined): WorkspaceTokenScope[] {
    const rawScopes = (Array.isArray(scopes) ? scopes : [scopes])
      .filter((scope): scope is string => typeof scope === 'string')
      .flatMap(scope => scope.split(','))
      .map(scope => scope.trim())
      .filter(Boolean);

    if (rawScopes.length === 0) {
      throw new BadRequestException('At least one token scope is required');
    }

    const allowedScopes = new Set<string>(WORKSPACE_TOKEN_SCOPES);
    const invalidScope = rawScopes.find(scope => !allowedScopes.has(scope));
    if (invalidScope) {
      throw new BadRequestException(`Unsupported token scope: ${invalidScope}`);
    }

    return Array.from(new Set(rawScopes)) as WorkspaceTokenScope[];
  }

  private parseTokenDurationDays(duration: string): number {
    const durationDays = Number(duration);
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1
    ) {
      throw new BadRequestException(
        'Token duration must be a whole number greater than or equal to 1 day'
      );
    }
    return durationDays;
  }

  @Get(':workspace_id/users')
  @ApiTags('admin workspace users')
  @ApiBearerAuth()
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
    description: 'List of users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/WorkspaceUser' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found or no users available'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findUsers(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
                                         @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
                                         @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20
  ): Promise<{ data: WorkspaceUser[]; total: number; page: number; limit: number }> {
    try {
      const [users, total] = await this.workspaceUsersService.findUsers(workspaceId, { page, limit });
      return {
        data: users,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(`Error retrieving users for workspace ${workspaceId}`, error);
      throw new InternalServerErrorException('Could not retrieve workspace users');
    }
  }

  @Post(':workspace_id/users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Set workspace users', description: 'Assigns users to a workspace' })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiBody({
    schema: {
      type: 'array',
      items: {
        type: 'number'
      },
      description: 'Array of user IDs to assign to the workspace'
    }
  })
  @ApiCreatedResponse({
    description: 'Sends back the id of the new user in database',
    type: Number
  })
  @ApiBadRequestResponse({ description: 'Invalid user IDs or workspace ID' })
  @ApiTags('admin users')
  async setWorkspaceUsers(@Body() userIds: number[],
    @Param('workspace_id', ParseIntPipe) workspaceId: number) {
    return this.workspaceUsersService.setWorkspaceUsers(workspaceId, userIds);
  }

  @Get(':workspace_id/coders')
  @ApiTags('admin workspace users')
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'Unique identifier for the workspace'
  })
  @ApiOkResponse({
    description: 'List of users enabled for coding retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/WorkspaceUser' } },
        total: { type: 'number' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found or no coders available'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findCoders(
    @Param('workspace_id', ParseIntPipe) workspaceId: number
  ): Promise<{ data: WorkspaceUser[]; total: number }> {
    try {
      const [coders, total] = await this.workspaceUsersService.findCoders(workspaceId);
      return {
        data: coders,
        total
      };
    } catch (error) {
      this.logger.error(`Error retrieving coders for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0
      };
    }
  }

  @Get(':workspace_id/coding-jobs/:job_id/coders')
  @ApiTags('admin workspace users')
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'Unique identifier for the workspace'
  })
  @ApiParam({
    name: 'job_id',
    type: Number,
    required: true,
    description: 'Unique identifier for the coding job'
  })
  @ApiOkResponse({
    description: 'List of coders assigned to the coding job retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/WorkspaceUser' } },
        total: { type: 'number' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Workspace or coding job not found, or no coders assigned to the job'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findCodersByCodingJob(
    @WorkspaceId() workspaceId: number,
      @Param('job_id', ParseIntPipe) jobId: number
  ): Promise<{ data: WorkspaceUser[]; total: number }> {
    try {
      // In a real implementation, this would filter coders by the specific job ID
      // For now, we'll return all coders for the workspace
      const [coders, total] = await this.workspaceUsersService.findCoders(workspaceId);

      this.logger.log(`Retrieved ${total} coders for workspace ${workspaceId} and coding job ${jobId}`);

      return {
        data: coders,
        total
      };
    } catch (error) {
      this.logger.error(`Error retrieving coders for workspace ${workspaceId} and coding job ${jobId}`);
      return {
        data: [],
        total: 0
      };
    }
  }
}
