import 'reflect-metadata';
import { PassThrough, Writable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WorkspaceCodingExportController } from './workspace-coding-export.controller';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard } from './access-level.guard';
import {
  CodingExportService,
  CodingExportOrchestratorService,
  CodingListExportService
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
      {} as CodingExportService,
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
        includeResponseValues: false,
        includeGeoGebraResponseValues: false
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
      {} as CodingExportService,
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
      {} as CodingExportService,
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

  it('rejects invalid item matrix versions before starting a background export job', async () => {
    const jobQueueService = {
      addExportJob: jest.fn()
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.startExportJob(
      5,
      { user: { id: 2 } } as never,
      {
        exportType: 'item-matrix',
        version: 'v4' as never
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
      {} as CodingExportService,
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

  it('uses the streaming-capable export service for direct by-coder exports', async () => {
    const codingExportService = {
      exportCodingResultsByCoder: jest.fn().mockResolvedValue(Buffer.from('xlsx'))
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService
    );
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const request = {};

    await controller.exportCodingResultsByCoder(
      5,
      response as never,
      request as never,
      'true',
      'true',
      'token',
      'true',
      'false',
      'true'
    );

    expect(codingExportService.exportCodingResultsByCoder).toHaveBeenCalledWith(
      5,
      true,
      true,
      true,
      false,
      'token',
      request,
      true
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('xlsx'));
  });

  it('uses the streaming-capable export service for direct coding-times exports', async () => {
    const codingExportService = {
      exportCodingTimesReport: jest.fn().mockResolvedValue(Buffer.from('xlsx'))
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService
    );
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCodingTimesReport(
      5,
      response as never,
      'true',
      'false',
      'true'
    );

    expect(codingExportService.exportCodingTimesReport).toHaveBeenCalledWith(
      5,
      true,
      false,
      true
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('xlsx'));
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
      codingExportService as unknown as CodingExportService,
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
      codingExportService as unknown as CodingExportService,
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
      codingExportService as unknown as CodingExportService,
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
      {} as CodingExportService,
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
      {} as CodingExportService,
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

  it('normalizes structured export progress details in job status', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5 },
        getState: jest.fn().mockResolvedValue('active'),
        progress: jest.fn().mockResolvedValue({
          percentage: 57.4,
          phase: 'writing',
          processedRows: 5820,
          totalRows: 10922,
          message: 'Rows are being written'
        })
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'processing',
      progress: 57,
      progressPhase: 'writing',
      processedRows: 5820,
      totalRows: 10922,
      progressMessage: 'Rows are being written'
    });
  });

  it('reports cancellation-marked export jobs as cancelled', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, isCancelled: true },
        getState: jest.fn().mockResolvedValue('active'),
        progress: jest.fn().mockResolvedValue(55)
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'cancelled',
      progress: 55
    });
  });

  it('reports completed cancellation-marked export jobs as cancelled without result metadata', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, isCancelled: true },
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockResolvedValue(21),
        returnvalue: {
          fileId: 'job-1',
          fileName: '',
          filePath: '',
          fileSize: 0,
          workspaceId: 5,
          userId: 2,
          exportType: 'results-by-version',
          createdAt: 123
        }
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'cancelled',
      progress: 21
    });
  });

  it('reports failed export jobs caused by cancellation as cancelled', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5 },
        getState: jest.fn().mockResolvedValue('failed'),
        progress: jest.fn().mockResolvedValue(20),
        failedReason: 'Export job job-1 was cancelled'
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'cancelled',
      progress: 20
    });
  });

  it('maps cancelled export jobs consistently in the job list', async () => {
    const jobQueueService = {
      getExportJobs: jest.fn().mockResolvedValue([
        {
          id: 'active-cancelled',
          data: { workspaceId: 5, exportType: 'coding-list', isCancelled: true },
          timestamp: 100,
          getState: jest.fn().mockResolvedValue('active'),
          progress: jest.fn().mockResolvedValue(55)
        },
        {
          id: 'failed-cancelled',
          data: { workspaceId: 5, exportType: 'detailed' },
          timestamp: 101,
          failedReason: 'Export job failed-cancelled was cancelled',
          getState: jest.fn().mockResolvedValue('failed'),
          progress: jest.fn().mockResolvedValue(20)
        },
        {
          id: 'waiting-job',
          data: { workspaceId: 5, exportType: 'by-variable' },
          timestamp: 102,
          getState: jest.fn().mockResolvedValue('waiting'),
          progress: jest.fn().mockResolvedValue(0)
        }
      ])
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobs(5)).resolves.toEqual([
      {
        jobId: 'active-cancelled',
        status: 'cancelled',
        progress: 55,
        exportType: 'coding-list',
        createdAt: 100
      },
      {
        jobId: 'failed-cancelled',
        status: 'cancelled',
        progress: 20,
        exportType: 'detailed',
        createdAt: 101
      },
      {
        jobId: 'waiting-job',
        status: 'pending',
        progress: 0,
        exportType: 'by-variable',
        createdAt: 102
      }
    ]);
  });

  it('does not clean up cached export metadata when cancelling coding export jobs', async () => {
    const job = {
      data: { workspaceId: 5 },
      getState: jest.fn().mockResolvedValue('active')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(false)
    };
    const cacheService = {
      get: jest.fn(),
      delete: jest.fn()
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: true,
      message: 'Export job cancellation requested (job will stop at next checkpoint)'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('allows cancelling a job that already failed because of cancellation', async () => {
    const job = {
      data: { workspaceId: 5, isCancelled: true },
      getState: jest.fn().mockResolvedValue('failed')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(true)
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: true,
      message: 'Export job cancelled successfully'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
  });

  it('does not report coding export cancellation as successful when queue cancellation was not accepted', async () => {
    const job = {
      data: { workspaceId: 5 },
      getState: jest.fn().mockResolvedValue('active')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(false),
      cancelExportJob: jest.fn().mockResolvedValue(false)
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: false,
      message: 'Export job cancellation could not be requested'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
  });

  it('reports coding export cancellation as successful when cancellation completes during the request', async () => {
    const job = {
      data: { workspaceId: 5 },
      getState: jest.fn()
        .mockResolvedValueOnce('active')
        .mockResolvedValueOnce('completed')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(true)
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: true,
      message: 'Export job cancellation requested (job will stop at next checkpoint)'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith('job-1');
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
  });

  it('rejects export job status access for jobs from another workspace', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 9 }
      })
    };
    const controller = new WorkspaceCodingExportController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      error: 'Access denied to this export'
    });
  });

  it('requires coding-manager access at controller level', () => {
    expect(Reflect.getMetadata(
      'accessLevel',
      WorkspaceCodingExportController
    )).toBe(2);
  });

  it.each([
    'getCodingListAsCsv',
    'getCodingListAsExcel',
    'getCodingListAsJson',
    'getCodingResultsByVersion',
    'getCodingResultsByVersionAsExcel',
    'exportCodingResultsAggregated',
    'exportCodingResultsByCoder',
    'exportCodingResultsByVariable',
    'exportCodingResultsDetailed',
    'exportCodingTimesReport',
    'estimateExportJob',
    'startExportJob',
    'getExportJobStatus',
    'downloadExport',
    'getExportJobs',
    'deleteExportJob',
    'cancelExportJob'
  ] as const)('uses access-level guard for %s', methodName => {
    const handler = WorkspaceCodingExportController.prototype[methodName];

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      WorkspaceGuard,
      AccessLevelGuard
    ]);
  });
});
