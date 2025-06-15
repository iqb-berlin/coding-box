import {
  Controller,
  Get, Param, UseGuards
} from '@nestjs/common';
import {
  ApiParam, ApiTags
} from '@nestjs/swagger';
import { WorkspaceService } from '../../database/services/workspace.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import FileUpload from '../../database/entities/file_upload.entity';

@ApiTags('Admin Workspace Player')
@Controller('admin/workspace')
export class WorkspacePlayerController {
  constructor(
    private workspaceService: WorkspaceService
  ) {}

  @Get(':workspace_id/player/:playerName')
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findPlayer(@Param('workspace_id') workspace_id: number,
    @Param('playerName') playerName:string): Promise<FilesDto[]> {
    return this.workspaceService.findPlayer(Number(workspace_id), playerName);
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
  async findTestPersons(@WorkspaceId() id: number): Promise<number[]> {
    return this.workspaceService.findTestPersons(id);
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
}
