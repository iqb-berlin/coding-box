import { PassThrough, Writable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingExportController } from './workspace-coding-export.controller';
import {
  CodingExportService,
  CodingExportOrchestratorService,
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
    const codingExportOrchestratorService = {
      exportResultsByVersionAsCsv: jest.fn().mockResolvedValue(csvStream)
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      codingExportOrchestratorService as unknown as CodingExportOrchestratorService,
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

    expect(codingExportOrchestratorService.exportResultsByVersionAsCsv)
      .toHaveBeenCalledWith({
        workspaceId: 5,
        version: 'v2',
        authToken: 'token',
        serverUrl: 'http://server',
        includeReplayUrl: false,
        includeResponseValues: false
      });
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
      {} as CodingExportOrchestratorService,
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
      {} as CodingExportOrchestratorService,
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

  it('normalizes authenticated user IDs before starting background export jobs', async () => {
    const jobQueueService = {
      addExportJob: jest.fn().mockResolvedValue({ id: 'job-1' })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.startExportJob(
      5,
      { user: { id: '2' } } as never,
      {
        exportType: 'detailed'
      }
    )).resolves.toEqual({
      jobId: 'job-1',
      message: 'Export job created successfully. Job ID: job-1'
    });

    expect(jobQueueService.addExportJob).toHaveBeenCalledWith({
      exportType: 'detailed',
      workspaceId: 5,
      userId: 2
    });
  });

  it('estimates by-variable export sizes before starting a background job', async () => {
    const codingExportService = {
      estimateCodingResultsByVariableExport: jest.fn().mockResolvedValue({
        exportType: 'by-variable',
        unitVariableCount: 2578,
        worksheetLimit: 1000,
        exceedsWorksheetLimit: true
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService
    );

    await expect(controller.estimateExportJob(
      5,
      {
        exportType: 'by-variable',
        excludeAutoCoded: true,
        jobDefinitionIds: [1],
        coderTrainingIds: [2],
        coderIds: [3]
      }
    )).resolves.toEqual({
      exportType: 'by-variable',
      unitVariableCount: 2578,
      worksheetLimit: 1000,
      exceedsWorksheetLimit: true
    });

    expect(codingExportService.estimateCodingResultsByVariableExport).toHaveBeenCalledWith(
      5,
      'by-variable',
      true,
      [1],
      [2],
      [3]
    );
  });

  it('does not apply the worksheet limit flag to compact by-variable estimates', async () => {
    const codingExportService = {
      estimateCodingResultsByVariableExport: jest.fn().mockResolvedValue({
        exportType: 'by-variable-compact',
        unitVariableCount: 2578,
        worksheetLimit: null,
        exceedsWorksheetLimit: false
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService
    );

    await expect(controller.estimateExportJob(
      5,
      {
        exportType: 'by-variable-compact'
      }
    )).resolves.toEqual({
      exportType: 'by-variable-compact',
      unitVariableCount: 2578,
      worksheetLimit: null,
      exceedsWorksheetLimit: false
    });

    expect(codingExportService.estimateCodingResultsByVariableExport).toHaveBeenCalledWith(
      5,
      'by-variable-compact',
      false,
      undefined,
      undefined,
      undefined
    );
  });

  it('rejects export estimates for unsupported export types', async () => {
    const codingExportService = {
      estimateCodingResultsByVariableExport: jest.fn()
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService
    );

    await expect(controller.estimateExportJob(
      5,
      {
        exportType: 'detailed'
      }
    )).rejects.toThrow(BadRequestException);

    expect(codingExportService.estimateCodingResultsByVariableExport).not.toHaveBeenCalled();
  });

  it('does not expose internal file paths in export job status results', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5 },
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockResolvedValue(100),
        returnvalue: {
          fileId: 'job-1',
          fileName: 'export_job-1.csv',
          filePath: '/server/temp/export_job-1.csv',
          fileSize: 128,
          workspaceId: 5,
          userId: 2,
          exportType: 'detailed',
          createdAt: 123
        }
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    const status = await controller.getExportJobStatus(5, 'job-1');

    expect(status).toEqual({
      status: 'completed',
      progress: 100,
      result: {
        fileId: 'job-1',
        fileName: 'export_job-1.csv',
        fileSize: 128,
        workspaceId: 5,
        userId: 2,
        exportType: 'detailed',
        createdAt: 123
      }
    });
    expect(JSON.stringify(status)).not.toContain('filePath');
  });

  it('adds structured details for worksheet limit failures in export job status', async () => {
    const failedReason = 'Der Export enthaelt 2578 Unit-Variable-Kombinationen und ueberschreitet das konfigurierte Limit von 1000 Tabellenblaettern.';
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5 },
        getState: jest.fn().mockResolvedValue('failed'),
        progress: jest.fn().mockResolvedValue(20),
        failedReason
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'failed',
      progress: 20,
      error: failedReason,
      errorCode: 'EXPORT_TOO_MANY_WORKSHEETS',
      errorDetails: {
        actual: 2578,
        max: 1000
      }
    });
  });

  it('rejects export job status access for jobs from another workspace', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 9 }
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingResultsExportService,
      {} as CodingExportService,
      {} as CodingTimesExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      error: 'Access denied to this export'
    });
  });
});
