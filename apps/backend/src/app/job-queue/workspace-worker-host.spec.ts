import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { WorkspaceWorkerHost } from './workspace-worker-host';
import { withWorkspaceJobLock } from '../database/services/shared/workspace-lifecycle-lock.util';

jest.mock('../database/services/shared/workspace-lifecycle-lock.util', () => ({
  withWorkspaceJobLock: jest.fn(async (_connection, _id, operation: () => Promise<unknown>) => operation())
}));

class TestWorker extends WorkspaceWorkerHost {
  operation = jest.fn(async () => 'result');

  async processWorkspaceJob(): Promise<string> {
    return this.operation();
  }
}

describe('WorkspaceWorkerHost dispatch', () => {
  let worker: TestWorker;
  let query: jest.Mock;

  beforeEach(async () => {
    jest.mocked(withWorkspaceJobLock).mockClear();
    query = jest.fn();
    const module = await Test.createTestingModule({
      providers: [TestWorker, { provide: getDataSourceToken(), useValue: { query } }]
    }).compile();
    worker = module.get(TestWorker);
  });

  it('runs workspace exports through the lifecycle guard before invoking their operation', async () => {
    await expect(worker.process({ queueName: 'database-export', data: { scope: 'workspace', workspaceId: 7 } } as Job)).resolves.toBe('result');
    expect(withWorkspaceJobLock).toHaveBeenCalledWith(expect.anything(), 7, expect.any(Function));
    expect(worker.operation).toHaveBeenCalledTimes(1);
  });

  it('derives legacy validation-job ownership from the database, ignoring an unrelated payload ID', async () => {
    query.mockResolvedValue([{ workspace_id: 7 }]);
    await worker.process({ queueName: 'validation-task', data: { taskId: 4, workspaceId: 88 } } as Job);
    expect(withWorkspaceJobLock).toHaveBeenCalledWith(expect.anything(), 7, expect.any(Function));
  });

  it('stops a deleted validation task before dispatch and treats system exports as system data', async () => {
    query.mockResolvedValue([]);
    await expect(worker.process({ queueName: 'validation-task', data: { taskId: 4 } } as Job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(worker.operation).not.toHaveBeenCalled();
    expect(withWorkspaceJobLock).not.toHaveBeenCalled();
    await expect(worker.process({ queueName: 'database-export', data: { scope: 'system' } } as Job)).resolves.toBe('result');
    expect(withWorkspaceJobLock).not.toHaveBeenCalled();
  });
});
