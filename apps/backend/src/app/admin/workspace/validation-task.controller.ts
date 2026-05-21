import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Get,
  Param,
  Query,
  ParseIntPipe,
  Logger,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery
} from '@nestjs/swagger';
import { ValidationTaskService } from '../../database/services/validation';
import { ValidationTaskDto } from './dto/validation-task.dto';
import { CreateValidationTaskRequestDto } from './dto/create-validation-task-request.dto';
import { WorkspaceId } from './workspace.decorator';
import { ValidationType } from '../../database/entities/validation-task.entity';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';

@ApiTags('Validation Tasks')
@ApiBearerAuth()
@Controller('admin/workspace/:workspace_id/validation-tasks')
@UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
@RequireAccessLevel(3)
export class ValidationTaskController {
  private readonly logger = new Logger(ValidationTaskController.name);

  constructor(private readonly validationTaskService: ValidationTaskService) {}

  private static readonly supportedValidationTypes: ValidationType[] = [
    'variables',
    'variableTypes',
    'responseStatus',
    'testTakers',
    'testFiles',
    'groupResponses',
    'deleteResponses',
    'deleteAllResponses',
    'deleteTestResults',
    'deleteTestLogs',
    'duplicateResponses'
  ];

  private static parseOptionalPositiveInt(
    value: string | number | boolean | undefined,
    name: string
  ): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }

    return parsed;
  }

  private static normalizeAdditionalData(
    data?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!data || Object.keys(data).length === 0) {
      return undefined;
    }

    const normalized = { ...data };
    const responseIds = normalized.responseIds;
    if (typeof responseIds === 'string') {
      normalized.responseIds = responseIds
        .split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isInteger(id) && id > 0);
    }

    return normalized;
  }

  private static getAdditionalData(
    body?: CreateValidationTaskRequestDto,
    allQueryParams?: Record<string, string | number | boolean | undefined>
  ): Record<string, unknown> | undefined {
    if (body?.additionalData) {
      return ValidationTaskController.normalizeAdditionalData(
        body.additionalData
      );
    }

    const queryAdditionalData: Record<string, unknown> = {};
    if (allQueryParams) {
      Object.entries(allQueryParams).forEach(([key, value]) => {
        if (key !== 'type' && key !== 'page' && key !== 'limit') {
          queryAdditionalData[key] = value;
        }
      });
    }

    return ValidationTaskController.normalizeAdditionalData(
      queryAdditionalData
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a new validation task' })
  @ApiParam({ name: 'workspace_id', description: 'Workspace ID' })
  @ApiQuery({ name: 'type', description: 'Validation type', required: true })
  @ApiQuery({ name: 'page', description: 'Page number', required: false })
  @ApiQuery({ name: 'limit', description: 'Page size', required: false })
  async createValidationTask(
    @WorkspaceId() workspaceId: number,
      @Query('type') type: ValidationType,
      @Query('page') page?: string,
      @Query('limit') limit?: string,
      @Query() allQueryParams?: Record<string, string | number | boolean | undefined>,
      @Body() body?: CreateValidationTaskRequestDto
  ): Promise<ValidationTaskDto> {
    this.logger.log(`Creating validation task of type ${type} for workspace ${workspaceId}`);

    if (
      !type ||
      !ValidationTaskController.supportedValidationTypes.includes(type)
    ) {
      throw new BadRequestException(`Unsupported validation type: ${type}`);
    }

    const task = await this.validationTaskService.createValidationTask(
      workspaceId,
      type,
      ValidationTaskController.parseOptionalPositiveInt(page, 'page'),
      ValidationTaskController.parseOptionalPositiveInt(limit, 'limit'),
      ValidationTaskController.getAdditionalData(body, allQueryParams)
    );
    return ValidationTaskDto.fromEntity(task);
  }

  @Get()
  @ApiOperation({ summary: 'Get all validation tasks for a workspace' })
  @ApiParam({ name: 'workspace_id', description: 'Workspace ID' })
  async getValidationTasks(
    @WorkspaceId() workspaceId: number
  ): Promise<ValidationTaskDto[]> {
    const tasks = await this.validationTaskService.getValidationTasks(workspaceId);
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
    const task = await this.validationTaskService.getValidationTask(taskId, workspaceId);
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
    return this.validationTaskService.getValidationResults(taskId, workspaceId);
  }
}
