import {
  Body,
  Controller,
  Delete,
  Get, Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiTags
} from '@nestjs/swagger';
import { UsersService } from '../../database/services/users.service';
import { WorkspaceInListDto } from '../../../../../frontend/api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../frontend/api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../frontend/api-dto/workspaces/create-workspace-dto';
import { WorkspaceService } from '../../database/services/workspace.service';
import { WorkspaceId } from './workspace.decorator';

@Controller('admin/workspace')
export class WorkspaceController {
  constructor(
    private workspaceService: WorkspaceService,
    private userService: UsersService
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Admin workspace retrieved successfully.' })
  @ApiTags('admin workspaces')
  async findAll(): Promise<WorkspaceInListDto[]> {
    return this.workspaceService.findAll();
  }

  @Get(':workspace_id')
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Admin workspace-group retrieved successfully.' })
  @ApiNotFoundResponse({ description: 'Admin workspace not found.' })
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiTags('admin workspaces')
  async findOne(@WorkspaceId() id: number): Promise<WorkspaceFullDto> {
    return this.workspaceService.findOne(id);
  }

  @Delete(':ids')
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Admin workspaces deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Admin workspace  not found.' }) // TODO: not implemented
  @ApiTags('admin workspaces')
  async remove(@Param('ids') ids: string): Promise<void> {
    const idsAsNumberArray: number[] = ids.split(';').map(idString => parseInt(idString, 10));
    return this.workspaceService.remove(idsAsNumberArray);
  }

  @Patch()
  @ApiBearerAuth()
  @ApiTags('admin workspaces')
  async patch(@Body() workspaceGroupFullDto: WorkspaceFullDto) {
    return this.workspaceService.patch(workspaceGroupFullDto);
  }

  @Post()
  @ApiBearerAuth()
  @ApiCreatedResponse({
    description: 'Sends back the id of the new workspace in database',
    type: Number
  })
  @ApiTags('admin workspaces')
  async create(@Body() createWorkspaceGroupDto: CreateWorkspaceDto) {
    return this.workspaceService.create(createWorkspaceGroupDto);
  }
}
