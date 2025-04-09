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
import { TestcenterService } from '../../database/services/testcenter.service';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/components/test-center-import/test-center-import.component';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AuthService } from '../../auth/service/auth.service';
import { TestGroupsInListDto } from '../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import FileUpload from '../../database/entities/file_upload.entity';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import WorkspaceUser from '../../database/entities/workspace_user.entity';
import { UploadResultsService } from '../../database/services/upload-results.service';
import Persons from '../../database/entities/persons.entity';

export type Result = {
  success: boolean,
  testFiles: number,
  responses: number,
  logs: number
};

@Controller('admin/workspace')
export class WorkspaceController {
  constructor(
    private workspaceService: WorkspaceService,
    private testCenterService: TestcenterService,
    private authService: AuthService,
    private uploadResults: UploadResultsService
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Admin workspace retrieved successfully.' })
  @ApiTags('admin workspaces')
  async findAll(): Promise<WorkspaceInListDto[]> {
    return this.workspaceService.findAll();
  }

  @Get(':workspace_id/:user_id/token/:duration') // TODO push
  @UseGuards(JwtAuthGuard)
  async createToken(
    @Param('user_id')
      user_id:string,
      @Param('workspace_id') workspace_id: number,
      @Param('duration') duration: number
  ):Promise<string> {
    return this.authService.createToken(user_id, workspace_id, duration);
  }

  // TODO Don't use boolean query params as strings
  @Get(':workspace_id/importWorkspaceFiles')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async importWorkspaceFiles(
    @Param('workspace_id') workspace_id: string,
      @Query('server') server: string,
      @Query('url') url: string,
      @Query('tc_workspace') tc_workspace: string,
      @Query('token') token: string,
      @Query('definitions') definitions: string,
      @Query('responses') responses: string,
      @Query('logs') logs: string,
      @Query('player') player: string,
      @Query('units') units: string,
      @Query('codings') codings: string,
      @Query('testTakers') testTakers: string,
      @Query('booklets') booklets: string)
      : Promise<Result> {
    const importOptions:ImportOptions = {
      definitions: definitions,
      responses: responses,
      units: units,
      player: player,
      codings: codings,
      logs: logs,
      booklets: booklets,
      testTakers: testTakers
    };
    return this.testCenterService.importWorkspaceFiles(workspace_id, tc_workspace, server, url, token, importOptions);
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

  @Get(':workspace_id/test-results')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({ description: 'Test results retrieved successfully.' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findTestResults(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 20
  ): Promise<{ data: Persons[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.workspaceService.findTestResults(workspace_id, { page, limit });
    return {
      data, total, page, limit
    };
  }

  @Get(':workspace_id/users')
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findUsers(@Param('workspace_id') workspace_id: number): Promise<WorkspaceUser[]> {
    return this.workspaceService.findUsers(workspace_id);
  }

  // Todo: use query params
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
  async findTestPersonUnits(@WorkspaceId() id: number, @Param('testPerson') testPerson:string): Promise<ResponseDto[]> {
    return this.workspaceService.findTestPersonUnits(id, testPerson);
  }

  @Get(':workspace_id/test-groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestGroups(@Param('workspace_id') workspace_id:number): Promise<TestGroupsInListDto[]> {
    return this.workspaceService.findTestGroups(workspace_id);
  }

  // Todo: use query params
  @Delete(':workspace_id/test-groups/:testGroupNames')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteTestGroups(
    @Param('testGroupNames')testGroupNames:string,
      @Param('workspace_id')workspaceId:string): Promise<boolean> {
    const splittedTestGroupNames = testGroupNames.split(';');
    return this.workspaceService.deleteTestGroups(workspaceId, splittedTestGroupNames);
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
    const unitIdToUpperCase = unit.toUpperCase();
    return this.workspaceService.findUnitDef(workspace_id, unitIdToUpperCase);
  }

  @Get(':workspace_id/unit/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findUnit(@WorkspaceId() id: number,
    @Param('testPerson') testPerson:string,
    @Param('unitId') unitId:string): Promise<FileUpload[]> {
    const unitIdToUpperCase = unitId.toUpperCase();
    return this.workspaceService.findUnit(id, testPerson, unitIdToUpperCase);
  }

  @Get(':workspace_id/responses/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findResponse(@WorkspaceId() id: number,
    @Param('testPerson') testPerson:string,
    @Param('unitId') unitId:string): Promise<ResponseDto[]> {
    return this.workspaceService.findResponse(id, testPerson, unitId);
  }

  @Get(':workspace_id/responses')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findWorkspaceResponse(@WorkspaceId() id: number): Promise<ResponseDto[]> {
    return this.workspaceService.findWorkspaceResponses(id);
  }

  @Post(':workspace_id/upload')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiTags('workspace')
  async addTestFiles(@Param('workspace_id') workspace_id:number, @UploadedFiles() files): Promise<boolean> {
    return this.workspaceService.uploadTestFiles(workspace_id, files);
  }

  @Post(':workspace_id/upload/results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiTags('workspace')
  async addTestResults(@Param('workspace_id') workspace_id:number, @UploadedFiles() files): Promise<boolean> {
    return this.uploadResults.uploadTestResults(workspace_id, files);
  }

  // TODO: use query params
  // TODO: use ParseIntPipe
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
