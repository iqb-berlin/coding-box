import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job, JobsOptions } from 'bullmq';
import { WorkspaceContentPoolController } from '../workspace/workspace-content-pool.controller';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { createRequestValidationPipe } from '../../http/request-validation';
import { ContentPoolIntegrationService } from './content-pool-integration.service';
import { ContentPoolJobData, ContentPoolJobResult } from './content-pool-job';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { JOB_QUEUE_NAMES } from '../../job-queue/job-queue.config';
import { ContentPoolProcessor } from '../../job-queue/processors/content-pool.processor';
import { ValidationTask } from '../../database/entities/validation-task.entity';
import { WorkspaceFilesService } from '../../database/services/workspace';
import { Setting } from '../../database/entities/setting.entity';
import FileUpload from '../../database/entities/file_upload.entity';

type StoredJob = Job<ContentPoolJobData, ContentPoolJobResult> & { testState: string };

describe('Content-Pool queued work and workspace ownership', () => {
  const jobs = new Map<string, StoredJob>();
  const queue = {
    add: jest.fn(async (_name: string, data: ContentPoolJobData, options: JobsOptions) => {
      const job = {
        id: options.jobId,
        data,
        timestamp: Date.now(),
        progress: 0,
        testState: 'waiting',
        getState: async () => job.testState,
        updateProgress: jest.fn(async (progress: unknown) => { job.progress = progress as number; })
      } as unknown as StoredJob;
      jobs.set(String(job.id), job);
      return job;
    }),
    getJob: jest.fn(async (id: string) => jobs.get(id))
  };
  let modules: TestingModule[];
  async function createService() {
    const module = await Test.createTestingModule({
      controllers: [WorkspaceContentPoolController],
      providers: [
        ContentPoolIntegrationService, JobQueueService,
        { provide: AuthService, useValue: { canAccessWorkSpace: async (_userId: number, workspaceId: number) => workspaceId === 1 } },
        { provide: UsersService, useValue: { getUserIsAdmin: async () => false, getUserAccessLevel: async () => 3 } },
        ...JOB_QUEUE_NAMES.map(name => ({ provide: getQueueToken(name), useValue: queue })),
        ...[ValidationTask, Setting, FileUpload].map(entity => ({ provide: getRepositoryToken(entity), useValue: {} })),
        { provide: HttpService, useValue: {} },
        { provide: WorkspaceFilesService, useValue: {} }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) {
        context.switchToHttp().getRequest().user = { id: 7 };
        return true;
      }
    }).compile();
    modules.push(module);
    return module.get(ContentPoolIntegrationService);
  }
  beforeEach(() => { modules = []; jobs.clear(); queue.add.mockClear(); });
  afterEach(async () => { await Promise.all(modules.map(module => module.close())); });

  it.each(['import-acp', 'upload-files'] as const)('preserves %s jobs across service instances and refuses other workspaces and operation types', async operation => {
    const first = await createService();
    const input = { workspaceId: 2, acpId: 'acp', fileIds: [7] };
    const started = operation === 'import-acp' ? await first.startAcpImportToWorkspace(input) : await first.startUploadWorkspaceFilesToAcp(input);
    expect(started.jobId).toMatch(/^[a-f0-9-]{36}$/);
    const second = await createService();
    const read = operation === 'import-acp' ? second.getAcpImportProgress.bind(second) : second.getUploadWorkspaceFilesProgress.bind(second);
    await expect(read(2, started.jobId)).resolves.toMatchObject({ status: 'pending', jobId: started.jobId });
    await expect(read(1, started.jobId)).rejects.toMatchObject({ status: 404 });
    const wrongOperation = operation === 'import-acp' ? second.getUploadWorkspaceFilesProgress.bind(second) : second.getAcpImportProgress.bind(second);
    await expect(wrongOperation(2, started.jobId)).rejects.toMatchObject({ status: 404 });
    expect(queue.add).toHaveBeenCalledWith(operation, expect.objectContaining({ workspaceId: 2 }), expect.objectContaining({ attempts: 1, removeOnComplete: { age: 1800, count: 1000 } }));
  });

  it.each(['import-acp', 'upload-files'] as const)('does not expose foreign %s results through an authorized workspace URL', async operation => {
    const service = await createService();
    const input = { workspaceId: 2, acpId: 'acp', fileIds: [7] };
    const { jobId } = operation === 'import-acp' ? await service.startAcpImportToWorkspace(input) : await service.startUploadWorkspaceFilesToAcp(input);
    const app = modules[0].createNestApplication();
    app.useGlobalPipes(createRequestValidationPipe());
    await app.listen(0, '127.0.0.1');
    try {
      const base = await app.getUrl();
      const foreignThroughOwnWorkspace = await fetch(`${base}/admin/workspace/1/content-pool/${operation}/${jobId}/progress`);
      const foreignWorkspace = await fetch(`${base}/admin/workspace/2/content-pool/${operation}/${jobId}/progress`);
      expect(foreignThroughOwnWorkspace.status).toBe(404);
      expect(foreignWorkspace.status).toBe(403);
    } finally { await app.close(); }
  });

  it('rejects excessive file counts and payloads before enqueuing any work', async () => {
    const service = await createService();
    await expect(service.startUploadWorkspaceFilesToAcp({ workspaceId: 2, acpId: 'acp', fileIds: Array(1001).fill(7) })).rejects.toMatchObject({ status: 413 });
    await expect(service.startAcpImportToWorkspace({ workspaceId: 2, acpId: 'acp', overwriteFileIds: Array(1001).fill('file') })).rejects.toMatchObject({ status: 413 });
    await expect(service.startUploadWorkspaceFilesToAcp({
      workspaceId: 2, acpId: 'acp', fileIds: [7], changelog: 'x'.repeat(1024 * 1024)
    })).rejects.toMatchObject({ status: 413 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('persists worker progress and exposes the completed result to another service instance', async () => {
    const first = await createService();
    const { jobId } = await first.startAcpImportToWorkspace({ workspaceId: 2, acpId: 'acp' });
    const result = {
      total: 1, uploaded: 1, failed: 0, uploadedFiles: [], failedFiles: []
    };
    jest.spyOn(first, 'importAcpFilesToWorkspace').mockImplementation(async (_input, progress) => {
      await progress?.({ progress: 25, phase: 'downloading-files', currentFileName: 'example.xml' });
      return result;
    });
    const job = jobs.get(jobId)!;
    job.testState = 'active';
    job.returnvalue = await new ContentPoolProcessor(first).processWorkspaceJob(job);
    job.testState = 'completed';
    const second = await createService();
    await expect(second.getAcpImportProgress(2, jobId)).resolves.toMatchObject({
      status: 'completed', phase: 'completed', progress: 100, result
    });
    expect(job.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 25, currentFileName: 'example.xml' }));
  });

  it.each(['completed', 'failed'] as const)('reloads the terminal %s snapshot after a concurrent worker transition', async status => {
    const service = await createService();
    const { jobId } = await service.startAcpImportToWorkspace({ workspaceId: 2, acpId: 'acp' });
    const job = jobs.get(jobId)!;
    const stale = { ...job, returnvalue: null } as unknown as StoredJob;
    job.testState = status;
    job.returnvalue = {
      total: 1, uploaded: 1, failed: 0, uploadedFiles: [], failedFiles: []
    };
    job.failedReason = 'persisted failure';
    await job.updateProgress({ message: 'Persisted terminal progress', progress: 100 });
    queue.getJob.mockResolvedValueOnce(stale);

    await expect(service.getAcpImportProgress(2, jobId)).resolves.toMatchObject({
      status,
      message: 'Persisted terminal progress',
      ...(status === 'completed' ? { result: job.returnvalue } : { error: job.failedReason })
    });
  });

  it('returns 404 when a terminal job disappears before its result can be reloaded', async () => {
    const service = await createService();
    const { jobId } = await service.startAcpImportToWorkspace({ workspaceId: 2, acpId: 'acp' });
    const job = jobs.get(jobId)!;
    job.testState = 'completed';
    queue.getJob.mockResolvedValueOnce(job);
    jobs.delete(jobId);

    await expect(service.getAcpImportProgress(2, jobId)).rejects.toMatchObject({ status: 404 });
  });

  it('marks provider failures as failed queue jobs instead of successful results', async () => {
    const service = await createService();
    const { jobId } = await service.startUploadWorkspaceFilesToAcp({ workspaceId: 2, acpId: 'acp', fileIds: [7] });
    jest.spyOn(service, 'uploadWorkspaceFilesToAcp').mockRejectedValue(new Error('private provider detail'));
    const job = jobs.get(jobId)!;
    await expect(new ContentPoolProcessor(service).processWorkspaceJob(job)).rejects.toThrow('Content-Pool-Auftrag fehlgeschlagen.');
    job.testState = 'failed';
    await expect(service.getUploadWorkspaceFilesProgress(2, jobId)).resolves.toMatchObject({ status: 'failed', phase: 'failed', error: 'Content-Pool-Auftrag fehlgeschlagen.' });
  });
});
