import {
  Inject,
  Injectable,
  Logger,
  forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ValidationTask,
  ValidationType
} from '../../entities/validation-task.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  JobQueueService
} from '../../../job-queue/job-queue.service';
import { WorkspaceTestResultsService } from '../test-results';
import { TestResultsDeleteRequestDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

@Injectable()
export class ValidationTaskService {
  private readonly logger = new Logger(ValidationTaskService.name);

  constructor(
    @InjectRepository(ValidationTask)
    private taskRepository: Repository<ValidationTask>,
    private validationService: WorkspaceFilesService,
    private testResultsService: WorkspaceTestResultsService,
    @Inject(forwardRef(() => JobQueueService))
    private readonly jobQueueService: JobQueueService
  ) { }

  async createValidationTask(
    workspaceId: number,
    validationType: ValidationType,
    page?: number,
    limit?: number,
    additionalData?: Record<string, unknown>
  ): Promise<ValidationTask> {
    let cacheKey: string | undefined;

    if (validationType === 'testFiles') {
      cacheKey =
        await this.validationService.getTestFilesValidationCacheKey(
          workspaceId
        );

      const runningTask = await this.findRunningTestFilesValidationTask(
        workspaceId,
        cacheKey
      );
      if (runningTask) {
        this.logger.log(
          `Reusing running test files validation task ${runningTask.id} for workspace ${workspaceId}`
        );
        return runningTask;
      }

      const cachedTask = await this.findCachedTestFilesValidationTask(
        workspaceId,
        cacheKey
      );
      if (cachedTask) {
        this.logger.log(
          `Returning cached test files validation task ${cachedTask.id} for workspace ${workspaceId}`
        );
        cachedTask.progress = 100;
        cachedTask.progress_message =
          'Testdateien unverändert - letztes Validierungsergebnis wird verwendet.';
        return cachedTask;
      }
    }

    let progressMessage: string | undefined;
    if (validationType === 'testFiles') {
      progressMessage = 'Testdateien werden auf Änderungen geprüft...';
    } else if (ValidationTaskService.isDeletionTask(validationType)) {
      progressMessage = 'Löschung wird vorbereitet...';
    }

    const task = this.taskRepository.create({
      workspace_id: workspaceId,
      validation_type: validationType,
      page: page,
      limit: limit,
      status: 'pending',
      progress: 0,
      progress_message: progressMessage,
      cache_key: cacheKey,
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

  private async findRunningTestFilesValidationTask(
    workspaceId: number,
    cacheKey: string
  ): Promise<ValidationTask | null> {
    const tasks = await this.taskRepository.find({
      where: {
        workspace_id: workspaceId,
        validation_type: 'testFiles',
        cache_key: cacheKey,
        status: In(['pending', 'processing'])
      },
      order: { created_at: 'DESC' }
    });

    return tasks[0] || null;
  }

  private async findCachedTestFilesValidationTask(
    workspaceId: number,
    cacheKey: string,
    excludeTaskId?: number
  ): Promise<ValidationTask | null> {
    const tasks = await this.taskRepository.find({
      where: {
        workspace_id: workspaceId,
        validation_type: 'testFiles',
        cache_key: cacheKey,
        status: 'completed'
      },
      order: { created_at: 'DESC' }
    });

    return tasks.find(task => task.id !== excludeTaskId && !!task.result) || null;
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

  async getWorkspaceIdsForTaskIds(taskIds: number[]): Promise<Map<number, number>> {
    if (taskIds.length === 0) return new Map();
    const tasks = await this.taskRepository.find({
      where: { id: In(taskIds) },
      select: ['id', 'workspace_id']
    });
    return new Map(tasks.map(t => [t.id, t.workspace_id]));
  }

  async getValidationTasks(workspaceId: number): Promise<ValidationTask[]> {
    return this.taskRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' }
    });
  }

  private static parseResponseIds(value: unknown): number[] {
    if (Array.isArray(value)) {
      return value
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isInteger(id) && id > 0);
    }

    return [];
  }

  async getValidationResults(taskId: number, workspaceId?: number): Promise<unknown> {
    const task = await this.getValidationTask(taskId, workspaceId);

    if (task.status !== 'completed') {
      throw new Error(`Task with ID ${taskId} is not completed (status: ${task.status})`);
    }

    if (!task.result) {
      throw new Error(`Task with ID ${taskId} has no results`);
    }

    let result: unknown;
    try {
      result = JSON.parse(task.result);
    } catch (error) {
      this.logger.error(`Error parsing results for task ${taskId}: ${error.message}`, error.stack);
      throw new Error(`Error parsing results for task ${taskId}`);
    }

    if (task.validation_type !== 'testFiles') {
      return result;
    }

    const refreshedResult =
      await this.validationService.refreshTestFilesValidationResult(
        task.workspace_id,
        result
      );
    const serializedRefreshedResult = JSON.stringify(refreshedResult);
    if (serializedRefreshedResult !== task.result) {
      task.result = serializedRefreshedResult;
      await this.taskRepository.save(task);
    }

    return refreshedResult;
  }

  async processValidationTask(taskId: number): Promise<void> {
    try {
      const task = await this.getValidationTask(taskId);

      task.status = 'processing';
      task.progress = 10;
      task.progress_message = 'Validierung wird vorbereitet...';
      await this.taskRepository.save(task);

      const onProgress = async (progress: number, message?: string) => {
        // Update progress in database if it changed significantly (at least 5%)
        // or if it's nearing completion.
        if (
          !task.progress ||
          progress - task.progress >= 5 ||
          (progress > 90 && progress !== task.progress) ||
          (message && message !== task.progress_message)
        ) {
          task.progress = progress;
          if (message) {
            task.progress_message = message;
          }
          await this.taskRepository.save(task);
        }
      };

      let result: unknown;
      let taskData: Record<string, unknown> | null = null;

      if (task.result) {
        try {
          taskData = JSON.parse(task.result);
        } catch (error) {
          this.logger.error(
            `Error parsing task data for task ${taskId}: ${error.message}`,
            error.stack
          );
        }
      }

      switch (task.validation_type) {
        case 'variables':
          result = await this.validationService.validateVariables(
            task.workspace_id,
            task.page || 1,
            task.limit || 10,
            onProgress
          );
          break;
        case 'variableTypes':
          result = await this.validationService.validateVariableTypes(
            task.workspace_id,
            task.page || 1,
            task.limit || 10,
            onProgress
          );
          break;
        case 'responseStatus':
          result = await this.validationService.validateResponseStatus(
            task.workspace_id,
            task.page || 1,
            task.limit || 10,
            onProgress
          );
          break;
        case 'duplicateResponses':
          result = await this.validationService.validateDuplicateResponses(
            task.workspace_id,
            task.page || 1,
            task.limit || 10,
            onProgress
          );
          break;
        case 'testTakers':
          result = await this.validationService.validateTestTakers(
            task.workspace_id,
            onProgress
          );
          break;
        case 'testFiles': {
          const cacheKey =
            task.cache_key ||
            await this.validationService.getTestFilesValidationCacheKey(
              task.workspace_id
            );
          task.cache_key = cacheKey;

          const cachedTask = await this.findCachedTestFilesValidationTask(
            task.workspace_id,
            cacheKey,
            task.id
          );
          if (cachedTask?.result) {
            task.result = cachedTask.result;
            task.status = 'completed';
            task.progress = 100;
            task.progress_message =
              'Letztes Validierungsergebnis wurde wiederverwendet.';
            await this.taskRepository.save(task);
            this.logger.log(
              `Completed validation task ${taskId} from cached task ${cachedTask.id}`
            );
            return;
          }

          result = await this.validationService.validateTestFiles(
            task.workspace_id,
            onProgress
          );
          break;
        }
        case 'groupResponses':
          result = await this.validationService.validateGroupResponses(
            task.workspace_id,
            task.page || 1,
            task.limit || 10,
            onProgress
          );
          break;
        case 'deleteResponses':
          if (taskData) {
            const responseIds = ValidationTaskService.parseResponseIds(
              taskData.responseIds
            );
            if (responseIds.length === 0) {
              throw new Error('No response IDs provided for deletion');
            }
            const deletedCount =
              await this.validationService.deleteInvalidResponses(
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
            const validationType = taskData.validationType as
              | 'variables'
              | 'variableTypes'
              | 'responseStatus'
              | 'duplicateResponses';
            const deletedCount =
              await this.validationService.deleteAllInvalidResponses(
                task.workspace_id,
                validationType
              );
            result = { deletedCount };
          } else {
            throw new Error('No validation type provided for deletion');
          }
          break;
        case 'deleteTestResults':
          if (taskData && typeof taskData.scope === 'string') {
            result = await this.testResultsService.deleteTestResultsByRequest(
              task.workspace_id,
              taskData as unknown as TestResultsDeleteRequestDto,
              typeof taskData.userId === 'string' ? taskData.userId : '',
              onProgress
            );
          } else {
            throw new Error('No test result deletion scope provided');
          }
          break;
        case 'deleteTestLogs':
          if (taskData && typeof taskData.scope === 'string') {
            result = await this.testResultsService.deleteTestLogsByRequest(
              task.workspace_id,
              taskData as unknown as TestResultsDeleteRequestDto,
              typeof taskData.userId === 'string' ? taskData.userId : '',
              onProgress
            );
          } else {
            throw new Error('No test log deletion scope provided');
          }
          break;
        default:
          throw new Error(`Unknown validation type: ${task.validation_type}`);
      }

      task.result = JSON.stringify(result);
      task.status = 'completed';
      task.progress = 100;
      task.progress_message = ValidationTaskService.isDeletionTask(task.validation_type) ?
        'Löschung abgeschlossen.' :
        'Validierung abgeschlossen.';
      await this.taskRepository.save(task);

      this.logger.log(`Completed validation task with ID ${taskId}`);
    } catch (error) {
      try {
        const task = await this.getValidationTask(taskId);
        task.error = error.message;
        task.status = 'failed';
        task.progress = 100;
        task.progress_message = ValidationTaskService.isDeletionTask(task.validation_type) ?
          'Löschung fehlgeschlagen.' :
          'Validierung fehlgeschlagen.';
        await this.taskRepository.save(task);
      } catch (innerError) {
        this.logger.error(`Failed to update task ${taskId} with error: ${innerError.message}`, innerError.stack);
      }
      this.logger.error(`Failed to process task ${taskId}: ${error.message}`, error.stack);
    }
  }

  private static isDeletionTask(validationType: ValidationType): boolean {
    return validationType === 'deleteResponses' ||
      validationType === 'deleteAllResponses' ||
      validationType === 'deleteTestResults' ||
      validationType === 'deleteTestLogs';
  }
}
