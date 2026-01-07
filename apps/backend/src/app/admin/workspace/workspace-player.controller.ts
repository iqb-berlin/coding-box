import {
  Controller, Get, Param, UseGuards
} from '@nestjs/common';
import {
  ApiOperation, ApiParam, ApiResponse, ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { FileUpload, ResponseEntity } from '../../common';
import { WorkspacesAdminFacade } from '../../workspaces/services/workspaces-admin-facade.service';
import { BookletUnit } from '../../workspaces/services/workspace-player.service';

@ApiTags('Admin Workspace Player')
@Controller('admin/workspace')
export class WorkspacePlayerController {
  constructor(private workspacesAdminFacade: WorkspacesAdminFacade) {}

  @Get(':workspace_id/player/:playerName')
  @ApiParam({ name: 'workspace_id', type: Number })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async findPlayer(
    @WorkspaceId() workspaceId: number,
      @Param('playerName') playerName: string
  ): Promise<FilesDto[]> {
    return this.workspacesAdminFacade.findPlayer(workspaceId, playerName);
  }

  @Get(':workspace_id/units/:testPerson')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersonUnits(
    @WorkspaceId() id: number,
      @Param('testPerson') testPerson: string
  ): Promise<ResponseEntity[]> {
    return this.workspacesAdminFacade.findTestPersonUnits(id, testPerson);
  }

  @Get(':workspace_id/test-groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findTestPersons(@WorkspaceId() id: number): Promise<number[]> {
    return this.workspacesAdminFacade.findTestPersons(id);
  }

  @Get(':workspace_id/:unit/unitDef')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findUnitDef(
    @Param('workspace_id') workspace_id: number,
      @Param('unit') unit: string
  ): Promise<FilesDto[]> {
    const unitIdToUpperCase = unit.toUpperCase();
    return this.workspacesAdminFacade.findUnitDef(
      workspace_id,
      unitIdToUpperCase
    );
  }

  @Get(':workspace_id/unit/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async findUnit(
    @WorkspaceId() id: number,
      @Param('unitId') unitId: string
  ): Promise<FileUpload[]> {
    const unitIdToUpperCase = unitId.toUpperCase();
    return this.workspacesAdminFacade.findUnit(id, unitIdToUpperCase);
  }

  @Get(':workspace_id/booklet/:bookletId/units')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'bookletId', type: String })
  @ApiOperation({ summary: 'Get units from a booklet in order' })
  @ApiResponse({
    status: 200,
    description:
      'Returns an array of units from the booklet in the correct order'
  })
  async getBookletUnits(
    @WorkspaceId() workspaceId: number,
      @Param('bookletId') bookletId: string
  ): Promise<BookletUnit[]> {
    return this.workspacesAdminFacade.getBookletUnits(workspaceId, bookletId);
  }
}
