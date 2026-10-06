import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { JsonSchemaValidationPipe } from '../../http/json-schema-validation.pipe';
import { requestBodySchemas } from '../../http/request-body.schemas';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { WorkspaceId } from '../workspace/workspace.decorator';
import { UnitTagService } from '../../database/services/workspace';
import { UnitTagDto } from '../../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../api-dto/unit-tags/update-unit-tag.dto';

@ApiTags('Unit Tags')
@Controller('admin/workspace/:workspace_id/unit-tags')
export class UnitTagsController {
  constructor(private readonly unitTagService: UnitTagService) {}

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new unit tag',
    description: 'Creates a new tag for a unit'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiCreatedResponse({
    description: 'The tag has been successfully created.',
    type: UnitTagDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Unit not found.'
  })
  async create(
    @WorkspaceId() workspaceId: number,
      @Body(new JsonSchemaValidationPipe(requestBodySchemas.CreateUnitTagDto)) createUnitTagDto: CreateUnitTagDto
  ): Promise<UnitTagDto> {
    return this.unitTagService.create(workspaceId, createUnitTagDto);
  }

  @Get('unit/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all tags for a unit',
    description: 'Retrieves all tags for a specific unit'
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
    description: 'The tags have been successfully retrieved.',
    type: [UnitTagDto]
  })
  @ApiNotFoundResponse({
    description: 'Unit not found.'
  })
  async findAllByUnitId(
    @WorkspaceId() workspaceId: number,
      @Param('unitId', ParseIntPipe) unitId: number
  ): Promise<UnitTagDto[]> {
    return this.unitTagService.findAllByUnitId(workspaceId, unitId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a tag by ID',
    description: 'Retrieves a tag by its ID'
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
    description: 'The ID of the tag'
  })
  @ApiOkResponse({
    description: 'The tag has been successfully retrieved.',
    type: UnitTagDto
  })
  @ApiNotFoundResponse({
    description: 'Tag not found.'
  })
  async findOne(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<UnitTagDto> {
    return this.unitTagService.findOne(workspaceId, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a tag',
    description: 'Updates a tag by its ID'
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
    description: 'The ID of the tag'
  })
  @ApiOkResponse({
    description: 'The tag has been successfully updated.',
    type: UnitTagDto
  })
  @ApiNotFoundResponse({
    description: 'Tag not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async update(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number,
      @Body(new JsonSchemaValidationPipe(requestBodySchemas.UpdateUnitTagDto)) updateUnitTagDto: UpdateUnitTagDto
  ): Promise<UnitTagDto> {
    return this.unitTagService.update(workspaceId, id, updateUnitTagDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a tag',
    description: 'Deletes a tag by its ID'
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
    description: 'The ID of the tag'
  })
  @ApiOkResponse({
    description: 'The tag has been successfully deleted.',
    type: Boolean
  })
  @ApiNotFoundResponse({
    description: 'Tag not found.'
  })
  async remove(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<boolean> {
    return this.unitTagService.remove(workspaceId, id);
  }
}
