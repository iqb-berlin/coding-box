import {
  Body,
  Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiMethodNotAllowedResponse,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { UsersService } from '../../users/services/users.service';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';

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
  async getUsersWithWorkspaceAccess(@Param('workspaceId') workspaceId: number): Promise<WorkspaceUserInListDto[] | UserFullDto[]> {
    return this.usersService.getUsersWithWorkspaceAccess(workspaceId);
  }

  @Patch('access/:workspaceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update users access', description: 'Updates access levels for users in a specific workspace' })
  @ApiParam({ name: 'workspaceId', type: Number, description: 'ID of the workspace' })
  @ApiBody({
    type: [UserInListDto],
    description: 'Array of users with updated access levels'
  })
  @ApiOkResponse({ description: 'Users access levels updated successfully.', type: Boolean })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID or user data' })
  @ApiNotFoundResponse({ description: 'Workspace or users not found' })
  @ApiTags('users access')
  async updateUsersAccess(@Param('workspaceId') workspaceId: number, @Body() users: UserInListDto[]): Promise<boolean> {
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
  @ApiBody({ type: UserFullDto, description: 'Updated user data' })
  @ApiOkResponse({ description: 'User updated successfully', type: UserFullDto })
  @ApiBadRequestResponse({ description: 'Invalid user ID or data' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiTags('admin users')
  async updateUser(@Param('userId') userId: number, @Body() userData: UserFullDto): Promise<UserFullDto> {
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
  async getUserWorkspaces(@Param('userId') userId: number): Promise<number[]> {
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
  @ApiBody({
    schema: {
      type: 'array',
      items: {
        type: 'number'
      },
      description: 'Array of workspace IDs to assign to the user'
    }
  })
  @ApiCreatedResponse({
    description: 'Workspaces assigned successfully',
    type: Number
  })
  @ApiBadRequestResponse({ description: 'Invalid user ID or workspace IDs' })
  @ApiNotFoundResponse({ description: 'User or workspaces not found' })
  @ApiTags('admin users')
  async assignUserWorkspaces(@Body() workspaceIds: number[],
    @Param('userId') userId: number) {
    return this.usersService.assignUserWorkspaces(userId, workspaceIds);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new user',
    description: 'Creates a new user with the provided data'
  })
  @ApiBody({
    type: CreateUserDto,
    description: 'User data to create'
  })
  @ApiCreatedResponse({
    description: 'User created successfully. Returns the ID of the new user.',
    type: Number
  })
  @ApiBadRequestResponse({ description: 'Invalid user data' })
  @ApiTags('admin users')
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
