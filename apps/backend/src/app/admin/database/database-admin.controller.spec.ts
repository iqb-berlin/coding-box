import { ConflictException } from '@nestjs/common';
import { Queue } from 'bull';
import { DatabaseAdminController } from './database-admin.controller';
import {
  DatabaseExportJobData,
  DatabaseExportJobResult
} from './database-export.processor';

describe('DatabaseAdminController', () => {
  const createController = (
    queueOverrides: Partial<Queue<DatabaseExportJobData>> = {}
  ) => {
    const databaseExportQueue = {
      add: jest.fn().mockResolvedValue({ id: 'database-job-1' }),
      getJob: jest.fn(),
      getJobs: jest.fn().mockResolvedValue([]),
      ...queueOverrides
    } as unknown as Queue<DatabaseExportJobData>;

    return {
      controller: new DatabaseAdminController(databaseExportQueue),
      databaseExportQueue
    };
  };

  it('starts system database exports as Bull jobs', async () => {
    const { controller, databaseExportQueue } = createController();

    await expect(controller.startDatabaseExportJob(
      { user: { id: 5 } } as never
    )).resolves.toEqual({
      jobId: 'database-job-1',
      message: 'Database export job started successfully.'
    });

    expect(databaseExportQueue.add).toHaveBeenCalledWith({
      requestedByUserId: 5
    });
  });

  it('rejects duplicate active system database exports', async () => {
    const activeJob = {
      id: 'database-job-1',
      data: { requestedByUserId: 5 },
      getState: jest.fn().mockResolvedValue('active')
    };
    const { controller } = createController({
      getJobs: jest.fn().mockResolvedValue([activeJob])
    } as never);

    await expect(controller.startDatabaseExportJob(
      { user: { id: 7 } } as never
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose server file paths in status responses', async () => {
    const result: DatabaseExportJobResult = {
      filePath: '/server/temp/database-export.sqlite',
      fileName: 'database-export.sqlite',
      fileSize: 2048,
      createdAt: 123456789,
      requestedByUserId: 5,
      scope: 'system'
    };
    const job = {
      data: { requestedByUserId: 5 },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100),
      returnvalue: result
    };
    const { controller, databaseExportQueue } = createController({
      getJob: jest.fn().mockResolvedValue(job)
    } as never);

    const status = await controller.getDatabaseExportJobStatus('job-1');

    expect(databaseExportQueue.getJob).toHaveBeenCalledWith('job-1');
    expect(status).toEqual({
      status: 'completed',
      progress: 100,
      result: {
        fileName: 'database-export.sqlite',
        fileSize: 2048,
        createdAt: 123456789,
        requestedByUserId: 5,
        scope: 'system',
        workspaceId: undefined
      }
    });
    expect(status.result).not.toHaveProperty('filePath');
  });
});
