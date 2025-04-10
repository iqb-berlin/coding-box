import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get, NotFoundException, Param, Patch,
  Post, Query, UploadedFiles, UseGuards, UseInterceptors
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
  @ApiTags('admin workspaces')
  @ApiOkResponse({
    description: 'List of admin workspaces retrieved successfully.',
    type: [WorkspaceInListDto] // Spezifiziert, dass ein Array des DTOs zurückgegeben wird
  })
  async findAll(): Promise<WorkspaceInListDto[]> {
    try {
      return await this.workspaceService.findAll();
    } catch (error) {
      throw new BadRequestException('Failed to retrieve admin workspaces. Please try again later.');
    }
  }

  @Get(':workspace_id/:user_id/token/:duration')
  @ApiBearerAuth()
  @ApiTags('admin workspace')
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'user_id', required: true, description: 'ID of the user' })
  @ApiParam({ name: 'duration', required: true, description: 'Duration of the token in seconds' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard) // Sicherstellen, dass die Route geschützt ist
  async createToken(
    @Param('user_id') userId: string,
      @Param('workspace_id') workspaceId: number,
      @Param('duration') duration: number
  ): Promise<string> {
    if (!userId || !workspaceId || !duration) {
      throw new BadRequestException('Invalid input parameters');
    }
    console.log(`Generating token for user ${userId} in workspace ${workspaceId} with duration ${duration}s`);

    return this.authService.createToken(userId, workspaceId, duration);
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
  @ApiTags('admin workspaces')
  @ApiOkResponse({
    description: 'Admin workspace retrieved successfully.',
    type: WorkspaceFullDto
  })
  @ApiNotFoundResponse({ description: 'Admin workspace not found.' })
  @ApiBadRequestResponse({ description: 'Invalid workspace ID.' })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'Unique identifier of the workspace'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findOne(@WorkspaceId() id: number): Promise<WorkspaceFullDto> {
    if (!id || id <= 0) {
      throw new BadRequestException('Invalid workspace ID.');
    }
    try {
      const workspace = await this.workspaceService.findOne(id);
      if (!workspace) {
        throw new NotFoundException('Admin workspace not found.');
      }
      return workspace;
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve workspace: ${error.message}`);
    }
  }

  @Get(':workspace_id/files')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The unique ID of the workspace for which the files should be retrieved.'
  })
  @ApiOkResponse({
    description: 'A list of files was successfully retrieved.',
    type: [FilesDto]
  })
  @ApiNotFoundResponse({
    description: 'The requested workspace could not be found.'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findFiles(@Param('workspace_id') workspace_id: number): Promise<FilesDto[]> {
    if (!workspace_id || workspace_id <= 0) {
      throw new BadRequestException(
        'Invalid workspace ID. Please provide a valid ID.'
      );
    }
    try {
      const files = await this.workspaceService.findFiles(workspace_id);
      if (!files || files.length === 0) {
        throw new BadRequestException(
          `No files found for the workspace with ID ${workspace_id}.`
        );
      }
      return files;
    } catch (error) {
      throw new BadRequestException(
        `An error occurred while fetching files for workspace ${workspace_id}: ${error.message}`
      );
    }
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
  @ApiTags('admin workspace users')
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'Unique identifier for the workspace'
  })
  @ApiOkResponse({
    description: 'List of users retrieved successfully',
    type: [WorkspaceUser] // Gibt ein Array vom Typ WorkspaceUser zurück
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found or no users available'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findUsers(
    @Param('workspace_id') workspaceId: number
  ): Promise<WorkspaceUser[]> {
    try {
      const users = await this.workspaceService.findUsers(workspaceId);
      if (!users || users.length === 0) {
        throw new BadRequestException(
          `No users found for workspace ID ${workspaceId}`
        );
      }
      return users;
    } catch (error) {
      console.error(`Error retrieving users for workspace ${workspaceId}`, error);
      throw new BadRequestException(
        `Failed to retrieve users for workspace ${workspaceId}. Please try again later.`
      );
    }
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
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiTags('workspace')
  async addTestFiles(
    @Param('workspace_id') workspaceId: number,
      @UploadedFiles() files: Express.Multer.File[]
  ): Promise<boolean> {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file must be uploaded.');
    }

    try {
      return await this.workspaceService.uploadTestFiles(workspaceId, files);
    } catch (error) {
      console.error('Error uploading test files:', error);
      throw new BadRequestException('Failed to upload test files. Please try again.');
    }
  }

  @Post(':workspace_id/upload/results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard) // Securing the endpoint with JWT and workspace-specific guards
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace to which test results should be uploaded.'
  })
  @UseInterceptors(FilesInterceptor('files'))
  @ApiTags('workspace')
  @ApiOkResponse({
    description: 'Test results successfully uploaded.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid request. Please check your input data.'
  })
  async addTestResults(
    @Param('workspace_id') workspace_id: number,
      @UploadedFiles() files: Express.Multer.File[]
  ): Promise<boolean> {
    if (!workspace_id || Number.isNaN(workspace_id)) {
      throw new BadRequestException('Invalid workspace_id.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files were uploaded.');
    }

    try {
      return await this.uploadResults.uploadTestResults(workspace_id, files);
    } catch (error) {
      console.error('Error uploading test results:', error.message);
      throw new BadRequestException('Uploading test results failed. Please try again.');
    }
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
