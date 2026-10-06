import {
  ParseIntPipe, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiMethodNotAllowedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { ValidatedBody } from '../../http/validated-body.decorator';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { UsersService } from '../../database/services/users';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';

@ApiTags('Admin Users')
@Controller('admin/users')
export class UsersController {
  constructor(
    private usersService: UsersService
  ) {}

  @Get('access/:workspaceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get users with access to workspace', description: 'Retrieves all users with their access level for a specific workspace' })
  @ApiParam({ name: 'workspaceId', type: Number, description: 'ID of the workspace' })
  @ApiOkResponse({
    description: 'Users with access level retrieved successfully.',
    type: [WorkspaceUserInListDto]
  })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  @ApiTags('users access')
  async getUsersWithWorkspaceAccess(@Param('workspaceId', ParseIntPipe) workspaceId: number): Promise<WorkspaceUserInListDto[] | UserFullDto[]> {
    return this.usersService.getUsersWithWorkspaceAccess(workspaceId);
  }

  @Patch('access/:workspaceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update users access', description: 'Updates access levels for users in a specific workspace' })
  @ApiParam({ name: 'workspaceId', type: Number, description: 'ID of the workspace' })

  @ApiOkResponse({ description: 'Users access levels updated successfully.', type: Boolean })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID or user data' })
  @ApiNotFoundResponse({ description: 'Workspace or users not found' })
  @ApiTags('users access')
  async updateUsersAccess(@Param('workspaceId', ParseIntPipe) workspaceId: number, @ValidatedBody('UsersController_updateUsersAccess') users: RequestBody<'UsersController_updateUsersAccess'>): Promise<boolean> {
    return this.usersService.updateUsersAccess(workspaceId, users);
  }

  @Get('full')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users with full details', description: 'Retrieves all users with their complete details' })
  @ApiOkResponse({
    description: 'Users retrieved successfully',
    type: [UserFullDto]
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve users' })
  @ApiTags('admin users')
  async getAllUsers(): Promise<UserFullDto[]> {
    return this.usersService.getAllUsers();
  }

  @Patch(':userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user', description: 'Updates a user\'s details' })
  @ApiParam({ name: 'userId', type: Number, description: 'ID of the user to update' })

  @ApiOkResponse({ description: 'User updated successfully', type: UserFullDto })
  @ApiBadRequestResponse({ description: 'Invalid user ID or data' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiTags('admin users')
  async updateUser(@Param('userId', ParseIntPipe) userId: number, @ValidatedBody('UserFullDto') userData: RequestBody<'UserFullDto'>): Promise<UserFullDto> {
    return this.usersService.updateUser(userId, userData);
  }

  @Get(':userId/workspaces')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user workspaces', description: 'Retrieves all workspaces associated with a user' })
  @ApiParam({ name: 'userId', type: Number, description: 'ID of the user' })
  @ApiOkResponse({
    description: 'User workspaces retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'number'
      },
      description: 'Array of workspace IDs'
    }
  })
  @ApiBadRequestResponse({ description: 'Invalid user ID' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiTags('admin users')
  async getUserWorkspaces(@Param('userId', ParseIntPipe) userId: number): Promise<number[]> {
    return this.usersService.getUserWorkspaces(userId);
  }

  @Delete(':ids')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete users by IDs',
    description: 'Deletes one or more users by their IDs (separated by semicolons)'
  })
  @ApiParam({
    name: 'ids',
    description: 'Semicolon-separated list of user IDs to delete',
    example: '1;2;3',
    type: String
  })
  @ApiOkResponse({ description: 'Users deleted successfully' })
  @ApiBadRequestResponse({ description: 'Invalid user IDs' })
  @ApiNotFoundResponse({ description: 'One or more users not found' })
  @ApiTags('admin users')
  async deleteUsersByIds(@Param('ids') ids: string, @Req() req): Promise<void> {
    const idsAsNumberArray: number[] = [];
    ids.split(';').forEach(s => idsAsNumberArray.push(parseInt(s, 10)));
    return this.usersService.removeIds(idsAsNumberArray, req.user.id);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete users by query',
    description: 'Deletes users by their IDs provided as query parameters'
  })
  @ApiTags('admin users')
  @ApiQuery({
    name: 'id',
    type: Number,
    isArray: true,
    required: false,
    description: 'IDs of users to delete'
  })
  @ApiOkResponse({ description: 'Users deleted successfully' })
  @ApiBadRequestResponse({ description: 'Invalid user IDs' })
  @ApiNotFoundResponse({ description: 'One or more users not found' })
  @ApiMethodNotAllowedResponse({ description: 'Active admin user must not be deleted' })
  async deleteUsersByQuery(@Query('id') ids: number[], @Req() req): Promise<void> {
    return this.usersService.removeIds(ids, req.user.id);
  }

  @Post(':userId/workspaces')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Assign user workspaces',
    description: 'Assigns workspaces to a user'
  })
  @ApiParam({
    name: 'userId',
    type: Number,
    description: 'ID of the user'
  })

  @ApiCreatedResponse({
    description: 'Workspaces assigned successfully',
    type: Number
  })
  @ApiBadRequestResponse({ description: 'Invalid user ID or workspace IDs' })
  @ApiNotFoundResponse({ description: 'User or workspaces not found' })
  @ApiTags('admin users')
  async assignUserWorkspaces(@ValidatedBody('UsersController_assignUserWorkspaces') workspaceIds: RequestBody<'UsersController_assignUserWorkspaces'>,
    @Param('userId', ParseIntPipe) userId: number) {
    return this.usersService.assignUserWorkspaces(userId, workspaceIds);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new user',
    description: 'Creates a new user with the provided data'
  })

  @ApiCreatedResponse({
    description: 'User created successfully. Returns the ID of the new user.',
    type: Number
  })
  @ApiBadRequestResponse({ description: 'Invalid user data' })
  @ApiTags('admin users')
  async create(@ValidatedBody('CreateUserDto') createUserDto: RequestBody<'CreateUserDto'>) {
    return this.usersService.create(createUserDto);
  }
}
