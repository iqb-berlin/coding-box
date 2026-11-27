import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { ResultUploadStagingService, RESULT_UPLOAD_ROOT } from './result-upload-staging.service';
import { WorkspaceTestResultsImportController } from './workspace-test-results-import.controller';

describe('chunked result upload completion', () => {
  const uploadId = randomUUID();
  const directory = path.join(RESULT_UPLOAD_ROOT, uploadId);
  const session = {
    uploadId, workspaceId: 7, resultType: 'responses', fileName: 'results.csv', mimeType: 'text/csv', fileSize: 6, tempDir: directory, totalChunks: 2, receivedChunks: [0, 1]
  };
  const cache = {
    getStrict: jest.fn(), delete: jest.fn(), generateFlatResponseFilterOptionsVersionKey: jest.fn(), incr: jest.fn()
  };
  const queue = { getWorkspaceJob: jest.fn(), addFlatResponseFilterOptionsJob: jest.fn() };
  const uploads = { uploadTestResults: jest.fn() };
  const manager = { query: jest.fn() };
  const db = { transaction: (action: (transactionManager: typeof manager) => unknown) => action(manager) };
  const staging = new ResultUploadStagingService(db as never, cache as never, queue as never);
  const controller = new WorkspaceTestResultsImportController(uploads as never, cache as never, queue as never, staging);

  beforeEach(async () => {
    jest.resetAllMocks();
    manager.query.mockResolvedValue([{ acquired: true }]);
    cache.getStrict.mockResolvedValue(session);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'chunk_000000'), 'abc');
    await fs.writeFile(path.join(directory, 'chunk_000001'), 'def');
  });
  afterEach(() => fs.rm(directory, { recursive: true, force: true }));

  it('reuses staged bytes after a conflict and returns the original receipt after acceptance', async () => {
    const receipt = [{ jobId: `upload-${uploadId}` }];
    uploads.uploadTestResults.mockRejectedValueOnce(new ConflictException()).mockResolvedValueOnce(receipt);
    await expect(controller.completeChunkedUpload(7, uploadId)).rejects.toBeInstanceOf(ConflictException);
    expect(cache.delete).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual(['merged.csv']);
    await expect(controller.completeChunkedUpload(7, uploadId)).resolves.toEqual(receipt);
    const enqueue = uploads.uploadTestResults.mock.calls[1];
    const [file] = enqueue[1];
    expect(enqueue.at(-1)(file)).toBe(receipt[0].jobId);
    expect(await fs.readFile(file.path, 'utf8')).toBe('abcdef');
    queue.getWorkspaceJob.mockResolvedValue({ id: receipt[0].jobId });
    cache.getStrict.mockResolvedValue(null);
    await fs.unlink(file.path);
    await expect(controller.completeChunkedUpload(7, uploadId)).resolves.toEqual(receipt);
    expect(queue.getWorkspaceJob).toHaveBeenLastCalledWith(7, 'test-results-upload', receipt[0].jobId);
    expect(uploads.uploadTestResults).toHaveBeenCalledTimes(2);
  });

  it('does not publish a partial file and can assemble again after a failed read', async () => {
    await fs.unlink(path.join(directory, 'chunk_000001'));
    await expect(staging.assemble(session)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(directory)).toEqual(['chunk_000000']);
    await fs.writeFile(path.join(directory, 'chunk_000001'), 'def');
    expect(await fs.readFile(await staging.assemble(session), 'utf8')).toBe('abcdef');
  });

  it('recovers the complete file from a legacy session after its chunks were removed', async () => {
    const legacyDir = await fs.mkdtemp(path.join(tmpdir(), 'legacy-result-upload-'));
    try {
      await fs.writeFile(path.join(legacyDir, 'merged.csv'), 'legacy');
      cache.getStrict.mockResolvedValue({ ...session, tempDir: legacyDir });
      await controller.completeChunkedUpload(7, uploadId);
      const [file] = uploads.uploadTestResults.mock.calls[0][1];
      expect(file.path).toBe(path.join(directory, 'merged.csv'));
      expect(await fs.readFile(file.path, 'utf8')).toBe('legacy');
    } finally {
      await fs.rm(legacyDir, { recursive: true, force: true });
    }
  });

  it('keeps the chunks and session intact while another completion owns the lock', async () => {
    manager.query.mockResolvedValueOnce([{ acquired: false }]);
    await expect(controller.completeChunkedUpload(7, uploadId)).rejects.toBeInstanceOf(ConflictException);
    expect(await fs.readdir(directory)).toEqual(['chunk_000000', 'chunk_000001']);
    expect(uploads.uploadTestResults).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('only returns a receipt to the workspace that owns the accepted job', async () => {
    cache.getStrict.mockResolvedValue(null);
    const receipt = { id: `upload-${uploadId}` };
    queue.getWorkspaceJob.mockImplementation(async workspace => (workspace === 7 ? receipt : null));
    await expect(controller.completeChunkedUpload(8, uploadId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.completeChunkedUpload(7, uploadId)).resolves.toEqual([{ jobId: receipt.id }]);
    expect(uploads.uploadTestResults).not.toHaveBeenCalled();
  });
});
