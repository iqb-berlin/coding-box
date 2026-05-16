import { PassThrough, Writable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingExportController } from './workspace-coding-export.controller';
import {
  CodingExportService,
  CodingListExportService,
  CodingResultsExportService,
  CodingTimesExportService
} from '../../database/services/coding';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';

jest.mock('../../database/services/workspace/workspace-files.service', () => ({
  WorkspaceFilesService: jest.fn()
}));

const createWritableResponse = () => {
  const res = new PassThrough() as PassThrough & {
    setHeader: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
    end: jest.Mock;
    headersSent: boolean;
  };
  let headersSent = false;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.setHeader = jest.fn();
  res.status = jest.fn(() => res);
  res.json = jest.fn((body: unknown) => {
    headersSent = true;
    originalEnd(JSON.stringify(body));
    return res;
  });
  res.write = jest.fn((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    headersSent = true;
    return originalWrite(chunk, encoding as BufferEncoding, callback);
  }) as never;
  res.end = jest.fn((chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
    headersSent = true;
    return originalEnd(chunk, encoding as BufferEncoding, callback);
  }) as never;
  Object.defineProperty(res, 'headersSent', {
    get: () => headersSent
  });

  return res;
};

describe('WorkspaceCodingExportController', () => {
  it('ends the response instead of crashing when versioned CSV streaming fails', async () => {
    const csvStream = new PassThrough();
    const codingResultsExportService = {
      exportCodingResultsByVersionAsCsv: jest.fn().mockResolvedValue(csvStream)
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      codingResultsExportService as unknown as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      {} as JobQueueService,
      {} as CacheService
    );
    const res = createWritableResponse();

    const exportPromise = controller.getCodingResultsByVersion(
      5,
      'v2',
      'token',
      'http://server',
      false,
      false,
      res as never
    );
    await new Promise(resolve => {
      setImmediate(resolve);
    });

    csvStream.emit('error', new Error('Connection terminated unexpectedly'));
    await exportPromise;

    expect(codingResultsExportService.exportCodingResultsByVersionAsCsv)
      .toHaveBeenCalledWith(5, 'v2', 'token', 'http://server', false, undefined, false);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.end).toHaveBeenCalled();
  });

  it('returns application/json for downloaded JSON export jobs', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-export-json-'));
    const filePath = path.join(tempDir, 'export_1.json');
    fs.writeFileSync(filePath, '[]');

    const cacheService = {
      get: jest.fn().mockResolvedValue({
        fileId: '1',
        fileName: 'export_1.json',
        filePath,
        fileSize: 2,
        workspaceId: 5,
        userId: 2,
        exportType: 'coding-list',
        createdAt: Date.now()
      })
    };

    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      {} as JobQueueService,
      cacheService as unknown as CacheService
    );

    const res = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    }) as Writable & {
      setHeader: jest.Mock,
      status: jest.Mock,
      json: jest.Mock
    };
    res.setHeader = jest.fn();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn();

    try {
      await controller.downloadExport('1', 5, res as never);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json; charset=utf-8'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each(['json', 'xlsx'])('rejects %s format for background final result exports', async format => {
    const jobQueueService = {
      addExportJob: jest.fn()
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.startExportJob(
      5,
      { user: { id: 2 } } as never,
      {
        exportType: 'results-by-version',
        format: format as never
      }
    )).rejects.toThrow(BadRequestException);

    expect(jobQueueService.addExportJob).not.toHaveBeenCalled();
  });
});
