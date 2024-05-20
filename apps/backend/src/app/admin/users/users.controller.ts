import {
  Body,
  Controller, Delete, Get, Param, Post
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiMethodNotAllowedResponse, ApiOkResponse, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { UsersService } from '../../database/services/users.service';
import { UserFullDto } from '../../../../../frontend/api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../frontend/api-dto/user/create-user-dto';
import { AuthService } from '../../auth/service/auth.service';




@Controller('admin/users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private authService: AuthService
  ) {}


  @Get('roles')
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: [UserFullDto]
  })
  @ApiTags('admin users')
  async findUserWithRoles(): Promise<UserFullDto[]> {
    return this.authService.getUserRoles();
  }

  @Get('full')
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: [UserFullDto]
  })
  @ApiTags('admin users')
  async findAllFull(): Promise<UserFullDto[]> {
    return this.usersService.findAllFull();
  }

  @Get(':userId/workspaces')
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: [UserFullDto]
  })
  @ApiTags('admin users')
  async findUserWorkspaces(@Param('userId') userId:number ): Promise<number[]> {
    return this.usersService.findUserWorkspaces(userId);
  }

  // TODO: Delete mit id (statt ids) nur für ein Element (für mehrere s.u.)
  @Delete(':ids')
  @ApiBearerAuth()
  @ApiTags('admin users')
  @ApiOkResponse({ description: 'Admin users deleted successfully.' })
  async remove(@Param('ids') ids: string): Promise<void> {
    const idsAsNumberArray: number[] = [];
    ids.split(';').forEach(s => idsAsNumberArray.push(parseInt(s, 10)));
    return this.usersService.remove(idsAsNumberArray);
  }

  // TODO: Delete mit QueryParam für mehrere Elemente im Frontend implementieren
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
