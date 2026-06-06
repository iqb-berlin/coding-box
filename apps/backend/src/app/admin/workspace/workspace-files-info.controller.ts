import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiBadRequestResponse,
  ApiTags
} from '@nestjs/swagger';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceFilesService } from '../../database/services/workspace';
import {
  type CodingReplayAnchorOverride,
  CodingReplayAnchorService
} from '../../database/services/coding/coding-replay-anchor.service';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';

@ApiTags('Admin Workspace Files - Info')
@Controller('admin/workspace')
export class WorkspaceFilesInfoController {
  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly replayAnchorService: CodingReplayAnchorService
  ) { }

  @Get(':workspace_id/files/units-with-file-ids')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get units with file IDs',
    description:
            'Retrieves a list of units with file_type "Unit" and their file IDs'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Units with file IDs retrieved successfully'
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve units with file IDs'
  })
  async getUnitsWithFileIds(
    @Param('workspace_id') workspace_id: number
  ): Promise<{ unitId: string; fileName: string }[]> {
    return this.workspaceFilesService.getUnitsWithFileIds(workspace_id);
  }

  @Get(':workspace_id/vocs/:vocs')
  @ApiTags('admin workspace')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get VOCS file content',
    description: 'Retrieves the content of a VOCS file by its unit name'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The unique ID of the workspace'
  })
  @ApiParam({
    name: 'vocs',
    type: String,
    required: true,
    description: 'The unit name/ID for which to get the VOCS file'
  })
  @ApiOkResponse({
    description: 'VOCS file content retrieved successfully',
    type: [FilesDto]
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getVocs(
    @Param('workspace_id') workspace_id: number,
      @Param('vocs') vocs: string
  ): Promise<FilesDto[]> {
    return this.workspaceFilesService.getVocs(workspace_id, vocs);
  }

  @Get(':workspace_id/files/unit-variables')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get unit variables with details',
    description:
            'Retrieves detailed information about all units and their variables from Unit XML files, including types and coding scheme references. Units with no variables are excluded.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Unit variables details retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string' },
          unitId: { type: 'string' },
          variables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                alias: { type: 'string' },
                type: { type: 'string' },
                hasCodingScheme: { type: 'boolean' },
                codingSchemeRef: { type: 'string' },
                isDerived: { type: 'boolean' }
              }
            }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve unit variables details'
  })
  async getUnitVariables(
    @Param('workspace_id') workspace_id: number
  ): Promise<UnitVariableDetailsDto[]> {
    if (!workspace_id) {
      throw new BadRequestException('Workspace ID is required.');
    }

    return this.workspaceFilesService.getUnitVariableDetails(workspace_id);
  }

  @Get(':workspace_id/files/replay-anchor-overrides')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get replay anchor overrides',
    description: 'Retrieves workspace-specific replay anchor overrides for unit variables.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Replay anchor overrides retrieved successfully'
  })
  async getReplayAnchorOverrides(
    @Param('workspace_id') workspace_id: number
  ): Promise<CodingReplayAnchorOverride[]> {
    if (!workspace_id) {
      throw new BadRequestException('Workspace ID is required.');
    }

    return this.replayAnchorService.getOverrides(workspace_id);
  }

  @Put(':workspace_id/files/replay-anchor-overrides')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Set replay anchor override',
    description: 'Creates or updates a workspace-specific replay anchor override for a unit variable.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Replay anchor override saved successfully'
  })
  async saveReplayAnchorOverride(
    @Param('workspace_id') workspace_id: number,
      @Body() override: CodingReplayAnchorOverride
  ): Promise<CodingReplayAnchorOverride> {
    if (!workspace_id) {
      throw new BadRequestException('Workspace ID is required.');
    }

    try {
      return await this.replayAnchorService.upsertOverride(workspace_id, override);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Delete(':workspace_id/files/replay-anchor-overrides')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Delete replay anchor override',
    description: 'Deletes a workspace-specific replay anchor override for a unit variable.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Replay anchor override deleted successfully'
  })
  async deleteReplayAnchorOverride(
    @Param('workspace_id') workspace_id: number,
      @Query('unitName') unitName: string,
      @Query('variableId') variableId: string
  ): Promise<{ deleted: boolean }> {
    if (!workspace_id) {
      throw new BadRequestException('Workspace ID is required.');
    }
    if (!unitName || !variableId) {
      throw new BadRequestException('unitName and variableId are required.');
    }

    return this.replayAnchorService.deleteOverride(workspace_id, unitName, variableId);
  }

  @Get(':workspace_id/files/variable-info/:scheme_file_id')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get variable info for scheme',
    description:
            'Retrieves variable information from Unit files for a specific scheme file ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'scheme_file_id',
    type: String,
    description: 'ID of the scheme file'
  })
  @ApiOkResponse({
    description: 'Variable information retrieved successfully'
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve variable information'
  })
  async getVariableInfoForScheme(
    @Param('workspace_id') workspace_id: number,
      @Param('scheme_file_id') scheme_file_id: string
  ): Promise<VariableInfo[]> {
    return this.workspaceFilesService.getVariableInfoForScheme(
      workspace_id,
      scheme_file_id
    );
  }

  @Get(':workspace_id/files/item-ids')
  @ApiTags('admin workspace')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiOperation({
    summary: 'Get item IDs from metadata files',
    description: 'Retrieves a list of item IDs extracted from .vomd metadata files in the workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Item IDs retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          id: { type: 'number' },
          items: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Failed to retrieve item IDs'
  })
  async getItemIdsFromMetadataFiles(
    @Param('workspace_id') workspace_id: number
  ): Promise<{ fileId: string; id: number; items: string[] }[]> {
    if (!workspace_id) {
      throw new BadRequestException('Workspace ID is required.');
    }
    return this.workspaceFilesService.getItemIdsFromMetadataFiles(workspace_id);
  }
}
