import { Job } from 'bull';
import AdmZip = require('adm-zip');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Readable } from 'stream';
import {
  CodingExportOrchestratorService,
  CodingExportService,
  CodingPsychometricExportService,
  ExportJobClientLeaseService
} from '../../database/services/coding';
import {
  ExportArtifactService
} from '../../database/services/coding/export-artifact.service';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { CacheService } from '../../cache/cache.service';
import { ExportJobData, JobQueueService } from '../job-queue.service';
import { ExportJobProcessor } from './export-job.processor';

jest.mock('../../database/services/coding', () => ({
  CodingExportOrchestratorService: jest.fn(),
  CodingExportService: jest.fn(),
  CodingPsychometricExportService: jest.fn(),
  ExportJobClientLeaseService: jest.fn()
}));
jest.mock('../../database/services/test-results', () => ({
  WorkspaceTestResultsService: jest.fn()
}));

describe('ExportJobProcessor', () => {
  const noItemMatrixDiagnostics = {
    total: 0,
    sampleLimit: 20,
    groups: []
  };
  const createJob = (data: Partial<ExportJobData>): Job<ExportJobData> => {
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 7,
        userId: 3,
        exportType: 'coding-list',
        ...data
      } as ExportJobData,
      progress: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockImplementation(async updatedData => {
        job.data = updatedData;
      })
    };
    return job as unknown as Job<ExportJobData>;
  };

  const createProcessor = () => {
    const codingExportService = {
      exportCodingListForJobAsExcel: jest.fn(),
      exportCodingListForJobAsExcelToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'xlsx')
      ),
      exportCodingListForJobAsJson: jest.fn(),
      exportCodingResultsAggregatedToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'aggregated')
      ),
      exportCodingResultsByCoderToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'by-coder')
      ),
      exportCodingResultsByVariableToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'by-variable')
      ),
      exportCodingTimesReportToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'coding-times')
      ),
      exportCodingResultsByVariableCompactAsCsvStream: jest.fn()
    };
    const exportJobClientLeaseService = {
      isLeaseActive: jest.fn().mockResolvedValue(true),
      releaseLease: jest.fn().mockResolvedValue(undefined)
    };
    const codingExportOrchestratorService = {
      exportResultsByVersionAsCsv: jest.fn(),
      exportResultsByVersionAsExcel: jest.fn(),
      exportResultsByVersionAsExcelToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'xlsx')
      ),
      exportDetailed: jest.fn(),
      exportDetailedToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'csv')
      ),
      exportItemMatrixAsCsv: jest.fn(),
      exportItemMatrixAsCsvToFile: jest.fn(async (filePath: string) => {
        await fs.promises.writeFile(filePath, 'matrix');
        return noItemMatrixDiagnostics;
      }),
      exportItemMatrixAsExcel: jest.fn(),
      exportItemMatrixAsExcelToFile: jest.fn(async (filePath: string) => {
        await fs.promises.writeFile(filePath, 'xlsx');
        return noItemMatrixDiagnostics;
      })
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true)
    };
    const jobQueueService = {
      isExportJobCancelled: jest.fn().mockResolvedValue(false),
      createExportJobCancellationSignal: jest.fn(
        () => new AbortController().signal
      ),
      clearExportJobCancellationSignal: jest.fn()
    };

    const codingPsychometricExportService = {
      exportPsychometricsAsCsv: jest.fn(),
      writePsychometricsExcelToFile: jest.fn((filePath: string) => fs.promises.writeFile(filePath, 'psychometrics')
      )
    };

    const processor = new ExportJobProcessor(
      codingExportService as unknown as CodingExportService,
      codingExportOrchestratorService as unknown as CodingExportOrchestratorService,
      {} as WorkspaceTestResultsService,
      cacheService as unknown as CacheService,
      jobQueueService as unknown as JobQueueService,
      codingPsychometricExportService as unknown as CodingPsychometricExportService,
      new ExportArtifactService(
        cacheService as unknown as CacheService
      ),
      exportJobClientLeaseService as unknown as ExportJobClientLeaseService
    );

    return {
      processor,
      codingExportService,
      codingExportOrchestratorService,
      cacheService,
      jobQueueService,
      codingPsychometricExportService,
      exportJobClientLeaseService
    };
  };

  const cleanup = (filePath?: string): void => {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  };

  it('removes expired export files and orphaned working directories periodically', async () => {
    jest.useFakeTimers();
    const { processor, cacheService } = createProcessor();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-cleanup-'));
    const firstExpiredPath = path.join(
      tempDir,
      'export_job-1_1000-incomplete.zip'
    );
    const secondExpiredPath = path.join(tempDir, 'export_job-2_2000.csv');
    const freshPath = path.join(tempDir, 'export_job-3_3000.xlsx');
    const activeWorkingDirectory = path.join(
      tempDir,
      '.export-working-active-job'
    );
    const activeWorkingPath = path.join(
      activeWorkingDirectory,
      'export_job-active_4000.xlsx'
    );
    const orphanedWorkingDirectory = path.join(
      tempDir,
      '.export-working-orphaned-job'
    );
    const orphanedWorkingPath = path.join(
      orphanedWorkingDirectory,
      'export_job-orphaned_5000.csv'
    );
    const expiredTime = new Date(Date.now() - 3601 * 1000);
    jest
      .spyOn(
        processor as never as { getExportTempDir: () => string },
        'getExportTempDir'
      )
      .mockReturnValue(tempDir);

    try {
      fs.writeFileSync(firstExpiredPath, 'expired');
      fs.writeFileSync(freshPath, 'fresh');
      fs.mkdirSync(activeWorkingDirectory);
      fs.writeFileSync(activeWorkingPath, 'active');
      fs.mkdirSync(orphanedWorkingDirectory);
      fs.writeFileSync(orphanedWorkingPath, 'orphaned');
      fs.utimesSync(firstExpiredPath, expiredTime, expiredTime);
      fs.utimesSync(activeWorkingPath, expiredTime, expiredTime);
      fs.utimesSync(activeWorkingDirectory, expiredTime, expiredTime);
      fs.utimesSync(orphanedWorkingPath, expiredTime, expiredTime);
      fs.utimesSync(orphanedWorkingDirectory, expiredTime, expiredTime);
      cacheService.get.mockImplementation((key: string) => Promise.resolve(
        key.includes('.export-working-active-job') ?
          { jobId: 'active-job' } :
          null
      ));

      await processor.onModuleInit();

      expect(fs.existsSync(firstExpiredPath)).toBe(false);
      expect(fs.existsSync(freshPath)).toBe(true);
      expect(fs.existsSync(activeWorkingPath)).toBe(true);
      expect(fs.existsSync(orphanedWorkingDirectory)).toBe(false);

      fs.writeFileSync(secondExpiredPath, 'expired');
      fs.utimesSync(secondExpiredPath, expiredTime, expiredTime);
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(fs.existsSync(secondExpiredPath)).toBe(false);
      expect(fs.existsSync(freshPath)).toBe(true);
      expect(fs.existsSync(activeWorkingPath)).toBe(true);
    } finally {
      processor.onModuleDestroy();
      jest.useRealTimers();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates and removes a lease around an export working directory', async () => {
    const { processor, cacheService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(createJob({ format: 'excel' }));
      filePath = result.filePath;
      const leaseSetCall = cacheService.set.mock.calls.find(
        ([key]) => String(key).startsWith('export-working-lease:')
      );
      expect(leaseSetCall).toEqual([
        expect.stringMatching(
          /^export-working-lease:\.export-working-job-1-/
        ),
        expect.objectContaining({ jobId: 'job-1' }),
        600
      ]);
      expect(cacheService.delete).toHaveBeenCalledWith(leaseSetCall?.[0]);
    } finally {
      cleanup(filePath);
    }
  });

  it('cancels an export when its client lease has expired', async () => {
    const {
      processor,
      codingExportService,
      exportJobClientLeaseService
    } = createProcessor();
    exportJobClientLeaseService.isLeaseActive.mockResolvedValue(false);
    const job = createJob({
      format: 'excel',
      clientLeaseId: 'expired-client-lease'
    });

    await expect(processor.process(job)).resolves.toMatchObject({
      filePath: '',
      fileSize: 0
    });

    expect(job.update).toHaveBeenCalledWith(expect.objectContaining({
      isCancelled: true
    }));
    expect(codingExportService.exportCodingListForJobAsExcelToFile)
      .not.toHaveBeenCalled();
    expect(exportJobClientLeaseService.releaseLease)
      .toHaveBeenCalledWith('expired-client-lease');
  });

  it('passes trainingRequired to coding-list Excel exports', async () => {
    const { processor, codingExportService, cacheService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          format: 'excel',
          trainingRequired: true,
          authToken: 'auth-token',
          serverUrl: 'http://app.example'
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingListForJobAsExcelToFile
      ).toHaveBeenCalledWith(
        expect.stringMatching(/\.xlsx$/),
        7,
        'auth-token',
        'http://app.example',
        expect.any(Function),
        true,
        expect.any(Function)
      );
      expect(
        codingExportService.exportCodingListForJobAsExcel
      ).not.toHaveBeenCalled();
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'xlsx'
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'export-result:job-1',
        expect.objectContaining({ exportType: 'coding-list' }),
        3600
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('writes final result Excel exports directly to the target file', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'results-by-version',
          version: 'v3',
          format: 'excel',
          missingsProfileId: 7,
          includeReplayUrl: true,
          includeResponseValues: true,
          authToken: 'auth-token',
          serverUrl: 'http://app.example'
        })
      );
      filePath = result.filePath;

      expect(
        codingExportOrchestratorService.exportResultsByVersionAsExcelToFile
      ).toHaveBeenCalledWith(expect.stringMatching(/\.xlsx$/), {
        workspaceId: 7,
        version: 'v3',
        missingsProfileId: 7,
        authToken: 'auth-token',
        serverUrl: 'http://app.example',
        includeReplayUrl: true,
        onProgress: expect.any(Function),
        includeResponseValues: true,
        includeGeoGebraResponseValues: false,
        includeGeoGebraFiles: false,
        checkCancellation: expect.any(Function)
      });
      expect(
        codingExportOrchestratorService.exportResultsByVersionAsExcel
      ).not.toHaveBeenCalled();
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'xlsx'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('stores structured row progress for final result exports', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    const job = createJob({
      exportType: 'results-by-version',
      version: 'v1',
      format: 'excel',
      missingsProfileId: 7
    });
    let filePath: string | undefined;

    (
      codingExportOrchestratorService.exportResultsByVersionAsExcelToFile as jest.Mock
    ).mockImplementationOnce(
      async (
        targetPath: string,
        options: {
          onProgress?: (
            percentage: number,
            details?: {
              phase?: 'writing';
              processedRows?: number;
              totalRows?: number;
            }
          ) => Promise<void>;
        }
      ) => {
        filePath = targetPath;
        await options.onProgress?.(50, {
          phase: 'writing',
          processedRows: 100,
          totalRows: 200
        });
        await fs.promises.writeFile(targetPath, 'xlsx');
      }
    );

    try {
      const result = await processor.process(job);
      filePath = result.filePath;

      expect(job.progress).toHaveBeenCalledWith(
        expect.objectContaining({
          percentage: 55,
          phase: 'writing',
          processedRows: 100,
          totalRows: 200
        })
      );
      expect(job.progress).toHaveBeenCalledWith(
        expect.objectContaining({
          percentage: 90,
          phase: 'finalizing'
        })
      );
      expect(job.progress).toHaveBeenCalledWith(
        expect.objectContaining({
          percentage: 100,
          phase: 'completed'
        })
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('removes partial files when direct-to-file export generation fails', async () => {
    const { processor, codingExportService, cacheService } = createProcessor();
    let filePath: string | undefined;
    codingExportService.exportCodingResultsAggregatedToFile.mockImplementationOnce(
      async (targetPath: string) => {
        filePath = targetPath;
        await fs.promises.writeFile(targetPath, 'partial export');
        throw new Error('export exploded');
      }
    );

    try {
      await expect(
        processor.process(
          createJob({
            exportType: 'aggregated'
          })
        )
      ).rejects.toThrow('export exploded');

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath as string)).toBe(false);
      expect(cacheService.set).not.toHaveBeenCalledWith(
        expect.stringMatching(/^export-result:/),
        expect.anything(),
        expect.anything()
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('keeps JSON extension for coding-list JSON exports', async () => {
    const { processor, codingExportService } = createProcessor();
    codingExportService.exportCodingListForJobAsJson.mockResolvedValue(
      Readable.from(['[]'])
    );
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          format: 'json',
          trainingRequired: false
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingListForJobAsJson
      ).toHaveBeenCalledWith(
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
    codingExportOrchestratorService.exportResultsByVersionAsCsv.mockResolvedValue(
      Readable.from(['csv'])
    );
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'results-by-version',
          missingsProfileId: 7,
          includeReplayUrl: true,
          includeResponseValues: true,
          authToken: 'auth-token',
          serverUrl: 'http://app.example'
        })
      );
      filePath = result.filePath;

      expect(
        codingExportOrchestratorService.exportResultsByVersionAsCsv
      ).toHaveBeenCalledWith({
        workspaceId: 7,
        version: 'v2',
        missingsProfileId: 7,
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
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        '\uFEFFcsv'
      );
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
    codingExportOrchestratorService.exportResultsByVersionAsCsv.mockResolvedValue(
      stream
    );
    jobQueueService.isExportJobCancelled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const processPromise = processor.process(
      createJob({
        exportType: 'results-by-version',
        version: 'v2',
        format: 'csv',
        missingsProfileId: 7
      })
    );

    try {
      await jest.advanceTimersByTimeAsync(1000);

      const result = await processPromise;
      expect(
        codingExportOrchestratorService.exportResultsByVersionAsCsv
      ).toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalledWith(
        expect.stringMatching(/^export-result:/),
        expect.anything(),
        expect.anything()
      );
      expect(result).toEqual(
        expect.objectContaining({
          fileId: 'job-1',
          fileName: '',
          filePath: '',
          fileSize: 0,
          exportType: 'results-by-version'
        })
      );
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
    codingExportOrchestratorService.exportResultsByVersionAsCsv.mockResolvedValue(
      stream
    );
    jobQueueService.createExportJobCancellationSignal.mockReturnValue(
      controller.signal
    );
    jobQueueService.isExportJobCancelled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const processPromise = processor.process(
      createJob({
        exportType: 'results-by-version',
        version: 'v2',
        format: 'csv',
        missingsProfileId: 7
      })
    );

    await new Promise(resolve => {
      setImmediate(resolve);
    });
    controller.abort();

    const result = await processPromise;
    expect(
      codingExportOrchestratorService.exportResultsByVersionAsCsv
    ).toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalledWith(
      expect.stringMatching(/^export-result:/),
      expect.anything(),
      expect.anything()
    );
    expect(result).toEqual(
      expect.objectContaining({
        fileId: 'job-1',
        fileName: '',
        filePath: '',
        fileSize: 0,
        exportType: 'results-by-version'
      })
    );
    expect(
      jobQueueService.clearExportJobCancellationSignal
    ).toHaveBeenCalledWith('job-1');
  });

  it('uses ZIP extension for final result GeoGebra package exports', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    codingExportOrchestratorService.exportResultsByVersionAsExcelToFile.mockImplementationOnce(
      (filePath: string) => fs.promises.writeFile(filePath, 'zip')
    );
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'results-by-version',
          version: 'v2',
          format: 'excel',
          missingsProfileId: 7,
          includeReplayUrl: true,
          includeResponseValues: true,
          includeGeoGebraFiles: true,
          authToken: 'auth-token',
          serverUrl: 'http://app.example'
        })
      );
      filePath = result.filePath;

      expect(
        codingExportOrchestratorService.exportResultsByVersionAsExcelToFile
      ).toHaveBeenCalledWith(expect.stringMatching(/\.zip$/), {
        workspaceId: 7,
        version: 'v2',
        missingsProfileId: 7,
        authToken: 'auth-token',
        serverUrl: 'http://app.example',
        includeReplayUrl: true,
        onProgress: expect.any(Function),
        includeResponseValues: true,
        includeGeoGebraResponseValues: false,
        includeGeoGebraFiles: true,
        checkCancellation: expect.any(Function)
      });
      expect(
        codingExportOrchestratorService.exportResultsByVersionAsExcel
      ).not.toHaveBeenCalled();
      expect(result.fileName).toMatch(/\.zip$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('zip');
    } finally {
      cleanup(filePath);
    }
  });

  it('routes item matrix CSV exports through the orchestrator', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    let filePath: string | undefined;
    let workingFilePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'item-matrix',
          version: 'v2',
          format: 'csv',
          matrixValue: 'score',
          missingsProfileId: 4
        })
      );
      filePath = result.filePath;
      workingFilePath =
        codingExportOrchestratorService.exportItemMatrixAsCsvToFile
          .mock.calls[0][0];

      expect(
        codingExportOrchestratorService.exportItemMatrixAsCsvToFile
      ).toHaveBeenCalledWith(expect.stringMatching(/\.csv$/), {
        workspaceId: 7,
        missingsProfileId: 4,
        matrixValue: 'score',
        version: 'v2',
        notReachedScope: 'unit',
        recodeTrailingOmissions: false,
        items: undefined,
        onProgress: expect.any(Function),
        checkCancellation: expect.any(Function)
      });
      expect(result.fileName).toMatch(/^Itemdatensatz-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'matrix'
      );
      expect(path.dirname(workingFilePath as string)).not.toBe(
        path.dirname(filePath as string)
      );
      expect(path.basename(workingFilePath as string)).toBe(
        path.basename(filePath as string)
      );
      expect(fs.existsSync(path.dirname(workingFilePath as string))).toBe(
        false
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('quarantines incomplete item matrices as a diagnostic ZIP', async () => {
    const { processor, codingExportOrchestratorService, cacheService } =
      createProcessor();
    let rawMatrixPath: string | undefined;
    codingExportOrchestratorService.exportItemMatrixAsCsvToFile.mockImplementationOnce(
      async (filePath: string) => {
        rawMatrixPath = filePath;
        await fs.promises.writeFile(filePath, '\uFEFFheader\r\nlogin;code;;;');
        return {
          total: 2,
          sampleLimit: 20,
          groups: [
            {
              reasonCode: 'derived-result-missing',
              bookletName: 'BOOKLET-1',
              columnName: 'UNIT1_1',
              count: 2,
              sampleRowNumbers: [2, 3]
            }
          ]
        };
      }
    );

    await expect(
      processor.process(
        createJob({
          exportType: 'item-matrix',
          version: 'v2',
          format: 'csv',
          matrixValue: 'score',
          missingsProfileId: 4
        })
      )
    ).rejects.toThrow('2 nicht exportierbare Zellen');

    const incompleteCall = cacheService.set.mock.calls.find(
      ([key]) => key === 'item-matrix-incomplete-result:job-1'
    );
    expect(incompleteCall).toBeDefined();
    const metadata = incompleteCall?.[1] as { filePath: string };
    try {
      const zip = new AdmZip(metadata.filePath);
      expect(
        zip
          .getEntries()
          .map(entry => entry.entryName)
          .sort()
      ).toEqual(
        [
          'Itemdatensatz-UNVOLLSTAENDIG-' +
            `${new Date().toISOString().slice(0, 10)}.csv`,
          'README.txt',
          'diagnose.csv'
        ].sort()
      );
      const matrixEntry = zip
        .getEntries()
        .find(
          entry => entry.entryName.startsWith('Itemdatensatz-UNVOLLSTAENDIG-') &&
            entry.entryName.endsWith('.csv')
        );
      expect(matrixEntry && zip.readAsText(matrixEntry)).toContain(
        'login;code;;;'
      );
      const diagnosis = zip.readAsText('diagnose.csv');
      expect(diagnosis).toContain('derived-result-missing');
      expect(diagnosis).toContain('BOOKLET-1');
      expect(diagnosis).not.toContain('login;code');
      expect(zip.readAsText('README.txt')).toContain(
        'UNVOLLSTÄNDIGER ITEMDATENSATZ'
      );
      expect(cacheService.set).not.toHaveBeenCalledWith(
        'export-result:job-1',
        expect.anything(),
        expect.anything()
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'item-matrix-incomplete-result:job-1',
        expect.anything(),
        3600
      );
      expect(rawMatrixPath && fs.existsSync(rawMatrixPath)).toBe(false);
      expect(
        rawMatrixPath && fs.existsSync(path.dirname(rawMatrixPath))
      ).toBe(false);
    } finally {
      cleanup(metadata.filePath);
    }
  });

  it('removes incomplete artifacts when packaging fails', async () => {
    const { processor, codingExportOrchestratorService, cacheService } =
      createProcessor();
    let rawMatrixPath: string | undefined;
    codingExportOrchestratorService.exportItemMatrixAsCsvToFile.mockImplementationOnce(
      async (filePath: string) => {
        rawMatrixPath = filePath;
        return {
          total: 1,
          sampleLimit: 20,
          groups: [
            {
              reasonCode: 'unresolved-status',
              bookletName: 'BOOKLET-1',
              columnName: 'UNIT1_1',
              count: 1,
              sampleRowNumbers: [2]
            }
          ]
        };
      }
    );

    await expect(
      processor.process(
        createJob({
          exportType: 'item-matrix',
          format: 'csv',
          matrixValue: 'score',
          missingsProfileId: 4
        })
      )
    ).rejects.toThrow();

    expect(rawMatrixPath && fs.existsSync(rawMatrixPath)).toBe(false);
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-incomplete-result:job-1'
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-diagnostics:job-1'
    );
  });

  it('removes the package and both cache entries when cache publication is incomplete', async () => {
    const { processor, codingExportOrchestratorService, cacheService } =
      createProcessor();
    let rawMatrixPath: string | undefined;
    let packagePath: string | undefined;
    codingExportOrchestratorService.exportItemMatrixAsCsvToFile.mockImplementationOnce(
      async (filePath: string) => {
        rawMatrixPath = filePath;
        await fs.promises.writeFile(filePath, 'matrix');
        return {
          total: 1,
          sampleLimit: 20,
          groups: [{
            reasonCode: 'unresolved-status',
            bookletName: 'BOOKLET-1',
            columnName: 'UNIT1_1',
            count: 1,
            sampleRowNumbers: [2]
          }]
        };
      }
    );
    cacheService.set.mockImplementation(
      async (key: string, value: unknown) => {
        if (key === 'item-matrix-incomplete-result:job-1') {
          packagePath = (value as { filePath: string }).filePath;
          return true;
        }
        if (key === 'item-matrix-diagnostics:job-1') {
          return false;
        }
        return true;
      }
    );

    await expect(
      processor.process(createJob({
        exportType: 'item-matrix',
        format: 'csv',
        matrixValue: 'score',
        missingsProfileId: 4
      }))
    ).rejects.toThrow('nicht vollständig veröffentlicht');

    expect(rawMatrixPath && fs.existsSync(rawMatrixPath)).toBe(false);
    expect(packagePath && fs.existsSync(packagePath)).toBe(false);
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-incomplete-result:job-1'
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-diagnostics:job-1'
    );
  });

  it('removes incomplete artifacts when cancellation is detected', async () => {
    const {
      processor,
      codingExportOrchestratorService,
      cacheService,
      jobQueueService
    } = createProcessor();
    const job = createJob({
      exportType: 'item-matrix',
      format: 'csv',
      matrixValue: 'score',
      missingsProfileId: 4
    });
    let rawMatrixPath: string | undefined;
    codingExportOrchestratorService.exportItemMatrixAsCsvToFile.mockImplementationOnce(
      async (filePath: string) => {
        rawMatrixPath = filePath;
        await fs.promises.writeFile(filePath, 'matrix');
        jobQueueService.isExportJobCancelled.mockResolvedValue(true);
        return {
          total: 1,
          sampleLimit: 20,
          groups: [
            {
              reasonCode: 'unresolved-status',
              bookletName: 'BOOKLET-1',
              columnName: 'UNIT1_1',
              count: 1,
              sampleRowNumbers: [2]
            }
          ]
        };
      }
    );

    await expect(processor.process(job)).resolves.toMatchObject({
      fileName: '',
      filePath: ''
    });
    expect(rawMatrixPath && fs.existsSync(rawMatrixPath)).toBe(false);
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-incomplete-result:job-1'
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-diagnostics:job-1'
    );
  });

  it('removes published incomplete artifacts when cancellation arrives during caching', async () => {
    const {
      processor,
      codingExportOrchestratorService,
      cacheService,
      jobQueueService
    } = createProcessor();
    let rawMatrixPath: string | undefined;
    let packagePath: string | undefined;
    codingExportOrchestratorService.exportItemMatrixAsCsvToFile.mockImplementationOnce(
      async (filePath: string) => {
        rawMatrixPath = filePath;
        await fs.promises.writeFile(filePath, 'matrix');
        return {
          total: 1,
          sampleLimit: 20,
          groups: [
            {
              reasonCode: 'unresolved-status',
              bookletName: 'BOOKLET-1',
              columnName: 'UNIT1_1',
              count: 1,
              sampleRowNumbers: [2]
            }
          ]
        };
      }
    );
    cacheService.set.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'item-matrix-incomplete-result:job-1') {
        packagePath = (value as { filePath: string }).filePath;
        jobQueueService.isExportJobCancelled.mockResolvedValue(true);
      }
      return true;
    });

    await expect(
      processor.process(
        createJob({
          exportType: 'item-matrix',
          format: 'csv',
          matrixValue: 'score',
          missingsProfileId: 4
        })
      )
    ).resolves.toMatchObject({
      fileName: '',
      filePath: ''
    });

    expect(rawMatrixPath && fs.existsSync(rawMatrixPath)).toBe(false);
    expect(packagePath && fs.existsSync(packagePath)).toBe(false);
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-incomplete-result:job-1'
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      'item-matrix-diagnostics:job-1'
    );
  });

  it('routes item matrix Excel exports through the orchestrator', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'item-matrix',
          version: 'v3',
          format: 'excel',
          matrixValue: 'code',
          missingsProfileId: 4
        })
      );
      filePath = result.filePath;

      expect(
        codingExportOrchestratorService.exportItemMatrixAsExcelToFile
      ).toHaveBeenCalledWith(expect.stringMatching(/\.xlsx$/), {
        workspaceId: 7,
        missingsProfileId: 4,
        matrixValue: 'code',
        version: 'v3',
        notReachedScope: 'unit',
        recodeTrailingOmissions: false,
        items: undefined,
        onProgress: expect.any(Function),
        checkCancellation: expect.any(Function)
      });
      expect(
        codingExportOrchestratorService.exportItemMatrixAsExcel
      ).not.toHaveBeenCalled();
      expect(result.fileName).toMatch(
        /^Itemdatensatz-\d{4}-\d{2}-\d{2}\.xlsx$/
      );
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'xlsx'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('routes psychometric Excel exports with the selected options', async () => {
    const { processor, codingPsychometricExportService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'psychometrics',
          version: 'v3',
          format: 'excel',
          partWholeCorrection: false,
          missingsProfileId: 4,
          domain: {
            mode: 'vomd-field',
            scope: 'ITEM',
            profileId: 'profile',
            entryId: 'domain'
          },
          maxCategoryCount: 12
        })
      );
      filePath = result.filePath;

      expect(
        codingPsychometricExportService.writePsychometricsExcelToFile
      ).toHaveBeenCalledWith(
        expect.stringMatching(/\.xlsx$/),
        expect.objectContaining({
          workspaceId: 7,
          version: 'v3',
          partWholeCorrection: false,
          missingsProfileId: 4,
          domain: {
            mode: 'vomd-field',
            scope: 'ITEM',
            profileId: 'profile',
            entryId: 'domain'
          },
          maxCategoryCount: 12,
          onProgress: expect.any(Function),
          checkCancellation: expect.any(Function)
        })
      );
      expect(result.fileName).toMatch(/\.xlsx$/);
    } finally {
      cleanup(filePath);
    }
  });

  it('rejects non-boolean psychometric part-whole options before exporting', async () => {
    const { processor, codingPsychometricExportService } = createProcessor();

    await expect(
      processor.process(
        createJob({
          exportType: 'psychometrics',
          partWholeCorrection: 'false' as never
        })
      )
    ).rejects.toThrow('psychometrics partWholeCorrection must be a boolean');

    expect(
      codingPsychometricExportService.exportPsychometricsAsCsv
    ).not.toHaveBeenCalled();
    expect(
      codingPsychometricExportService.writePsychometricsExcelToFile
    ).not.toHaveBeenCalled();
  });

  it('rejects invalid item matrix versions before exporting', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();

    await expect(
      processor.process(
        createJob({
          exportType: 'item-matrix',
          version: 'v4' as never,
          format: 'csv',
          matrixValue: 'score'
        })
      )
    ).rejects.toThrow(
      'item-matrix exports support only "v1", "v2" or "v3" versions'
    );

    expect(
      codingExportOrchestratorService.exportItemMatrixAsCsv
    ).not.toHaveBeenCalled();
    expect(
      codingExportOrchestratorService.exportItemMatrixAsExcel
    ).not.toHaveBeenCalled();
    expect(
      codingExportOrchestratorService.exportItemMatrixAsExcelToFile
    ).not.toHaveBeenCalled();
  });

  it('rejects GeoGebra package exports without response values', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();

    await expect(
      processor.process(
        createJob({
          exportType: 'results-by-version',
          format: 'excel',
          missingsProfileId: 7,
          includeResponseValues: false,
          includeGeoGebraFiles: true
        })
      )
    ).rejects.toThrow('GeoGebra file packages require response values');

    expect(
      codingExportOrchestratorService.exportResultsByVersionAsExcel
    ).not.toHaveBeenCalled();
    expect(
      codingExportOrchestratorService.exportResultsByVersionAsExcelToFile
    ).not.toHaveBeenCalled();
  });

  it('routes detailed export jobs through the orchestrator', async () => {
    const { processor, codingExportOrchestratorService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'detailed',
          outputCommentsInsteadOfCodes: true,
          includeReplayUrl: true,
          includeResponseValues: true,
          anonymizeCoders: true,
          usePseudoCoders: false,
          excludeAutoCoded: true,
          authToken: 'auth-token',
          serverUrl: 'http://app.example',
          jobDefinitionIds: [1],
          coderTrainingIds: [2],
          coderIds: [3]
        })
      );
      filePath = result.filePath;

      expect(
        codingExportOrchestratorService.exportDetailedToFile
      ).toHaveBeenCalledWith(expect.stringMatching(/\.csv$/), {
        workspaceId: 7,
        outputCommentsInsteadOfCodes: true,
        includeReplayUrl: true,
        includeResponseValues: true,
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
      expect(
        codingExportOrchestratorService.exportDetailed
      ).not.toHaveBeenCalled();
      expect(result.fileName).toMatch(/\.csv$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe('csv');
    } finally {
      cleanup(filePath);
    }
  });

  it('writes aggregated Excel export jobs directly to the target file', async () => {
    const { processor, codingExportService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'aggregated',
          outputCommentsInsteadOfCodes: true,
          includeReplayUrl: true,
          includeResponseValues: true,
          anonymizeCoders: true,
          usePseudoCoders: true,
          doubleCodingMethod: 'new-row-per-variable',
          includeComments: true,
          includeModalValue: true,
          excludeAutoCoded: true,
          authToken: 'auth-token',
          serverUrl: 'http://app.example',
          jobDefinitionIds: [1],
          coderTrainingIds: [2],
          coderIds: [3]
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingResultsAggregatedToFile
      ).toHaveBeenCalledWith(
        expect.stringMatching(/\.xlsx$/),
        7,
        true,
        true,
        true,
        true,
        'new-row-per-variable',
        true,
        true,
        'auth-token',
        undefined,
        true,
        expect.any(Function),
        [1],
        [2],
        [3],
        'http://app.example',
        true
      );
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'aggregated'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('writes by-coder Excel export jobs directly to the target file', async () => {
    const { processor, codingExportService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'by-coder',
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
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingResultsByCoderToFile
      ).toHaveBeenCalledWith(
        expect.stringMatching(/\.xlsx$/),
        7,
        true,
        true,
        true,
        false,
        'auth-token',
        undefined,
        true,
        expect.any(Function),
        [1],
        [2],
        [3],
        'http://app.example'
      );
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'by-coder'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('writes by-variable Excel export jobs directly to the target file', async () => {
    const { processor, codingExportService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'by-variable',
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
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingResultsByVariableToFile
      ).toHaveBeenCalledWith(
        expect.stringMatching(/\.xlsx$/),
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
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'by-variable'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('writes coding-times Excel export jobs directly to the target file', async () => {
    const { processor, codingExportService } = createProcessor();
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
          exportType: 'coding-times',
          anonymizeCoders: true,
          usePseudoCoders: true,
          excludeAutoCoded: true,
          jobDefinitionIds: [1],
          coderTrainingIds: [2],
          coderIds: [3]
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingTimesReportToFile
      ).toHaveBeenCalledWith(
        expect.stringMatching(/\.xlsx$/),
        7,
        true,
        true,
        true,
        expect.any(Function),
        [1],
        [2],
        [3]
      );
      expect(result.fileName).toMatch(/\.xlsx$/);
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        'coding-times'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it('routes compact by-variable export jobs to CSV generation', async () => {
    const { processor, codingExportService } = createProcessor();
    codingExportService.exportCodingResultsByVariableCompactAsCsvStream.mockReturnValue(
      Readable.from(['csv'])
    );
    let filePath: string | undefined;

    try {
      const result = await processor.process(
        createJob({
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
        })
      );
      filePath = result.filePath;

      expect(
        codingExportService.exportCodingResultsByVariableCompactAsCsvStream
      ).toHaveBeenCalledWith(
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
      expect(fs.readFileSync(filePath as string).toString('utf-8')).toBe(
        '\uFEFFcsv'
      );
    } finally {
      cleanup(filePath);
    }
  });

  it.each(['json', 'xlsx'])(
    'rejects %s format for final result exports',
    async format => {
      const { processor, codingExportOrchestratorService } = createProcessor();

      await expect(
        processor.process(
          createJob({
            exportType: 'results-by-version',
            format: format as never,
            missingsProfileId: 7
          })
        )
      ).rejects.toThrow(
        'results-by-version exports support only "csv" or "excel" format'
      );

      expect(
        codingExportOrchestratorService.exportResultsByVersionAsCsv
      ).not.toHaveBeenCalled();
      expect(
        codingExportOrchestratorService.exportResultsByVersionAsExcel
      ).not.toHaveBeenCalled();
      expect(
        codingExportOrchestratorService.exportResultsByVersionAsExcelToFile
      ).not.toHaveBeenCalled();
    }
  );
});
