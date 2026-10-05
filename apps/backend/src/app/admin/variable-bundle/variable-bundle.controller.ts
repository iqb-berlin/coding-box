import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
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
import { VariableBundleService } from '../../database/services/coding';
import { VariableBundleDto } from './dto/variable-bundle.dto';
import { CreateVariableBundleDto } from './dto/create-variable-bundle.dto';
import { UpdateVariableBundleDto } from './dto/update-variable-bundle.dto';
import { VariableDto } from './dto/variable.dto';

@ApiTags('Variablenbündel')
@Controller('admin/workspace/:workspace_id/variable-bundle')
export class VariableBundleController {
  constructor(private readonly variableBundleService: VariableBundleService) {}

  @Get()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get variable bundles for a workspace with pagination',
    description: 'Retrieves variable bundles for a workspace with pagination support'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiOkResponse({
    description: 'The variable bundles have been successfully retrieved.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/VariableBundleDto' }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found.'
  })
  async getVariableBundles(
    @WorkspaceId() workspaceId: number,
      @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
      @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number
  ): Promise<{ data: VariableBundleDto[]; total: number; page: number; limit: number }> {
    const result = await this.variableBundleService.getVariableBundles(workspaceId, page, limit);
    return {
      data: result.data.map(bundle => VariableBundleDto.fromEntity(bundle)),
      total: result.total,
      page: result.page,
      limit: result.limit
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a variable bundle by ID',
    description: 'Retrieves a variable bundle by ID'
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
    description: 'The ID of the variable bundle'
  })
  @ApiOkResponse({
    description: 'The variable bundle has been successfully retrieved.',
    type: VariableBundleDto
  })
  @ApiNotFoundResponse({
    description: 'Variable bundle not found.'
  })
  async getVariableBundle(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number
  ): Promise<VariableBundleDto> {
    const variableBundle = await this.variableBundleService.getVariableBundle(id, workspaceId);
    return VariableBundleDto.fromEntity(variableBundle);
  }

  @Post()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new variable bundle',
    description: 'Creates a new variable bundle'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    required: true,
    description: 'The ID of the workspace'
  })
  @ApiCreatedResponse({
    description: 'The variable bundle has been successfully created.',
    type: VariableBundleDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async createVariableBundle(
    @WorkspaceId() workspaceId: number,
      @Body() createVariableBundleDto: CreateVariableBundleDto
  ): Promise<VariableBundleDto> {
    const variableBundle = await this.variableBundleService.createVariableBundle(
      workspaceId,
      createVariableBundleDto
    );
    return VariableBundleDto.fromEntity(variableBundle);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a variable bundle',
    description: 'Updates a variable bundle'
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
    description: 'The ID of the variable bundle'
  })
  @ApiOkResponse({
    description: 'The variable bundle has been successfully updated.',
    type: VariableBundleDto
  })
  @ApiNotFoundResponse({
    description: 'Variable bundle not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async updateVariableBundle(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number,
      @Body() updateVariableBundleDto: UpdateVariableBundleDto
  ): Promise<VariableBundleDto> {
    const variableBundle = await this.variableBundleService.updateVariableBundle(
      id,
      workspaceId,
      updateVariableBundleDto
    );
    return VariableBundleDto.fromEntity(variableBundle);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a variable bundle',
    description: 'Deletes a variable bundle'
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
    description: 'The ID of the variable bundle'
  })
  @ApiOkResponse({
    description: 'The variable bundle has been successfully deleted.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Variable bundle not found.'
  })
  async deleteVariableBundle(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number
  ): Promise<{ success: boolean }> {
    return this.variableBundleService.deleteVariableBundle(id, workspaceId);
  }

  @Post(':id/variables')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add a variable to a variable bundle',
    description: 'Adds a variable to a variable bundle'
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
    description: 'The ID of the variable bundle'
  })
  @ApiOkResponse({
    description: 'The variable has been successfully added to the variable bundle.',
    type: VariableBundleDto
  })
  @ApiNotFoundResponse({
    description: 'Variable bundle not found.'
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data.'
  })
  async addVariableToBundle(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number,
      @Body() variable: VariableDto
  ): Promise<VariableBundleDto> {
    const variableBundle = await this.variableBundleService.addVariableToBundle(
      id,
      workspaceId,
      variable
    );
    return VariableBundleDto.fromEntity(variableBundle);
  }

  @Delete(':id/variables/:unitName/:variableId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove a variable from a variable bundle',
    description: 'Removes a variable from a variable bundle'
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
    description: 'The ID of the variable bundle'
  })
  @ApiParam({
    name: 'unitName',
    type: String,
    required: true,
    description: 'The unit name of the variable'
  })
  @ApiParam({
    name: 'variableId',
    type: String,
    required: true,
    description: 'The variable ID'
  })
  @ApiOkResponse({
    description: 'The variable has been successfully removed from the variable bundle.',
    type: VariableBundleDto
  })
  @ApiNotFoundResponse({
    description: 'Variable bundle not found.'
  })
  async removeVariableFromBundle(
    @WorkspaceId() workspaceId: number,
      @Param('id') id: number,
      @Param('unitName') unitName: string,
      @Param('variableId') variableId: string
  ): Promise<VariableBundleDto> {
    const variableBundle = await this.variableBundleService.removeVariableFromBundle(
      id,
      workspaceId,
      unitName,
      variableId
    );
    return VariableBundleDto.fromEntity(variableBundle);
  }
}
