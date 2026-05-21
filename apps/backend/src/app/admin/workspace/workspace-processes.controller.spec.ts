import { WorkspaceProcessesController } from './workspace-processes.controller';
import { JobQueueService } from '../../job-queue/job-queue.service';

describe('WorkspaceProcessesController', () => {
  let controller: WorkspaceProcessesController;
  let jobQueueService: {
    getAllWorkspaceJobs: jest.Mock;
    cancelWorkspaceJob: jest.Mock;
  };

  beforeEach(() => {
    jobQueueService = {
      getAllWorkspaceJobs: jest.fn().mockResolvedValue([]),
      cancelWorkspaceJob: jest.fn().mockResolvedValue(true)
    };
    controller = new WorkspaceProcessesController(jobQueueService as unknown as JobQueueService);
  });

  it('loads workspace-scoped processes', async () => {
    await expect(controller.getProcesses(5)).resolves.toEqual([]);

    expect(jobQueueService.getAllWorkspaceJobs).toHaveBeenCalledWith(5);
  });

  it('cancels processes through the workspace-scoped queue method', async () => {
    await expect(controller.deleteProcess(5, 'data-export', 'job-1')).resolves.toBe(true);

    expect(jobQueueService.cancelWorkspaceJob).toHaveBeenCalledWith(5, 'data-export', 'job-1');
  });
});
