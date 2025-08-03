import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { VariableBundleService } from '../../database/services/variable-bundle.service';
import { VariableBundleGroupService } from '../../database/services/variable-bundle-group.service';
import { Variable } from '../../database/entities/variable.entity';
import { VariableBundle } from '../../database/entities/variable-bundle.entity';

@ApiTags('Admin Workspace Variable Bundles')
@Controller('admin/workspace')
export class VariableBundleController {
  constructor(
    private variableBundleService: VariableBundleService,
    private variableBundleGroupService: VariableBundleGroupService
  ) {}

  // Variable Bundle endpoints

  @Post(':workspace_id/variable-bundles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a variable bundle', description: 'Creates a new variable bundle in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['unitName', 'variableId'],
      properties: {
        unitName: { type: 'string', description: 'Name of the unit' },
        variableId: { type: 'string', description: 'ID of the variable' }
      }
    }
  })
  @ApiCreatedResponse({ description: 'Variable bundle created successfully', type: Variable })
  @ApiBadRequestResponse({ description: 'Invalid input parameters' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async createVariableBundle(
    @Param('workspace_id') workspaceId: number,
    @Body() body: {
      unitName: string;
      variableId: string;
    }
  ): Promise<Variable> {
    if (!body.unitName || !body.variableId) {
      throw new BadRequestException('Unit name and variable ID are required');
    }

    return this.variableBundleService.createVariableBundle(
      workspaceId,
      body.unitName,
      body.variableId
    );
  }

  @Get(':workspace_id/variable-bundles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get variable bundles', description: 'Gets all variable bundles in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number for pagination', type: Number })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of items per page', type: Number })
  @ApiOkResponse({
    description: 'Variable bundles retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/Variable' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getVariableBundles(
    @Param('workspace_id') workspaceId: number,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20
  ): Promise<{ data: Variable[]; total: number; page: number; limit: number }> {
    const [bundles, total] = await this.variableBundleService.getVariableBundles(workspaceId, { page, limit });
    return {
      data: bundles,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/variable-bundles/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a variable bundle', description: 'Gets a variable bundle by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle' })
  @ApiOkResponse({ description: 'Variable retrieved successfully', type: Variable })
  @ApiNotFoundResponse({ description: 'Variable not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getVariableBundle(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number
  ): Promise<Variable> {
    const variableBundle = await this.variableBundleService.getVariableBundle(workspaceId, id);
    if (!variableBundle) {
      throw new NotFoundException(`Variable bundle with ID ${id} not found in workspace ${workspaceId}`);
    }
    return variableBundle;
  }

  @Delete(':workspace_id/variable-bundles/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a variable bundle', description: 'Deletes a variable bundle by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle' })
  @ApiOkResponse({ description: 'Variable bundle deleted successfully', type: Boolean })
  @ApiNotFoundResponse({ description: 'Variable bundle not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteVariableBundle(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number
  ): Promise<{ success: boolean }> {
    const success = await this.variableBundleService.deleteVariableBundle(workspaceId, id);
    if (!success) {
      throw new NotFoundException(`Variable bundle with ID ${id} not found in workspace ${workspaceId}`);
    }
    return { success };
  }

  // Variable Bundle Group endpoints

  @Post(':workspace_id/variable-bundle-groups')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a variable bundle group', description: 'Creates a new variable bundle group in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the variable bundle group' },
        description: { type: 'string', description: 'Description of the variable bundle group' },
        variableBundleIds: { type: 'array', items: { type: 'number' }, description: 'IDs of variable bundles to include' }
      }
    }
  })
  @ApiCreatedResponse({ description: 'Variable bundle created successfully', type: VariableBundle })
  @ApiBadRequestResponse({ description: 'Invalid input parameters' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async createVariableBundleGroup(
    @Param('workspace_id') workspaceId: number,
    @Body() body: {
      name: string;
      description?: string;
      variableBundleIds?: number[];
    }
  ): Promise<VariableBundle> {
    if (!body.name) {
      throw new BadRequestException('Name is required');
    }

    return this.variableBundleGroupService.createVariableBundleGroup(
      workspaceId,
      body.name,
      body.description,
      body.variableBundleIds || []
    );
  }

  @Get(':workspace_id/variable-bundle-groups')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get variable bundle groups', description: 'Gets all variable bundle groups in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number for pagination', type: Number })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of items per page', type: Number })
  @ApiOkResponse({
    description: 'Variable bundle groups retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/VariableBundle' } },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getVariableBundleGroups(
    @Param('workspace_id') workspaceId: number,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20
  ): Promise<{ data: VariableBundle[]; total: number; page: number; limit: number }> {
    const [groups, total] = await this.variableBundleGroupService.getVariableBundleGroups(workspaceId, { page, limit });
    return {
      data: groups,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/variable-bundle-groups/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a variable bundle group', description: 'Gets a variable bundle group by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle group' })
  @ApiOkResponse({ description: 'Variable bundle retrieved successfully', type: VariableBundle })
  @ApiNotFoundResponse({ description: 'Variable bundle group not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getVariableBundleGroup(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number
  ): Promise<VariableBundle> {
    const variableBundleGroup = await this.variableBundleGroupService.getVariableBundleGroup(workspaceId, id);
    if (!variableBundleGroup) {
      throw new NotFoundException(`Variable bundle group with ID ${id} not found in workspace ${workspaceId}`);
    }
    return variableBundleGroup;
  }

  @Put(':workspace_id/variable-bundle-groups/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a variable bundle group', description: 'Updates a variable bundle group by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle group' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the variable bundle group' },
        description: { type: 'string', description: 'Description of the variable bundle group' },
        variableBundleIds: { type: 'array', items: { type: 'number' }, description: 'IDs of variable bundles to include' }
      }
    }
  })
  @ApiOkResponse({ description: 'Variable bundle updated successfully', type: VariableBundle })
  @ApiNotFoundResponse({ description: 'Variable bundle group not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async updateVariableBundleGroup(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number,
    @Body() body: {
      name?: string;
      description?: string;
      variableBundleIds?: number[];
    }
  ): Promise<VariableBundle> {
    const variableBundleGroup = await this.variableBundleGroupService.updateVariableBundleGroup(
      workspaceId,
      id,
      body.name,
      body.description,
      body.variableBundleIds
    );
    if (!variableBundleGroup) {
      throw new NotFoundException(`Variable bundle group with ID ${id} not found in workspace ${workspaceId}`);
    }
    return variableBundleGroup;
  }

  @Delete(':workspace_id/variable-bundle-groups/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a variable bundle group', description: 'Deletes a variable bundle group by ID in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle group' })
  @ApiOkResponse({ description: 'Variable bundle group deleted successfully', type: Boolean })
  @ApiNotFoundResponse({ description: 'Variable bundle group not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async deleteVariableBundleGroup(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number
  ): Promise<{ success: boolean }> {
    const success = await this.variableBundleGroupService.deleteVariableBundleGroup(workspaceId, id);
    if (!success) {
      throw new NotFoundException(`Variable bundle group with ID ${id} not found in workspace ${workspaceId}`);
    }
    return { success };
  }

  @Post(':workspace_id/variable-bundle-groups/:id/variables/:variable_id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a variable bundle to a group', description: 'Adds a variable bundle to a variable bundle group in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle group' })
  @ApiParam({ name: 'variable_id', required: true, description: 'ID of the variable bundle' })
  @ApiOkResponse({ description: 'Variable added to bundle successfully', type: VariableBundle })
  @ApiNotFoundResponse({ description: 'Variable bundle group or variable bundle not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async addVariableBundleToGroup(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number,
    @Param('variable_id') variableId: number
  ): Promise<VariableBundle> {
    const variableBundleGroup = await this.variableBundleGroupService.addVariableBundleToGroup(workspaceId, id, variableId);
    if (!variableBundleGroup) {
      throw new NotFoundException(`Variable bundle group with ID ${id} or variable bundle with ID ${variableId} not found in workspace ${workspaceId}`);
    }
    return variableBundleGroup;
  }

  @Delete(':workspace_id/variable-bundle-groups/:id/variables/:variable_id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a variable bundle from a group', description: 'Removes a variable bundle from a variable bundle group in the specified workspace' })
  @ApiParam({ name: 'workspace_id', required: true, description: 'ID of the workspace' })
  @ApiParam({ name: 'id', required: true, description: 'ID of the variable bundle group' })
  @ApiParam({ name: 'variable_id', required: true, description: 'ID of the variable bundle' })
  @ApiOkResponse({ description: 'Variable removed from bundle successfully', type: VariableBundle })
  @ApiNotFoundResponse({ description: 'Variable bundle group not found' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async removeVariableBundleFromGroup(
    @Param('workspace_id') workspaceId: number,
    @Param('id') id: number,
    @Param('variable_id') variableId: number
  ): Promise<VariableBundle> {
    const variableBundleGroup = await this.variableBundleGroupService.removeVariableBundleFromGroup(workspaceId, id, variableId);
    if (!variableBundleGroup) {
      throw new NotFoundException(`Variable bundle group with ID ${id} not found in workspace ${workspaceId}`);
    }
    return variableBundleGroup;
  }
}
