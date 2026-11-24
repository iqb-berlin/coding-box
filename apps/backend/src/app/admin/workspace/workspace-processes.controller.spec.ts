import { WorkspaceProcessesController } from './workspace-processes.controller';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { TEST_FILES_UPLOAD_PROCESS, WorkspaceFileUploadProcessService } from '../../database/services/workspace/workspace-file-upload-process.service';

describe('WorkspaceProcessesController', () => {
  let controller: WorkspaceProcessesController;
  let jobQueueService: {
    getAllWorkspaceJobs: jest.Mock;
    cancelWorkspaceJob: jest.Mock;
  };
  let uploadProcesses: {
    getProcess: jest.Mock;
    removeFinishedProcess: jest.Mock;
  };

  beforeEach(() => {
    jobQueueService = {
      getAllWorkspaceJobs: jest.fn().mockResolvedValue([]),
      cancelWorkspaceJob: jest.fn().mockResolvedValue(true)
    };
    uploadProcesses = {
      getProcess: jest.fn().mockResolvedValue(null),
      removeFinishedProcess: jest.fn().mockResolvedValue(true)
    };
    controller = new WorkspaceProcessesController(
      jobQueueService as unknown as JobQueueService,
      uploadProcesses as unknown as WorkspaceFileUploadProcessService
    );
  });

  it('loads workspace-scoped processes', async () => {
    await expect(controller.getProcesses(5)).resolves.toEqual([]);

    expect(jobQueueService.getAllWorkspaceJobs).toHaveBeenCalledWith(5);
    expect(uploadProcesses.getProcess).toHaveBeenCalledWith(5);
  });

  it('lists a workspace file upload alongside queue jobs in timestamp order', async () => {
    const older = { id: 'job-1', timestamp: 10 };
    const upload = { id: 'upload-1', queueName: TEST_FILES_UPLOAD_PROCESS, timestamp: 20 };
    const newer = { id: 'job-2', timestamp: 30 };
    uploadProcesses.getProcess.mockResolvedValue(upload);
    jobQueueService.getAllWorkspaceJobs.mockResolvedValue([newer, older]);

    await expect(controller.getProcesses(5)).resolves.toEqual([newer, upload, older]);
  });

  it('reads only the upload entry when polling its status', async () => {
    const upload = { id: 'upload-1', queueName: TEST_FILES_UPLOAD_PROCESS };
    uploadProcesses.getProcess.mockResolvedValueOnce(upload);
    await expect(controller.getFileUpload(5)).resolves.toEqual(upload);
    await expect(controller.getFileUpload(5)).resolves.toBeNull();
    expect(uploadProcesses.getProcess).toHaveBeenCalledWith(5);
    expect(jobQueueService.getAllWorkspaceJobs).not.toHaveBeenCalled();
  });

  it('cancels processes through the workspace-scoped queue method', async () => {
    await expect(controller.deleteProcess(5, 'data-export', 'job-1')).resolves.toBe(true);

    expect(jobQueueService.cancelWorkspaceJob).toHaveBeenCalledWith(5, 'data-export', 'job-1');
  });

  it('routes removal of upload entries to the workspace upload process service', async () => {
    await expect(controller.deleteProcess(5, TEST_FILES_UPLOAD_PROCESS, 'upload-1')).resolves.toBe(true);

    expect(uploadProcesses.removeFinishedProcess).toHaveBeenCalledWith(5, 'upload-1');
    expect(jobQueueService.cancelWorkspaceJob).not.toHaveBeenCalled();
  });
});
