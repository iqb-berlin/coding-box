import { Writable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceCodingExportController } from './workspace-coding-export.controller';
import { CodingListExportService, CodingResultsExportService, CodingTimesExportService } from '../../database/services/coding';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';

describe('WorkspaceCodingExportController', () => {
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
});
