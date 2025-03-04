import {
  Body,
  Controller, Delete, Get, Param, Patch, Post, UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiMethodNotAllowedResponse, ApiOkResponse, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { UsersService } from '../../database/services/users.service';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';

@Controller('admin/users')
export class UsersController {
  constructor(
    private usersService: UsersService
  ) {}

  @Get('access/:workspaceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Users with access level.' })
  @ApiTags('users access')
  async findAll(@Param('workspaceId') workspaceId:number): Promise<WorkspaceUserInListDto[] | UserFullDto[]> {
    return this.usersService.findAllUsers(workspaceId);
  }

  @Patch('access/:workspaceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Group admin users retrieved successfully.' })
  @ApiTags('users access')
  async patchAll(@Param('workspaceId') workspaceId:number, @Body() users: UserInListDto[]): Promise<boolean> {
    return this.usersService.patchAllUsers(workspaceId, users);
  }

  @Get('full')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: [UserFullDto]
  })
  @ApiTags('admin users')
  async findAllFull(): Promise<UserFullDto[]> {
    return this.usersService.findAllFull();
  }

  @Patch(':userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiTags('admin users')
  async editUser(@Param('userId') userId:number, @Body() change: UserFullDto): Promise<UserFullDto[]> {
    return this.usersService.editUser(userId, change);
  }

  @Get(':userId/workspaces')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: [UserFullDto]
  })
  @ApiTags('admin users')
  async findUserWorkspaces(@Param('userId') userId:number): Promise<number[]> {
    return this.usersService.findUserWorkspaceIds(userId);
  }

  @Delete(':ids')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiTags('admin users')
  @ApiOkResponse({ description: 'Admin users deleted successfully.' })
  async remove(@Param('ids') ids: string): Promise<void> {
    const idsAsNumberArray: number[] = [];
    ids.split(';').forEach(s => idsAsNumberArray.push(parseInt(s, 10)));
    return this.usersService.remove(idsAsNumberArray);
  }

  @Delete()
  @ApiBearerAuth()
  @ApiTags('admin users')
  @ApiQuery({
    name: 'id',
    type: Number,
    isArray: true,
    required: false
  })
  @ApiOkResponse({ description: 'Admin users deleted successfully.' })
  @ApiMethodNotAllowedResponse({ description: 'Active admin user must not be deleted.' })
  async removeIds(ids: number[]): Promise<void> {
    return this.usersService.removeIds(ids);
  }

  @Post(':userId/workspaces')
  @ApiBearerAuth()
  @ApiCreatedResponse({
    description: 'Sends back the id of the new user in database',
    type: Number
  })
  @ApiTags('admin users')
  async setUserWorkspaces(@Body() workspaceIds: number[],
    @Param('userId') userId: number) {
    return this.usersService.setUserWorkspaces(userId, workspaceIds);
  }

  @Post()
  @ApiBearerAuth()
  @ApiCreatedResponse({
    description: 'Sends back the id of the new user in database',
    type: Number
  })
  @ApiTags('admin users')
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
