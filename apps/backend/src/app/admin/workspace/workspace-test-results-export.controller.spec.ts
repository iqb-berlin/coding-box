import 'reflect-metadata';
import { Queue } from 'bull';
import { WorkspaceTestResultsExportController } from './workspace-test-results-export.controller';
import type { WorkspaceTestResultsService } from '../../database/services/test-results';
import { DatabaseExportService } from '../database/database-export.service';
import {
  DatabaseExportJobData,
  DatabaseExportJobResult
} from '../database/database-export.processor';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';

jest.mock('../../database/services/test-results', () => ({
  WorkspaceTestResultsService: jest.fn()
}));

describe('WorkspaceTestResultsExportController', () => {
  it.each([
    'exportWorkspaceToSqlite',
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
      {} as DatabaseExportService,
      {} as JobQueueService,
      {} as CacheService,
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
});
