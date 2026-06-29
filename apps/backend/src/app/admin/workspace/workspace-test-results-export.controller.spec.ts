import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { WorkspaceTestResultsExportController } from './workspace-test-results-export.controller';
import type { WorkspaceTestResultsService } from '../../database/services/test-results';
import {
  DatabaseExportJobData,
  DatabaseExportJobResult
} from '../database/database-export.processor';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { JournalService } from '../../database/services/shared';

jest.mock('../../database/services/test-results', () => ({
  WorkspaceTestResultsService: jest.fn()
}));

describe('WorkspaceTestResultsExportController', () => {
  const createController = (
    recordEvent = jest.fn().mockResolvedValue(undefined)
  ) => {
    const jobQueueService = {
      addExportJob: jest.fn().mockResolvedValue({ id: 'export-job-1' })
    } as unknown as JobQueueService;
    const journalService = {
      recordEvent
    } as unknown as JournalService;
    const databaseExportQueue = {
      add: jest.fn().mockResolvedValue({ id: 'database-job-1' }),
      getJobs: jest.fn().mockResolvedValue([])
    } as unknown as Queue<DatabaseExportJobData>;
    const controller = new WorkspaceTestResultsExportController(
      {} as WorkspaceTestResultsService,
      jobQueueService,
      {} as CacheService,
      journalService,
      databaseExportQueue
    );

    return {
      controller,
      databaseExportQueue,
      jobQueueService,
      journalService
    };
  };

  it.each([
    'startWorkspaceDatabaseExportJob',
    'getWorkspaceDatabaseExportJobStatus',
    'downloadWorkspaceDatabaseExport'
  ] as const)('requires study-manager access for %s', methodName => {
    const handler = WorkspaceTestResultsExportController.prototype[methodName];

    expect(Reflect.getMetadata('accessLevel', handler)).toBe(3);
  });

  it('does not expose server file paths in database export job status', async () => {
    const result: DatabaseExportJobResult = {
      filePath: '/server/temp/workspace-7-export.sqlite',
      fileName: 'workspace-7-export.sqlite',
      fileSize: 1024,
      createdAt: 123456789,
      requestedByUserId: 5,
      scope: 'workspace',
      workspaceId: 7
    };
    const job = {
      data: {
        scope: 'workspace',
        workspaceId: 7
      },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100),
      returnvalue: result
    };
    const databaseExportQueue = {
      getJob: jest.fn().mockResolvedValue(job)
    } as unknown as Queue<DatabaseExportJobData>;
    const controller = new WorkspaceTestResultsExportController(
      {} as WorkspaceTestResultsService,
      {} as JobQueueService,
      {} as CacheService,
      { recordEvent: jest.fn() } as unknown as JournalService,
      databaseExportQueue
    );

    const status = await controller.getWorkspaceDatabaseExportJobStatus(7, 'job-1');

    expect(databaseExportQueue.getJob).toHaveBeenCalledWith('job-1');
    expect(status).toEqual({
      status: 'completed',
      progress: 100,
      result: {
        fileName: 'workspace-7-export.sqlite',
        fileSize: 1024,
        createdAt: 123456789,
        requestedByUserId: 5,
        scope: 'workspace',
        workspaceId: 7
      }
    });
    expect(status.result).not.toHaveProperty('filePath');
  });

  it('records a database export audit event when starting a workspace database export job', async () => {
    const { controller, journalService } = createController();

    await controller.startWorkspaceDatabaseExportJob(
      7,
      { user: { id: 5 } } as never
    );

    expect(journalService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        actorUserId: 5,
        eventType: 'DATABASE_EXPORT_STARTED',
        entityType: 'workspace',
        result: 'started',
        jobId: 'database-job-1'
      })
    );
  });

  it('records a test-results export audit event when starting a test-results export job', async () => {
    const { controller, journalService } = createController();

    await controller.startExportTestResultsJob(
      7,
      { user: { id: 5 }, headers: { authorization: 'Bearer token' } } as never,
      { groupNames: ['group-a'] }
    );

    expect(journalService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        actorUserId: 5,
        eventType: 'TEST_RESULTS_EXPORT_STARTED',
        entityType: 'test-results-export',
        result: 'started',
        jobId: 'export-job-1',
        details: expect.objectContaining({
          exportType: 'test-results',
          hasFilters: true
        })
      })
    );
  });

  it('records a test-logs export audit event when starting a test-logs export job', async () => {
    const { controller, journalService } = createController();

    await controller.startExportTestLogsJob(
      7,
      { user: { id: 5 }, headers: { authorization: 'Bearer token' } } as never,
      { bookletNames: ['booklet-a'] }
    );

    expect(journalService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        actorUserId: 5,
        eventType: 'TEST_LOGS_EXPORT_STARTED',
        entityType: 'test-logs-export',
        result: 'started',
        jobId: 'export-job-1',
        details: expect.objectContaining({
          exportType: 'test-logs',
          hasFilters: true
        })
      })
    );
  });

  it('still returns queued job IDs when audit event recording fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const recordEvent = jest.fn().mockRejectedValue(new Error('journal unavailable'));

    const databaseExport = createController(recordEvent);
    await expect(
      databaseExport.controller.startWorkspaceDatabaseExportJob(
        7,
        { user: { id: 5 } } as never
      )
    ).resolves.toEqual({
      jobId: 'database-job-1',
      message: 'Workspace database export job started successfully.'
    });

    const testResultsExport = createController(recordEvent);
    await expect(
      testResultsExport.controller.startExportTestResultsJob(
        7,
        { user: { id: 5 }, headers: { authorization: 'Bearer token' } } as never
      )
    ).resolves.toEqual({
      jobId: 'export-job-1',
      message: 'Export job started successfully'
    });

    const testLogsExport = createController(recordEvent);
    await expect(
      testLogsExport.controller.startExportTestLogsJob(
        7,
        { user: { id: 5 }, headers: { authorization: 'Bearer token' } } as never
      )
    ).resolves.toEqual({
      jobId: 'export-job-1',
      message: 'Export job started successfully'
    });

    expect(recordEvent).toHaveBeenCalledTimes(3);
    loggerSpy.mockRestore();
  });

  it('cancels active test-results export jobs through the data export queue', async () => {
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 7,
        exportType: 'test-results'
      },
      getState: jest.fn().mockResolvedValue('active')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(true)
    } as unknown as JobQueueService;
    const cacheService = {
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const controller = new WorkspaceTestResultsExportController(
      {} as WorkspaceTestResultsService,
      jobQueueService,
      cacheService,
      { recordEvent: jest.fn() } as unknown as JournalService,
      { getJob: jest.fn() } as unknown as Queue<DatabaseExportJobData>
    );

    await expect(controller.cancelExportJob(7, 'job-1')).resolves.toEqual({
      success: true,
      message: 'Export job cancellation requested'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('does not report successful cancellation when queue cancellation was not accepted', async () => {
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 7,
        exportType: 'test-results'
      },
      getState: jest.fn().mockResolvedValue('active')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(false),
      cancelExportJob: jest.fn().mockResolvedValue(false)
    } as unknown as JobQueueService;
    const cacheService = {
      get: jest.fn(),
      delete: jest.fn()
    } as unknown as CacheService;
    const controller = new WorkspaceTestResultsExportController(
      {} as WorkspaceTestResultsService,
      jobQueueService,
      cacheService,
      { recordEvent: jest.fn() } as unknown as JournalService,
      { getJob: jest.fn() } as unknown as Queue<DatabaseExportJobData>
    );

    await expect(controller.cancelExportJob(7, 'job-1')).resolves.toEqual({
      success: false,
      message: 'Export job cancellation could not be requested'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('does not clean up finished exports when a job completes during cancellation', async () => {
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 7,
        exportType: 'test-results'
      },
      getState: jest.fn()
        .mockResolvedValueOnce('active')
        .mockResolvedValueOnce('completed')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(true)
    } as unknown as JobQueueService;
    const cacheService = {
      get: jest.fn(),
      delete: jest.fn()
    } as unknown as CacheService;
    const controller = new WorkspaceTestResultsExportController(
      {} as WorkspaceTestResultsService,
      jobQueueService,
      cacheService,
      { recordEvent: jest.fn() } as unknown as JournalService,
      { getJob: jest.fn() } as unknown as Queue<DatabaseExportJobData>
    );

    await expect(controller.cancelExportJob(7, 'job-1')).resolves.toEqual({
      success: true,
      message: 'Export job cancellation requested'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('maps cancelled test-results export jobs in the job list', async () => {
    const activeCancelledJob = {
      id: 'job-1',
      data: {
        workspaceId: 7,
        exportType: 'test-logs',
        isCancelled: true
      },
      timestamp: 123456,
      failedReason: undefined,
      getState: jest.fn().mockResolvedValue('active'),
      progress: jest.fn().mockResolvedValue({
        percentage: 37.4,
        phase: 'writing',
        processedRows: 12,
        totalRows: 30
      })
    };
    const failedCancelledJob = {
      id: 'job-2',
      data: {
        workspaceId: 7,
        exportType: 'test-results',
        isCancelled: true
      },
      timestamp: 123457,
      failedReason: undefined,
      getState: jest.fn().mockResolvedValue('failed'),
      progress: jest.fn().mockResolvedValue(52)
    };
    const completedCancelledJob = {
      id: 'job-3',
      data: {
        workspaceId: 7,
        exportType: 'test-results',
        isCancelled: true
      },
      timestamp: 123458,
      failedReason: undefined,
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(21)
    };
    const jobQueueService = {
      getExportJobs: jest.fn().mockResolvedValue([
        activeCancelledJob,
        failedCancelledJob,
        completedCancelledJob
      ])
    } as unknown as JobQueueService;
    const controller = new WorkspaceTestResultsExportController(
      {} as WorkspaceTestResultsService,
      jobQueueService,
      {} as CacheService,
      { recordEvent: jest.fn() } as unknown as JournalService,
      { getJob: jest.fn() } as unknown as Queue<DatabaseExportJobData>
    );

    await expect(controller.getExportJobs(7)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: 'job-1',
          status: 'cancelled',
          progress: 37,
          exportType: 'test-logs'
        }),
        expect.objectContaining({
          jobId: 'job-2',
          status: 'cancelled',
          progress: 52,
          exportType: 'test-results'
        }),
        expect.objectContaining({
          jobId: 'job-3',
          status: 'cancelled',
          progress: 21,
          exportType: 'test-results'
        })
      ])
    );
  });
});
