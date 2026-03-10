import {
  Inject,
  Injectable,
  Logger,
  forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValidationTask } from '../../entities/validation-task.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  JobQueueService
} from '../../../job-queue/job-queue.service';

@Injectable()
export class ValidationTaskService {
  private readonly logger = new Logger(ValidationTaskService.name);

  constructor(
    @InjectRepository(ValidationTask)
    private taskRepository: Repository<ValidationTask>,
    private validationService: WorkspaceFilesService,
    @Inject(forwardRef(() => JobQueueService))
    private readonly jobQueueService: JobQueueService
  ) { }

  async createValidationTask(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses',
    page?: number,
    limit?: number,
    additionalData?: Record<string, unknown>
  ): Promise<ValidationTask> {
    const task = this.taskRepository.create({
      workspace_id: workspaceId,
      validation_type: validationType,
      page: page,
      limit: limit,
      status: 'pending',
      progress: 0,
      result: additionalData ? JSON.stringify(additionalData) : undefined
    });

    const savedTask = await this.taskRepository.save(task);
    this.logger.log(`Created validation task with ID ${savedTask.id}`);

    try {
      await this.jobQueueService.addValidationTaskJob({ taskId: savedTask.id });
    } catch (error) {
      savedTask.status = 'failed';
      savedTask.error = `Failed to queue validation task: ${error.message}`;
      await this.taskRepository.save(savedTask);
      throw error;
    }

    return savedTask;
  }

  async getValidationTask(taskId: number, workspaceId?: number): Promise<ValidationTask> {
    const whereClause: { id: number; workspace_id?: number } = { id: taskId };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const task = await this.taskRepository.findOne({ where: whereClause });
    if (!task) {
      if (workspaceId !== undefined) {
        throw new Error(`Task with ID ${taskId} not found in workspace ${workspaceId}`);
      } else {
        throw new Error(`Task with ID ${taskId} not found`);
      }
    }
    return task;
  }

  async getValidationTasks(workspaceId: number): Promise<ValidationTask[]> {
    return this.taskRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' }
    });
  }

  async getValidationResults(taskId: number, workspaceId?: number): Promise<unknown> {
    const task = await this.getValidationTask(taskId, workspaceId);

    if (task.status !== 'completed') {
      throw new Error(`Task with ID ${taskId} is not completed (status: ${task.status})`);
    }

    if (!task.result) {
      throw new Error(`Task with ID ${taskId} has no results`);
    }

    try {
      return JSON.parse(task.result);
    } catch (error) {
      this.logger.error(`Error parsing results for task ${taskId}: ${error.message}`, error.stack);
      throw new Error(`Error parsing results for task ${taskId}`);
    }
  }

  async processValidationTask(taskId: number): Promise<void> {
    try {
      const task = await this.getValidationTask(taskId);

      task.status = 'processing';
      task.progress = 10;
      await this.taskRepository.save(task);

      let result: unknown;
      let taskData: Record<string, unknown> | null = null;

      if (task.result) {
        try {
          taskData = JSON.parse(task.result);
        } catch (error) {
          this.logger.error(`Error parsing task data for task ${taskId}: ${error.message}`, error.stack);
        }
      }

      switch (task.validation_type) {
        case 'variables':
          result = await this.validationService.validateVariables(
            task.workspace_id,
            task.page || 1,
            task.limit || 10
          );
          break;
        case 'variableTypes':
          result = await this.validationService.validateVariableTypes(
            task.workspace_id,
            task.page || 1,
            task.limit || 10
          );
          break;
        case 'responseStatus':
          result = await this.validationService.validateResponseStatus(
            task.workspace_id,
            task.page || 1,
            task.limit || 10
          );
          break;
        case 'duplicateResponses':
          result = await this.validationService.validateDuplicateResponses(
            task.workspace_id,
            task.page || 1,
            task.limit || 10
          );
          break;
        case 'testTakers':
          result = await this.validationService.validateTestTakers(task.workspace_id);
          break;
        case 'groupResponses':
          result = await this.validationService.validateGroupResponses(
            task.workspace_id,
            task.page || 1,
            task.limit || 10
          );
          break;
        case 'deleteResponses':
          if (taskData && Array.isArray(taskData.responseIds)) {
            const responseIds = taskData.responseIds as number[];
            const deletedCount = await this.validationService.deleteInvalidResponses(
              task.workspace_id,
              responseIds
            );
            result = { deletedCount };
          } else {
            throw new Error('No response IDs provided for deletion');
          }
          break;
        case 'deleteAllResponses':
          if (taskData && typeof taskData.validationType === 'string') {
            const validationType = taskData.validationType as 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses';
            const deletedCount = await this.validationService.deleteAllInvalidResponses(
              task.workspace_id,
              validationType
            );
            result = { deletedCount };
          } else {
            throw new Error('No validation type provided for deletion');
          }
          break;
        default:
          throw new Error(`Unknown validation type: ${task.validation_type}`);
      }

      task.result = JSON.stringify(result);
      task.status = 'completed';
      task.progress = 100;
      await this.taskRepository.save(task);

      this.logger.log(`Completed validation task with ID ${taskId}`);
    } catch (error) {
      try {
        const task = await this.getValidationTask(taskId);
        task.error = error.message;
        task.status = 'failed';
        task.progress = 100;
        await this.taskRepository.save(task);
      } catch (innerError) {
        this.logger.error(`Failed to update task ${taskId} with error: ${innerError.message}`, innerError.stack);
      }
      this.logger.error(`Failed to process task ${taskId}: ${error.message}`, error.stack);
    }
  }
}
