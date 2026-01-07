import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { WorkspacesAdminFacade } from '../../workspaces/services/workspaces-admin-facade.service';
import { UnitNoteDto } from '../../../../../../api-dto/unit-notes/unit-note.dto';
import { CreateUnitNoteDto } from '../../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UpdateUnitNoteDto } from '../../../../../../api-dto/unit-notes/update-unit-note.dto';

@ApiTags('Unit Notes')
@Controller('admin/workspace/:workspace_id/unit-notes')
export class UnitNotesController {
  constructor(private readonly workspacesAdminFacade: WorkspacesAdminFacade) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new unit note',
    description: 'Creates a new note for a unit'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiCreatedResponse({
    description: 'The note has been successfully created.',
    type: UnitNoteDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Unit not found.'
  })
  async create(
    @WorkspaceId() workspaceId: number,
      @Body() createUnitNoteDto: CreateUnitNoteDto
  ): Promise<UnitNoteDto> {
    try {
      return await this.workspacesAdminFacade.createUnitNote(createUnitNoteDto);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create note: ${error.message}`);
    }
  }

  @Get('unit/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all notes for a unit',
    description: 'Retrieves all notes for a specific unit'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'unitId',
    type: Number,
    required: true,
    description: 'The ID of the unit'
  })
  @ApiOkResponse({
    description: 'The notes have been successfully retrieved.',
    type: [UnitNoteDto]
  })
  @ApiNotFoundResponse({
    description: 'Unit not found.'
  })
  async findAllByUnitId(
    @WorkspaceId() workspaceId: number,
      @Param('unitId') unitId: number
  ): Promise<UnitNoteDto[]> {
    try {
      return await this.workspacesAdminFacade.findAllUnitNotes(unitId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve notes: ${error.message}`);
    }
  }

  @Post('units/notes')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all notes for multiple units',
    description: 'Retrieves all notes for the specified units'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiOkResponse({
    description: 'The notes have been successfully retrieved.',
    type: Object
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async findAllByUnitIds(
    @WorkspaceId() workspaceId: number,
      @Body() { unitIds }: { unitIds: number[] }
  ): Promise<{ [unitId: number]: UnitNoteDto[] }> {
    try {
      return await this.workspacesAdminFacade.findAllUnitNotesByUnitIds(unitIds);
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve notes: ${error.message}`);
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a note by ID',
    description: 'Retrieves a note by its ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the note'
  })
  @ApiOkResponse({
    description: 'The note has been successfully retrieved.',
    type: UnitNoteDto
  })
  @ApiNotFoundResponse({
    description: 'Note not found.'
  })
  async findOne(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number
  ): Promise<UnitNoteDto> {
    try {
      return await this.workspacesAdminFacade.findOneUnitNote(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve note: ${error.message}`);
    }
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a note',
    description: 'Updates a note by its ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the note'
  })
  @ApiOkResponse({
    description: 'The note has been successfully updated.',
    type: UnitNoteDto
  })
  @ApiNotFoundResponse({
    description: 'Note not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async update(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number,
      @Body() updateUnitNoteDto: UpdateUnitNoteDto
  ): Promise<UnitNoteDto> {
    try {
      return await this.workspacesAdminFacade.updateUnitNote(id, updateUnitNoteDto);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update note: ${error.message}`);
    }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a note',
    description: 'Deletes a note by its ID'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The ID of the note'
  })
  @ApiOkResponse({
    description: 'The note has been successfully deleted.',
    type: Boolean
  })
  @ApiNotFoundResponse({
    description: 'Note not found.'
  })
  async remove(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number
  ): Promise<boolean> {
    try {
      return await this.workspacesAdminFacade.removeUnitNote(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to delete note: ${error.message}`);
    }
  }
}
