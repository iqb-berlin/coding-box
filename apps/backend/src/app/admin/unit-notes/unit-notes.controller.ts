import {
  Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags
} from '@nestjs/swagger';
import { ValidatedBody } from '../../http/validated-body.decorator';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { UnitNoteService } from '../../database/services/workspace';
import { UnitNoteDto } from '../../../../../../api-dto/unit-notes/unit-note.dto';

@ApiTags('Unit Notes')
@Controller('admin/workspace/:workspace_id/unit-notes')
export class UnitNotesController {
  constructor(private readonly unitNoteService: UnitNoteService) {}

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
      @ValidatedBody('CreateUnitNoteDto') createUnitNoteDto: RequestBody<'CreateUnitNoteDto'>
  ): Promise<UnitNoteDto> {
    return this.unitNoteService.create(workspaceId, createUnitNoteDto);
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
      @Param('unitId', ParseIntPipe) unitId: number
  ): Promise<UnitNoteDto[]> {
    return this.unitNoteService.findAllByUnitId(workspaceId, unitId);
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
      @ValidatedBody('UnitNotesController_findAllByUnitIds') { unitIds }: RequestBody<'UnitNotesController_findAllByUnitIds'>
  ): Promise<{ [unitId: number]: UnitNoteDto[] }> {
    return this.unitNoteService.findAllByUnitIds(workspaceId, unitIds);
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
      @Param('id', ParseIntPipe) id: number
  ): Promise<UnitNoteDto> {
    return this.unitNoteService.findOne(workspaceId, id);
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
      @Param('id', ParseIntPipe) id: number,
      @ValidatedBody('UpdateUnitNoteDto') updateUnitNoteDto: RequestBody<'UpdateUnitNoteDto'>
  ): Promise<UnitNoteDto> {
    return this.unitNoteService.update(workspaceId, id, updateUnitNoteDto);
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
      @Param('id', ParseIntPipe) id: number
  ): Promise<boolean> {
    return this.unitNoteService.remove(workspaceId, id);
  }
}
