import {
  BadRequestException,
  Body,
  Controller,
  Get, Param, Post, Query, UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { logger } from 'nx/src/utils/logger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AuthService } from '../../auth/service/auth.service';
import WorkspaceUser from '../../database/entities/workspace_user.entity';
import { WorkspaceUsersService } from '../../database/services/workspace-users.service';

@ApiTags('Admin Workspace Users')
@Controller('admin/workspace')
export class WorkspaceUsersController {
  constructor(
    private workspaceUsersService: WorkspaceUsersService,
    private authService: AuthService
  ) {}

  @Get(':workspace_id/:user_id/token/:duration')
  @ApiBearerAuth()
  @ApiTags('admin workspace')
  @ApiOperation({ summary: 'Create authentication token', description: 'Creates a JWT token for a user in a specific workspace with a specified duration' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'user_id', required: true, description: 'ID of the user' })
  @ApiParam({ name: 'duration', required: true, description: 'Duration of the token in seconds' })
  @ApiOkResponse({ description: 'Token created successfully', type: String })
  @ApiBadRequestResponse({ description: 'Invalid input parameters' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async createToken(
    @Param('user_id') userId: string,
      @Param('workspace_id') workspaceId: number,
      @Param('duration') duration: number
  ): Promise<string> {
    if (!userId || !workspaceId || !duration) {
      throw new BadRequestException('Invalid input parameters');
    }
    logger.log(`Generating token for user ${userId} in workspace ${workspaceId} with duration ${duration}s`);

    return this.authService.createToken(userId, workspaceId, duration);
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
    @Param('workspace_id') workspaceId: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20
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
      logger.error(`Error retrieving users for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }
  }

  @Post(':workspaceId/users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({ summary: 'Set workspace users', description: 'Assigns users to a workspace' })
  @ApiParam({ name: 'workspaceId', type: Number, description: 'ID of the workspace' })
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
    @Param('workspaceId') workspaceId: number) {
    return this.workspaceUsersService.setWorkspaceUsers(workspaceId, userIds);
  }
}
