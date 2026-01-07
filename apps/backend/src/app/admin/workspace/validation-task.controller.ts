import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  ParseIntPipe,
  Logger
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery
} from '@nestjs/swagger';
import { WorkspacesAdminFacade } from '../../workspaces/services/workspaces-admin-facade.service';
import { ValidationTaskDto } from './dto/validation-task.dto';
import { WorkspaceId } from './workspace.decorator';

@ApiTags('Validation Tasks')
@Controller('admin/workspace/:workspace_id/validation-tasks')
export class ValidationTaskController {
  private readonly logger = new Logger(ValidationTaskController.name);

  constructor(private readonly workspacesAdminFacade: WorkspacesAdminFacade) {}

  @Post()
  @ApiOperation({ summary: 'Create a new validation task' })
  @ApiParam({ name: 'workspace_id', description: 'Workspace ID' })
  @ApiQuery({ name: 'type', description: 'Validation type', required: true })
  @ApiQuery({ name: 'page', description: 'Page number', required: false })
  @ApiQuery({ name: 'limit', description: 'Page size', required: false })
  async createValidationTask(
    @WorkspaceId() workspaceId: number,
      @Query('type') type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses',
      @Query('page') page?: number,
      @Query('limit') limit?: number,
      @Query() allQueryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<ValidationTaskDto> {
    this.logger.log(`Creating validation task of type ${type} for workspace ${workspaceId}`);

    // Extract additional data from query parameters
    const additionalData: Record<string, unknown> = {};
    if (allQueryParams) {
      // Copy all query parameters except type, page, and limit
      Object.entries(allQueryParams).forEach(([key, value]) => {
        if (key !== 'type' && key !== 'page' && key !== 'limit') {
          additionalData[key] = value;
        }
      });
    }

    const task = await this.workspacesAdminFacade.createValidationTask(
      workspaceId,
      type,
      page,
      limit,
      Object.keys(additionalData).length > 0 ? additionalData : undefined
    );
    return ValidationTaskDto.fromEntity(task);
  }

  @Get()
  @ApiOperation({ summary: 'Get all validation tasks for a workspace' })
  @ApiParam({ name: 'workspace_id', description: 'Workspace ID' })
  async getValidationTasks(
    @WorkspaceId() workspaceId: number
  ): Promise<ValidationTaskDto[]> {
    const tasks = await this.workspacesAdminFacade.getValidationTasks(workspaceId);
    return tasks.map(task => ValidationTaskDto.fromEntity(task));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a validation task by ID' })
  @ApiParam({ name: 'workspace_id', description: 'Workspace ID' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  async getValidationTask(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) taskId: number
  ): Promise<ValidationTaskDto> {
    const task = await this.workspacesAdminFacade.getValidationTask(taskId, workspaceId);
    return ValidationTaskDto.fromEntity(task);
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Get the results of a validation task' })
  @ApiParam({ name: 'workspace_id', description: 'Workspace ID' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  async getValidationResults(
    @WorkspaceId() workspaceId: number,
      @Param('id', ParseIntPipe) taskId: number
  ): Promise<unknown> {
    return this.workspacesAdminFacade.getValidationResults(taskId, workspaceId);
  }
}
