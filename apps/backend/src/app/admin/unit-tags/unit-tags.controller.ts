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
import { UnitTagDto } from '../../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../api-dto/unit-tags/update-unit-tag.dto';

@ApiTags('Unit Tags')
@Controller('admin/workspace/:workspace_id/unit-tags')
export class UnitTagsController {
  constructor(private readonly workspacesAdminFacade: WorkspacesAdminFacade) {}

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
      @Body() createUnitTagDto: CreateUnitTagDto
  ): Promise<UnitTagDto> {
    try {
      return await this.workspacesAdminFacade.createUnitTag(createUnitTagDto);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create tag: ${error.message}`);
    }
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
      @Param('unitId') unitId: number
  ): Promise<UnitTagDto[]> {
    try {
      return await this.workspacesAdminFacade.findAllUnitTags(unitId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve tags: ${error.message}`);
    }
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
      @Param('id') id: number
  ): Promise<UnitTagDto> {
    try {
      return await this.workspacesAdminFacade.findOneUnitTag(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve tag: ${error.message}`);
    }
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
      @Param('id') id: number,
      @Body() updateUnitTagDto: UpdateUnitTagDto
  ): Promise<UnitTagDto> {
    try {
      return await this.workspacesAdminFacade.updateUnitTag(id, updateUnitTagDto);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update tag: ${error.message}`);
    }
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
      @Param('id') id: number
  ): Promise<boolean> {
    try {
      return await this.workspacesAdminFacade.removeUnitTag(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to delete tag: ${error.message}`);
    }
  }
}
