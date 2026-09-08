import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { JobResultStore } from './job-result.store';

describe('JobResultStore', () => {
  let directory: string;
  let previousDirectory: string | undefined;
  let store: JobResultStore;
  let exists: jest.Mock;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-results-test-'));
    previousDirectory = process.env.JOB_RESULT_DIR;
    process.env.JOB_RESULT_DIR = directory;
    exists = jest.fn().mockResolvedValue(0);
    store = new JobResultStore({ client: { exists }, toKey: id => `uploads:${id}` } as never);
  });

  afterEach(async () => {
    if (previousDirectory === undefined) delete process.env.JOB_RESULT_DIR;
    else process.env.JOB_RESULT_DIR = previousDirectory;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('stores a small reference while preserving the complete result and legacy reads', async () => {
    const value = { issues: Array.from({ length: 1000 }, (_, index) => ({ index, message: 'details' })) };
    const reference = await store.save(value, 'job-1');
    expect(JSON.stringify(reference).length).toBeLessThan(100);
    await expect(store.read(reference)).resolves.toEqual(value);
    await expect(store.read(value)).resolves.toEqual(value);
    expect(await fs.readdir(directory)).toEqual(expect.arrayContaining([`${reference.id}.json.gz`, `${reference.id}.owner.json`]));
  });

  it('removes expired artifacts without touching recent results or unrelated files', async () => {
    const old = await store.save({ old: true }, 'old-job');
    const current = await store.save({ current: true }, 'current-job');
    const oldTime = new Date(Date.now() - 10 * 86400000);
    await fs.utimes(path.join(directory, `${old.id}.json.gz`), oldTime, oldTime);
    await fs.writeFile(path.join(directory, 'keep.txt'), 'keep');
    await store.cleanupExpired();
    await expect(store.read(current)).resolves.toEqual({ current: true });
    await expect(store.read(old)).rejects.toMatchObject({ status: 503 });
    expect(await fs.readdir(directory)).toContain('keep.txt');
  });

  it('keeps old reports for jobs still retained by Bull, then removes them after job removal', async () => {
    const reference = await store.save({ importedResponses: true }, 'retained-job');
    await fs.utimes(path.join(directory, `${reference.id}.json.gz`), new Date(0), new Date(0));
    exists.mockResolvedValue(1);
    await store.cleanupExpired();
    await expect(store.read(reference)).resolves.toEqual({ importedResponses: true });
    expect(exists).toHaveBeenCalledWith('uploads:retained-job');
    exists.mockResolvedValue(0);
    await store.cleanupExpired();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('preserves old reports when Redis cannot confirm that the job was removed', async () => {
    const reference = await store.save({ importedResponses: true }, 'retained-job');
    await fs.utimes(path.join(directory, `${reference.id}.json.gz`), new Date(0), new Date(0));
    exists.mockRejectedValue(new Error('Redis offline'));
    await expect(store.cleanupExpired()).rejects.toThrow('Redis offline');
    await expect(store.read(reference)).resolves.toEqual({ importedResponses: true });
  });

  it('rejects paths supplied as result IDs', async () => {
    await expect(store.read({ kind: 'stored-job-result-v1', id: '../secret' })).rejects.toMatchObject({ status: 503 });
  });
});
