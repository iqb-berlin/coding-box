import {
  Body,
  Controller,
  Delete,
  Get, Param,
  Post, UploadedFiles, UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiTags
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { WorkspaceInListDto } from '../../../../../frontend/api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../frontend/api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../frontend/api-dto/workspaces/create-workspace-dto';
import { WorkspaceService } from '../../database/services/workspace.service';
import { WorkspaceId } from './workspace.decorator';
import { FilesDto } from '../../../../../frontend/api-dto/files/files.dto';
import Responses from '../../database/entities/responses.entity';

@Controller('admin/workspace')
export class WorkspaceController {
  constructor(
    private workspaceService: WorkspaceService, private testcenterService: TestcenterService
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

  @Get(':workspace_id/files')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findFiles(@WorkspaceId() id: number): Promise<FilesDto[]> {
    return this.workspaceService.findFiles(id);
  }

  @Get(':workspace_id/player')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findPlayer(@WorkspaceId() id: number): Promise<FilesDto[]> {
    return this.workspaceService.findPlayer(id);
  }

  @Get(':workspace_id/units/:testPerson')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersonUnits(@WorkspaceId() id: number, @Param('testPerson') testPerson:string): Promise<Responses[]> {
    return this.workspaceService.findTestPersonUnits(id, testPerson);
  }

  @Get(':workspace_id/test-groups')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestGroups(@WorkspaceId() id: number): Promise<Responses[]> {
    return this.workspaceService.findTestGroups(id);
  }

  @Get(':workspace_id/test-groups/:testGroup')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersons(@WorkspaceId() id: number, @Param('testGroup') testGroup:string): Promise<Responses[]> {
    return this.workspaceService.findTestPersons(id, testGroup);
  }


  @Get(':workspace_id/:unit/unitDef')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findUnitDef(@WorkspaceId() id: number, @Param('unit') unit:string): Promise<FilesDto[]> {
    return this.workspaceService.findUnitDef(unit);
  }

  @Get(':workspace_id/:testPerson/responses')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findResponse(@WorkspaceId() id: number, @Param('testPerson') testPerson:string): Promise<Responses[]> {
    return this.workspaceService.findResponse(id, testPerson);
  }

  @Get(':workspace_id/test-persons')
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersons(@WorkspaceId() id: number, @Param('testPerson') testPerson:string): Promise<Responses[]> {
    return this.workspaceService.findTestPersons(id, testPerson);
  }

  @Post(':workspace_id/upload')
  @ApiBearerAuth()
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiTags('workspace')
  async addTestFiles(@WorkspaceId() workspaceId: number, @UploadedFiles() files): Promise<any> {
    console.log('""""');
    return this.workspaceService.uploadTestFiles(workspaceId, files);
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

  // @Patch()
  // @ApiBearerAuth()
  // @ApiTags('admin workspaces')
  // async patch(@Body() workspaceGroupFullDto: WorkspaceFullDto) {
  //   return this.workspaceService.patch(workspaceGroupFullDto);
  // }

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
