import {
  Body,
  Controller,
  Delete,
  Get, Param, Patch,
  Post, Query, UploadedFiles, UseGuards, UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiTags
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { WorkspaceInListDto } from '../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';
import { WorkspaceService } from '../../database/services/workspace.service';
import { WorkspaceId } from './workspace.decorator';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import Responses from '../../database/entities/responses.entity';
import { TestcenterService } from '../../database/services/testcenter.service';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/test-center-import/test-center-import.component';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AuthService } from '../../auth/service/auth.service';
import { TestGroupsInListDto } from '../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import FileUpload from '../../database/entities/file_upload.entity';

@Controller('admin/workspace')
export class WorkspaceController {
  constructor(
    private workspaceService: WorkspaceService,
    private testCenterService: TestcenterService,
    private authService: AuthService
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Admin workspace retrieved successfully.' })
  @ApiTags('admin workspaces')
  async findAll(): Promise<WorkspaceInListDto[]> {
    return this.workspaceService.findAll();
  }

  @Get(':workspace_id/:user_id/token')
  @UseGuards(JwtAuthGuard)
  async createToken(@Param('user_id') user_id:string, @Param('workspace_id') workspace_id:number):Promise<string> {
    const token = this.authService.createToken(user_id, workspace_id);
    return token;
  }

  @Get(':workspace_id/importWorkspaceFiles')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async importWorkspaceFiles(
    @Param('workspace_id') workspace_id: string,
      @Query('server') server: string,
      @Query('tc_workspace') tc_workspace: string,
      @Query('token') token: string,
      @Query('definitions') definitions: string,
      @Query('responses') responses: string,
      @Query('player') player: string,
      @Query('units') units: string,
      @Query('codings') codings: string)
      : Promise<boolean> {
    const importOptions:ImportOptions = {
      definitions: definitions,
      responses: responses,
      units: units,
      player: player,
      codings: codings
    };
    return this.testCenterService.importWorkspaceFiles(workspace_id, tc_workspace, server, token, importOptions);
  }

  @Get(':workspace_id')
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Admin workspace-group retrieved successfully.' })
  @ApiNotFoundResponse({ description: 'Admin workspace not found.' })
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiTags('admin workspaces')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findOne(@WorkspaceId() id: number): Promise<WorkspaceFullDto> {
    return this.workspaceService.findOne(id);
  }

  @Get(':workspace_id/files')
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findFiles(@Param('workspace_id') workspace_id: number): Promise<FilesDto[]> {
    return this.workspaceService.findFiles(workspace_id);
  }

  @Delete(':workspace_id/files/:ids')
  @ApiTags('ws admin test-files')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteTestFiles(
  @Param('workspace_id') workspace_id: number,
    @Param('ids')ids : string) {
    return this.workspaceService.deleteTestFiles(workspace_id, ids.split(';'));
  }

  @Get(':workspace_id/player/:playerName')
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findPlayer(@Param('workspace_id') workspace_id: number,
    @Param('playerName') playerName:string): Promise<FilesDto[]> {
    return this.workspaceService.findPlayer(workspace_id, playerName);
  }

  @Get(':workspace_id/units/:testPerson')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersonUnits(@WorkspaceId() id: number, @Param('testPerson') testPerson:string): Promise<Responses[]> {
    return this.workspaceService.findTestPersonUnits(id, testPerson);
  }

  @Get(':workspace_id/test-groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestGroups(@Param('workspace_id') workspace_id:number): Promise<TestGroupsInListDto[]> {
    return this.workspaceService.findTestGroups(workspace_id);
  }

  @Delete(':workspace_id/test-groups/:testGroupNames')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteTestGroups(@Param('testGroupNames')testGroupNames:string): Promise<boolean> {
    const splittedTestGroupNames = testGroupNames.split(';');
    return this.workspaceService.deleteTestGroups(splittedTestGroupNames);
  }

  @Get(':workspace_id/test-groups/:testGroup')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersons(@WorkspaceId() id: number, @Param('testGroup') testGroup:string): Promise<string[]> {
    return this.workspaceService.findTestPersons(id, testGroup);
  }

  @Get(':workspace_id/:unit/unitDef')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findUnitDef(@Param('workspace_id') workspace_id:number,
    @Param('unit') unit:string): Promise<FilesDto[]> {
    return this.workspaceService.findUnitDef(workspace_id, unit);
  }

  @Get(':workspace_id/unit/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findUnit(@WorkspaceId() id: number,
    @Param('testPerson') testPerson:string,
    @Param('unitId') unitId:string): Promise<FileUpload[]> {
    return this.workspaceService.findUnit(id, testPerson, unitId);
  }

  @Get(':workspace_id/responses/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findResponse(@WorkspaceId() id: number,
    @Param('testPerson') testPerson:string,
    @Param('unitId') unitId:string): Promise<Responses[]> {
    return this.workspaceService.findResponse(id, testPerson, unitId);
  }

  @Post(':workspace_id/upload')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiTags('workspace')
  async addTestFiles(@Param('workspace_id') workspace_id:number, @UploadedFiles() files): Promise<boolean> {
    const res = await this.workspaceService.uploadTestFiles(workspace_id, files);
    return res;
  }

  @Delete(':ids')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @ApiTags('admin workspaces')
  async patch(@Body() workspaces: WorkspaceFullDto) {
    return this.workspaceService.patch(workspaces);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({
    description: 'Sends back the id of the new workspace in database',
    type: Number
  })
  @ApiTags('admin workspaces')
  async create(@Body() createWorkspaceDto: CreateWorkspaceDto) {
    return this.workspaceService.create(createWorkspaceDto);
  }

  @Post(':workspaceId/users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiCreatedResponse({
    description: 'Sends back the id of the new user in database',
    type: Number
  })
  @ApiTags('admin users')
  async setWorkspaceUsers(@Body() userIds: number[],
    @Param('workspaceId') workspaceId: number) {
    return this.workspaceService.setWorkspaceUsers(workspaceId, userIds);
  }
}
