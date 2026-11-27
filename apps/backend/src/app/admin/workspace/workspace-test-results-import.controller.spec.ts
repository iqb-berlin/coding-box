import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  mkdtemp, readFile, readdir, rm, writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceTestResultsImportController } from './workspace-test-results-import.controller';

describe('chunked upload completion', () => {
  let directory: string;
  const session = {
    workspaceId: 7, totalChunks: 2, receivedChunks: [1, 0], fileSize: 5, tempDir: '', resultType: 'responses'
  };
  const jobId = 'chunked-upload-session';
  const upload = { uploadTestResults: jest.fn() };
  const jobs = { getUploadJob: jest.fn(), addFlatResponseFilterOptionsJob: jest.fn() };
  const cache = {
    getStrict: jest.fn(),
    delete: jest.fn(),
    acquireShortLock: jest.fn(),
    getAndDeleteIfFieldMatches: jest.fn(),
    generateFlatResponseFilterOptionsVersionKey: jest.fn(),
    incr: jest.fn()
  };
  const controller = new WorkspaceTestResultsImportController(upload as never, cache as never, jobs as never);

  beforeEach(async () => {
    jest.resetAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'upload-retry-'));
    await writeFile(join(directory, 'chunk_000000'), 'abc');
    await writeFile(join(directory, 'chunk_000001'), 'de');
    cache.getStrict.mockResolvedValue({ ...session, tempDir: directory });
    cache.acquireShortLock.mockResolvedValue(true);
    jobs.getUploadJob.mockResolvedValue(null);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('retries the same upload after a queue conflict and returns the accepted job on subsequent completion', async () => {
    upload.uploadTestResults.mockRejectedValueOnce(new ConflictException()).mockResolvedValue([{ jobId }]);
    await expect(controller.completeChunkedUpload(7, 'session')).rejects.toBeInstanceOf(ConflictException);
    expect(await readFile(join(directory, 'chunk_000000'), 'utf8')).toBe('abc');
    expect(cache.delete).not.toHaveBeenCalled();
    expect(cache.getAndDeleteIfFieldMatches).toHaveBeenCalledTimes(1);

    await expect(controller.completeChunkedUpload(7, 'session')).resolves.toEqual([{ jobId }]);
    expect(upload.uploadTestResults.mock.lastCall?.at(-1)).toBe(jobId);
    expect(await readdir(directory)).toEqual(['merged.csv']);
    expect(await readFile(join(directory, 'merged.csv'), 'utf8')).toBe('abcde');
    cache.getStrict.mockResolvedValue(null);
    jobs.getUploadJob.mockResolvedValue({ data: { workspaceId: 7 } });
    await expect(controller.completeChunkedUpload(7, 'session')).resolves.toEqual([{ jobId }]);
    await expect(controller.completeChunkedUpload(8, 'session')).rejects.toBeInstanceOf(NotFoundException);
    expect(upload.uploadTestResults).toHaveBeenCalledTimes(2);
  });

  it('recovers an assembled upload left by an earlier version after its chunks were removed', async () => {
    await writeFile(join(directory, 'merged.csv'), 'abcde');
    await Promise.all(['chunk_000000', 'chunk_000001'].map(name => rm(join(directory, name))));
    upload.uploadTestResults.mockResolvedValue([{ jobId }]);
    await expect(controller.completeChunkedUpload(7, 'session')).resolves.toEqual([{ jobId }]);
    expect(await readFile(join(directory, 'merged.csv'), 'utf8')).toBe('abcde');
  });

  it('leaves the parts retryable if assembly fails or another completion owns the session', async () => {
    cache.acquireShortLock.mockResolvedValueOnce(false);
    await expect(controller.completeChunkedUpload(7, 'session')).rejects.toBeInstanceOf(ConflictException);
    await rm(join(directory, 'chunk_000001'));
    await expect(controller.completeChunkedUpload(7, 'session')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(directory)).toEqual(['chunk_000000']);
    expect(upload.uploadTestResults).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });
});
