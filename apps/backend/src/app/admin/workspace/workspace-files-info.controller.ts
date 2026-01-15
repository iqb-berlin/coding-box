import {
  BadRequestException,
  Controller,
  Get,
  Param,
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
import { WorkspaceFilesService } from '../../database/services/workspace-files.service';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';

@ApiTags('Admin Workspace Files - Info')
@Controller('admin/workspace')
export class WorkspaceFilesInfoController {
  constructor(
    private readonly workspaceFilesService: WorkspaceFilesService
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
                codingSchemeRef: { type: 'string' }
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
}
