import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceDeletionService } from './workspace-deletion.service';

const createJob = (state = 'completed') => ({
  workspaceId: 7,
  id: '17',
  queueName: 'data-export',
  returnvalue: undefined,
  data: {} as Record<string, unknown>,
  getState: jest.fn().mockResolvedValue(state),
  remove: jest.fn().mockResolvedValue(undefined)
});

describe('WorkspaceDeletionService', () => {
  let directory: string;
  let cwd: jest.SpyInstance;
  let service: WorkspaceDeletionService;
  let jobs: ReturnType<typeof createJob>[];
  let cache: { getStrict: jest.Mock; delete: jest.Mock };
  let repository: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let getCount: jest.Mock;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-deletion-artifacts-'));
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(directory);
    jobs = [createJob()];
    cache = { getStrict: jest.fn(), delete: jest.fn().mockResolvedValue(true) };
    getCount = jest.fn().mockResolvedValue(0);
    repository = {
      find: jest.fn().mockResolvedValue([{ name: 'owned', workspaceId: 7 }, { name: 'shared', workspaceId: 7 }]),
      createQueryBuilder: jest.fn(() => ({ where: () => ({ getCount }) }))
    };
    service = new WorkspaceDeletionService(
      { getRepository: () => repository } as never,
      { getJobsForWorkspaceDeletion: async () => jobs, getJobForWorkspaceDeletionCleanup: async (_queue: string, id: string) => jobs.find(job => job.id === id) } as never,
      cache as never
    );
  });

  afterEach(async () => {
    cwd.mockRestore();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('captures workspace packages and queue jobs before their database ownership rows disappear', async () => {
    const resources = await service.prepare([7]);
    expect(resources).toMatchObject({ workspaceIds: [7], jobs: [{ queueName: 'data-export', id: '17' }], packageNames: ['owned', 'shared'] });
    expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ scope: 'workspace' }) }));
  });

  it('removes queued payloads, cached exports and unreferenced packages while retaining shared packages and paths outside temp', async () => {
    await fs.mkdir(path.join(directory, 'temp'), { recursive: true });
    await fs.mkdir(path.join(directory, 'packages', 'owned'), { recursive: true });
    await fs.mkdir(path.join(directory, 'packages', 'shared'), { recursive: true });
    const file = path.join(directory, 'temp', 'export.csv');
    const external = path.join(directory, 'external.csv');
    await fs.writeFile(file, 'private data');
    await fs.writeFile(external, 'retain');
    cache.getStrict.mockResolvedValueOnce({ filePath: file });
    jobs[0].data.tempFilePath = external;
    getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await service.cleanup(await service.prepare([7]));
    expect(jobs[0].remove).toHaveBeenCalled();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(directory, 'packages', 'owned'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(directory, 'packages', 'shared'))).resolves.toBeDefined();
    await expect(fs.readFile(external, 'utf8')).resolves.toBe('retain');
    expect(cache.delete).toHaveBeenCalledWith('item-matrix-incomplete-result:17');
  });

  it('removes a published database export even before BullMQ stores its return value', async () => {
    await fs.mkdir(path.join(directory, 'temp'), { recursive: true });
    const file = path.join(directory, 'temp', 'workspace-export.sqlite');
    await fs.writeFile(file, 'private data');
    jobs[0].queueName = 'database-export';
    jobs[0].data.workspaceArtifactPaths = [file];
    jobs[0].getState.mockResolvedValue('active');
    await service.cleanup(await service.prepare([7]));
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(jobs[0].remove).not.toHaveBeenCalled();
  });

  it('recovers cleanup after ownership rows and queue entries have already disappeared', async () => {
    await fs.mkdir(path.join(directory, 'temp'), { recursive: true });
    const file = path.join(directory, 'temp', 'recover.csv');
    await fs.writeFile(file, 'private data');
    cache.getStrict.mockResolvedValueOnce({ filePath: file });
    await service.prepare([7]);
    jobs = [];
    repository.find.mockResolvedValue([]);
    const recovered = await service.prepare([7]);
    await service.cleanup(recovered);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(directory, 'temp', 'workspace-deletion', '7.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves recovery information when cached metadata cannot be deleted', async () => {
    const resources = await service.prepare([7]);
    cache.delete.mockResolvedValueOnce(false);
    await expect(service.cleanup(resources)).rejects.toThrow('cached export metadata');
    await expect(fs.stat(path.join(directory, 'temp', 'workspace-deletion', '7.json'))).resolves.toBeDefined();
  });

  it('keeps recovery manifests scoped when a failed batch is retried for one workspace', async () => {
    repository.find.mockResolvedValueOnce([{ name: 'seven', workspaceId: 7 }, { name: 'eight', workspaceId: 8 }]);
    await service.prepare([7, 8]);
    expect(repository.find).toHaveBeenCalledTimes(1);
    repository.find.mockResolvedValue([]);
    jobs = [];
    expect((await service.prepare([7])).packageNames).toEqual(['seven']);
  });

  it('does not read or remove export caches for equal IDs in unrelated queues', async () => {
    jobs[0].queueName = 'coding-statistics';
    const resources = await service.prepare([7]);
    await service.cleanup(resources);
    expect(cache.getStrict).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('leaves an active worker entry to fail its guarded existence check, including activation races', async () => {
    const active = createJob('active');
    const racing = createJob();
    racing.remove.mockRejectedValueOnce(new Error('locked'));
    racing.getState.mockResolvedValueOnce('waiting').mockResolvedValueOnce('active');
    racing.id = '18';
    jobs = [active, racing];
    await service.cleanup(await service.prepare([7]));
    expect(active.remove).not.toHaveBeenCalled();
    expect(racing.remove).toHaveBeenCalled();
  });
});
