import { Job } from 'bull';
import * as fs from 'fs';
import { PassThrough, Readable } from 'stream';
import { CodingExportOrchestratorService, CodingExportService } from '../../database/services/coding';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { CacheService } from '../../cache/cache.service';
import { ExportJobData, JobQueueService } from '../job-queue.service';
import { ExportJobProcessor } from './export-job.processor';

jest.mock('../../database/services/coding', () => ({
  CodingExportOrchestratorService: jest.fn(),
  CodingExportService: jest.fn()
}));
jest.mock('../../database/services/test-results', () => ({
  WorkspaceTestResultsService: jest.fn()
}));

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
      exportCodingListForJobAsJson: jest.fn(),
      exportCodingResultsByVariableCompactAsCsvStream: jest.fn()
    };
    const codingExportOrchestratorService = {
      exportResultsByVersionAsCsv: jest.fn(),
      exportResultsByVersionAsExcel: jest.fn(),
      exportDetailed: jest.fn(),
      exportItemMatrixAsCsv: jest.fn(),
      exportItemMatrixAsExcel: jest.fn()
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(undefined)
    };
    const jobQueueService = {
      isExportJobCancelled: jest.fn().mockResolvedValue(false),
      createExportJobCancellationSignal: jest.fn(() => new AbortController().signal),
      clearExportJobCancellationSignal: jest.fn()
    };

    const processor = new ExportJobProcessor(
      codingExportService as unknown as CodingExportService,
      codingExportOrchestratorService as unknown as CodingExportOrchestratorService,
      {} as WorkspaceTestResultsService,
      cacheService as unknown as CacheService,
      jobQueueService as unknown as JobQueueService
    );

    return {
      processor,
      codingExportService,
      codingExportOrchestratorService,
      cacheService,
      jobQueueService
    };
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
        true,
        expect.any(Function)
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
        false,
        expect.any(Function)
      );
      expect(result.fileName).toMatch(/\.json$/);
    } finally {
      cleanup(filePath);
    }
  });

  it('defaults final result exports to v2 CSV when no version or format is provided', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    codingExportOrchestratorService.exportResultsByVersionAsCsv.mockResolvedValue(Readable.from(['csv']));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        exportType: 'results-by-version',
        includeReplayUrl: true,
        includeResponseValues: true,
        authToken: 'auth-token',
        serverUrl: 'http://app.example'
      }));
      filePath = result.filePath;

      expect(codingExportOrchestratorService.exportResultsByVersionAsCsv).toHaveBeenCalledWith({
        workspaceId: 7,
        version: 'v2',
        authToken: 'auth-token',
        serverUrl: 'http://app.example',
        includeReplayUrl: true,
        onProgress: expect.any(Function),
        includeResponseValues: true,
        includeGeoGebraResponseValues: false,
        checkCancellation: expect.any(Function)
      });
      expect(result.fileName).toMatch(/\.csv$/);
      expect(filePath).toBeDefined();
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('\uFEFFcsv');
    } finally {
      cleanup(filePath);
    }
  });

  it('aborts stream writing when an export job is cancelled while streaming', async () => {
    jest.useFakeTimers();
    const {
      processor,
      codingExportOrchestratorService,
      cacheService,
      jobQueueService
    } = createProcessor();
    const stream = new PassThrough();
    codingExportOrchestratorService.exportResultsByVersionAsCsv.mockResolvedValue(stream);
    jobQueueService.isExportJobCancelled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const processPromise = expect(processor.process(createJob({
      exportType: 'results-by-version',
      version: 'v2',
      format: 'csv'
    }))).rejects.toThrow('Export job job-1 was cancelled');

    try {
      await jest.advanceTimersByTimeAsync(1000);

      await processPromise;
      expect(codingExportOrchestratorService.exportResultsByVersionAsCsv).toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('aborts stream writing immediately when the local cancellation signal fires', async () => {
    const {
      processor,
      codingExportOrchestratorService,
      cacheService,
      jobQueueService
    } = createProcessor();
    const controller = new AbortController();
    const stream = new PassThrough();
    codingExportOrchestratorService.exportResultsByVersionAsCsv.mockResolvedValue(stream);
    jobQueueService.createExportJobCancellationSignal.mockReturnValue(controller.signal);
    jobQueueService.isExportJobCancelled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const processPromise = expect(processor.process(createJob({
      exportType: 'results-by-version',
      version: 'v2',
      format: 'csv'
    }))).rejects.toThrow('Export job job-1 was cancelled');

    await new Promise(resolve => {
      setImmediate(resolve);
    });
    controller.abort();

    await processPromise;
    expect(codingExportOrchestratorService.exportResultsByVersionAsCsv).toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
    expect(jobQueueService.clearExportJobCancellationSignal).toHaveBeenCalledWith('job-1');
  });

  it('uses ZIP extension for final result GeoGebra package exports', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    codingExportOrchestratorService.exportResultsByVersionAsExcel.mockResolvedValue(Buffer.from('zip'));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        exportType: 'results-by-version',
        version: 'v2',
        format: 'excel',
        includeReplayUrl: true,
        includeResponseValues: true,
        includeGeoGebraFiles: true,
        authToken: 'auth-token',
        serverUrl: 'http://app.example'
      }));
      filePath = result.filePath;

      expect(codingExportOrchestratorService.exportResultsByVersionAsExcel).toHaveBeenCalledWith({
        workspaceId: 7,
        version: 'v2',
        authToken: 'auth-token',
        serverUrl: 'http://app.example',
        includeReplayUrl: true,
        onProgress: expect.any(Function),
        includeResponseValues: true,
        includeGeoGebraResponseValues: false,
        includeGeoGebraFiles: true,
        checkCancellation: expect.any(Function)
      });
      expect(result.fileName).toMatch(/\.zip$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('zip');
    } finally {
      cleanup(filePath);
    }
  });

  it('routes item matrix CSV exports through the orchestrator', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    codingExportOrchestratorService.exportItemMatrixAsCsv.mockResolvedValue(Readable.from(['matrix']));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        exportType: 'item-matrix',
        version: 'v2',
        format: 'csv',
        matrixValue: 'score'
      }));
      filePath = result.filePath;

      expect(codingExportOrchestratorService.exportItemMatrixAsCsv).toHaveBeenCalledWith({
        workspaceId: 7,
        matrixValue: 'score',
        version: 'v2',
        onProgress: expect.any(Function),
        checkCancellation: expect.any(Function)
      });
      expect(result.fileName).toMatch(/\.csv$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('\uFEFFmatrix');
    } finally {
      cleanup(filePath);
    }
  });

  it('routes item matrix Excel exports through the orchestrator', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    codingExportOrchestratorService.exportItemMatrixAsExcel.mockResolvedValue(Buffer.from('xlsx'));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        exportType: 'item-matrix',
        version: 'v3',
        format: 'excel',
        matrixValue: 'code'
      }));
      filePath = result.filePath;

      expect(codingExportOrchestratorService.exportItemMatrixAsExcel).toHaveBeenCalledWith({
        workspaceId: 7,
        matrixValue: 'code',
        version: 'v3',
        onProgress: expect.any(Function),
        checkCancellation: expect.any(Function)
      });
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('xlsx');
    } finally {
      cleanup(filePath);
    }
  });

  it('rejects invalid item matrix versions before exporting', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();

    await expect(processor.process(createJob({
      exportType: 'item-matrix',
      version: 'v4' as never,
      format: 'csv',
      matrixValue: 'score'
    }))).rejects.toThrow('item-matrix exports support only "v1", "v2" or "v3" versions');

    expect(codingExportOrchestratorService.exportItemMatrixAsCsv).not.toHaveBeenCalled();
    expect(codingExportOrchestratorService.exportItemMatrixAsExcel).not.toHaveBeenCalled();
  });

  it('rejects GeoGebra package exports without response values', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();

    await expect(processor.process(createJob({
      exportType: 'results-by-version',
      format: 'excel',
      includeResponseValues: false,
      includeGeoGebraFiles: true
    }))).rejects.toThrow('GeoGebra file packages require response values');

    expect(codingExportOrchestratorService.exportResultsByVersionAsExcel).not.toHaveBeenCalled();
  });

  it('routes detailed export jobs through the orchestrator', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    codingExportOrchestratorService.exportDetailed.mockResolvedValue(Buffer.from('csv'));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        exportType: 'detailed',
        outputCommentsInsteadOfCodes: true,
        includeReplayUrl: true,
        anonymizeCoders: true,
        usePseudoCoders: false,
        excludeAutoCoded: true,
        authToken: 'auth-token',
        serverUrl: 'http://app.example',
        jobDefinitionIds: [1],
        coderTrainingIds: [2],
        coderIds: [3]
      }));
      filePath = result.filePath;

      expect(codingExportOrchestratorService.exportDetailed).toHaveBeenCalledWith({
        workspaceId: 7,
        outputCommentsInsteadOfCodes: true,
        includeReplayUrl: true,
        anonymizeCoders: true,
        usePseudoCoders: false,
        authToken: 'auth-token',
        excludeAutoCoded: true,
        checkCancellation: expect.any(Function),
        jobDefinitionIds: [1],
        coderTrainingIds: [2],
        coderIds: [3],
        serverUrl: 'http://app.example'
      });
      expect(result.fileName).toMatch(/\.csv$/);
    } finally {
      cleanup(filePath);
    }
  });

  it('routes compact by-variable export jobs to CSV generation', async () => {
    const { processor, codingExportService } = createProcessor();
    codingExportService.exportCodingResultsByVariableCompactAsCsvStream.mockReturnValue(Readable.from(['csv']));
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({
        exportType: 'by-variable-compact',
        includeModalValue: true,
        includeDoubleCoded: true,
        includeComments: true,
        outputCommentsInsteadOfCodes: false,
        includeReplayUrl: true,
        anonymizeCoders: true,
        usePseudoCoders: true,
        excludeAutoCoded: true,
        authToken: 'auth-token',
        serverUrl: 'http://app.example',
        jobDefinitionIds: [1],
        coderTrainingIds: [2],
        coderIds: [3]
      }));
      filePath = result.filePath;

      expect(codingExportService.exportCodingResultsByVariableCompactAsCsvStream).toHaveBeenCalledWith(
        7,
        true,
        true,
        true,
        false,
        true,
        true,
        true,
        'auth-token',
        undefined,
        true,
        expect.any(Function),
        [1],
        [2],
        [3],
        'http://app.example'
      );
      expect(result.fileName).toMatch(/\.csv$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('\uFEFFcsv');
    } finally {
      cleanup(filePath);
    }
  });

  it.each(['json', 'xlsx'])('rejects %s format for final result exports', async format => {
    const { processor, codingExportOrchestratorService } = createProcessor();

    await expect(processor.process(createJob({
      exportType: 'results-by-version',
      format: format as never
    }))).rejects.toThrow('results-by-version exports support only "csv" or "excel" format');

    expect(codingExportOrchestratorService.exportResultsByVersionAsCsv).not.toHaveBeenCalled();
    expect(codingExportOrchestratorService.exportResultsByVersionAsExcel).not.toHaveBeenCalled();
  });
});
