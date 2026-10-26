import { ForbiddenException } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalCodingImportProcessor } from './external-coding-import.processor';
import { ExternalCodingImportService } from '../../database/services/coding/external-coding-import.service';
import { CacheService } from '../../cache/cache.service';
import { ExternalCodingImportJobData } from '../job-queue.service';
import { createExternalCodingImportFile } from '../external-coding-import-file.util';

describe('ExternalCodingImportProcessor authorization context', () => {
  let directory: string;
  let input: string;
  const result = {
    message: 'imported', processedRows: 1, updatedRows: 1, errors: [], affectedRows: []
  };
  const service = { importExternalCoding: jest.fn() };
  const cache = { set: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service.importExternalCoding.mockResolvedValue(result);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-import-permissions-'));
    input = path.join(directory, 'input.csv');
    fs.writeFileSync(input, 'unit_key,variable_id,code\nUNIT,VAR,1\n');
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function job(requestedByUserId?: number): Job<ExternalCodingImportJobData> {
    return {
      id: 'import-1',
      data: {
        workspaceId: 17, requestedByUserId, tempFilePath: input, fileName: 'input.csv'
      },
      progress: 0,
      updateProgress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<ExternalCodingImportJobData>;
  }

  it('passes the server-recorded requester to the import service', async () => {
    const processor = new ExternalCodingImportProcessor(service as unknown as ExternalCodingImportService, cache as unknown as CacheService);
    await expect(processor.processWorkspaceJob(job(7))).resolves.toMatchObject({ updatedRows: 1 });
    expect(service.importExternalCoding).toHaveBeenCalledWith(17, expect.objectContaining({ previewOnly: false }), expect.any(Function), 7);
    expect(fs.existsSync(input)).toBe(false);
    expect(cache.set).toHaveBeenCalled();
  });

  it.each([7, undefined])('fails and cleans up when current authorization rejects requester %s', async actor => {
    service.importExternalCoding.mockRejectedValue(new ForbiddenException('Apply access revoked or missing'));
    const processor = new ExternalCodingImportProcessor(service as unknown as ExternalCodingImportService, cache as unknown as CacheService);
    await expect(processor.processWorkspaceJob(job(actor))).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.importExternalCoding).toHaveBeenCalledWith(17, expect.any(Object), expect.any(Function), actor);
    expect(cache.set).not.toHaveBeenCalled();
    expect(fs.existsSync(input)).toBe(false);
  });

  it.each([true, false])('removes private staged files and directories after success=%s', async success => {
    input = createExternalCodingImportFile(Buffer.from('unit_key,variable_id,code\nUNIT,VAR,1\n'));
    const stagedDirectory = path.dirname(input);
    if (!success) service.importExternalCoding.mockRejectedValue(new Error('Import failed'));
    const processor = new ExternalCodingImportProcessor(service as unknown as ExternalCodingImportService, cache as unknown as CacheService);
    try {
      if (success) await expect(processor.processWorkspaceJob(job(7))).resolves.toMatchObject({ updatedRows: 1 });
      else await expect(processor.processWorkspaceJob(job(7))).rejects.toThrow('Import failed');
      expect(fs.existsSync(stagedDirectory)).toBe(false);
    } finally {
      fs.rmSync(stagedDirectory, { recursive: true, force: true });
    }
  });
});
