import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValidationTask } from '../../entities/validation-task.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceTestResultsService } from '../test-results';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { ValidationTaskService } from './validation-task.service';

describe('ValidationTaskService', () => {
  let service: ValidationTaskService;
  let taskRepository: Partial<Record<keyof Repository<ValidationTask>, jest.Mock>>;
  let workspaceFilesService: {
    getTestFilesValidationCacheKey: jest.Mock;
    refreshTestFilesValidationResult: jest.Mock;
  };
  let jobQueueService: {
    addValidationTaskJob: jest.Mock;
  };
  let workspaceTestResultsService: {
    deleteTestResultsByRequest: jest.Mock;
    deleteTestLogsByRequest: jest.Mock;
  };

  beforeEach(async () => {
    taskRepository = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn()
    };
    workspaceFilesService = {
      getTestFilesValidationCacheKey: jest.fn(),
      refreshTestFilesValidationResult: jest.fn()
    };
    jobQueueService = {
      addValidationTaskJob: jest.fn()
    };
    workspaceTestResultsService = {
      deleteTestResultsByRequest: jest.fn(),
      deleteTestLogsByRequest: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationTaskService,
        {
          provide: getRepositoryToken(ValidationTask),
          useValue: taskRepository
        },
        {
          provide: WorkspaceFilesService,
          useValue: workspaceFilesService
        },
        {
          provide: WorkspaceTestResultsService,
          useValue: workspaceTestResultsService
        },
        {
          provide: JobQueueService,
          useValue: jobQueueService
        }
      ]
    }).compile();

    service = module.get<ValidationTaskService>(ValidationTaskService);
  });

  it('should refresh GeoGebra package status when returning cached test file results', async () => {
    const cachedResult = {
      testTakersFound: true,
      validationResults: [],
      geogebra: {
        hasTasks: true,
        units: ['UNIT1'],
        packageStatus: {
          exists: true,
          valid: true,
          name: 'Geogebra'
        }
      }
    };
    const refreshedResult = {
      ...cachedResult,
      geogebra: {
        ...cachedResult.geogebra,
        packageStatus: {
          exists: false,
          valid: false,
          errors: ['GeoGebra Math Apps Bundle ist nicht installiert.']
        }
      }
    };
    const task = {
      id: 1,
      workspace_id: 7,
      validation_type: 'testFiles',
      status: 'completed',
      result: JSON.stringify(cachedResult)
    } as ValidationTask;

    taskRepository.findOne?.mockResolvedValue(task);
    taskRepository.save?.mockImplementation(
      savedTask => Promise.resolve(savedTask)
    );
    workspaceFilesService.refreshTestFilesValidationResult.mockResolvedValue(
      refreshedResult
    );

    const result = await service.getValidationResults(1, 7);

    expect(
      workspaceFilesService.refreshTestFilesValidationResult
    ).toHaveBeenCalledWith(7, cachedResult);
    expect(result).toEqual(refreshedResult);
    expect(taskRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        result: JSON.stringify(refreshedResult)
      })
    );
  });

  it('should mark unchanged test file validations as reused when returning a cached task', async () => {
    const cachedTask = {
      id: 2,
      workspace_id: 7,
      validation_type: 'testFiles',
      status: 'completed',
      progress: 100,
      result: '{}'
    } as ValidationTask;

    workspaceFilesService.getTestFilesValidationCacheKey.mockResolvedValue(
      'cache-key'
    );
    taskRepository.find
      ?.mockResolvedValueOnce([])
      .mockResolvedValueOnce([cachedTask]);

    const task = await service.createValidationTask(7, 'testFiles');

    expect(task).toBe(cachedTask);
    expect(task.progress).toBe(100);
    expect(task.progress_message).toBe(
      'Testdateien unverändert - letztes Validierungsergebnis wird verwendet.'
    );
    expect(jobQueueService.addValidationTaskJob).not.toHaveBeenCalled();
  });

  it('should process test log deletion tasks', async () => {
    const task = {
      id: 3,
      workspace_id: 7,
      validation_type: 'deleteTestLogs',
      status: 'pending',
      result: JSON.stringify({
        scope: 'filteredPersons',
        userId: 'user-1'
      })
    } as ValidationTask;

    taskRepository.findOne?.mockResolvedValue(task);
    taskRepository.save?.mockImplementation(
      savedTask => Promise.resolve(savedTask)
    );
    workspaceTestResultsService.deleteTestLogsByRequest.mockResolvedValue({
      targetType: 'logs',
      scope: 'filteredPersons',
      label: 'alle sichtbaren Testpersonen',
      persons: 1,
      booklets: 1,
      units: 1,
      responses: 1,
      bookletLogs: 2,
      unitLogs: 3,
      sessions: 1,
      groups: [],
      bookletNames: [],
      unitNames: [],
      warnings: [],
      deletedTargetCount: 6
    });

    await service.processValidationTask(3);

    expect(
      workspaceTestResultsService.deleteTestLogsByRequest
    ).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ scope: 'filteredPersons' }),
      'user-1',
      expect.any(Function)
    );
    expect(task.progress_message).toBe('Löschung abgeschlossen.');
    expect(task.status).toBe('completed');
  });
});
