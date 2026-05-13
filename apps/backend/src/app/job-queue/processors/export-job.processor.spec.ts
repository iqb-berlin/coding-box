import { Job } from 'bull';
import * as fs from 'fs';
import { Readable } from 'stream';
import { CodingExportService } from '../../database/services/coding';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { CacheService } from '../../cache/cache.service';
import { ExportJobData, JobQueueService } from '../job-queue.service';
import { ExportJobProcessor } from './export-job.processor';

describe('ExportJobProcessor', () => {
  const createJob = (data: Partial<ExportJobData>): Job<ExportJobData> => ({
    id: 'job-1',
    data: {
      workspaceId: 7,
      userId: 3,
      exportType: 'coding-list',
      ...data
    } as ExportJobData,
    progress: jest.fn().mockResolvedValue(undefined)
  } as unknown as Job<ExportJobData>);

  const createProcessor = () => {
    const codingExportService = {
      exportCodingListForJobAsExcel: jest.fn(),
      exportCodingListForJobAsJson: jest.fn()
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(undefined)
    };
    const jobQueueService = {
      isExportJobCancelled: jest.fn().mockResolvedValue(false)
    };

    const processor = new ExportJobProcessor(
      codingExportService as unknown as CodingExportService,
      {} as WorkspaceTestResultsService,
      cacheService as unknown as CacheService,
      jobQueueService as unknown as JobQueueService
    );

    return { processor, codingExportService, cacheService };
  };

  const cleanup = (filePath?: string): void => {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  };

  it('passes trainingRequired to coding-list Excel exports', async () => {
    const { processor, codingExportService, cacheService } = createProcessor();
    codingExportService.exportCodingListForJobAsExcel.mockResolvedValue(Buffer.from('xlsx'));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        format: 'excel',
        trainingRequired: true,
        authToken: 'auth-token',
        serverUrl: 'http://app.example'
      }));
      filePath = result.filePath;

      expect(codingExportService.exportCodingListForJobAsExcel).toHaveBeenCalledWith(
        7,
        'auth-token',
        'http://app.example',
        expect.any(Function),
        true
      );
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(cacheService.set).toHaveBeenCalledWith(
        'export-result:job-1',
        expect.objectContaining({ exportType: 'coding-list' }),
        3600
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('keeps JSON extension for coding-list JSON exports', async () => {
    const { processor, codingExportService } = createProcessor();
    codingExportService.exportCodingListForJobAsJson.mockResolvedValue(Readable.from(['[]']));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        format: 'json',
        trainingRequired: false
      }));
      filePath = result.filePath;

      expect(codingExportService.exportCodingListForJobAsJson).toHaveBeenCalledWith(
        7,
        '',
        '',
        expect.any(Function),
        false
      );
      expect(result.fileName).toMatch(/\.json$/);
    } finally {
      cleanup(filePath);
    }
  });
});
