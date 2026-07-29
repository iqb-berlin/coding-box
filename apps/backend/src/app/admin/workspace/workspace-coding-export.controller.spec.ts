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
  CodingListExportService,
  CodingPsychometricExportService,
  ExportArtifactService
} from '../../database/services/coding';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';

jest.mock('../../database/services/workspace/workspace-files.service', () => ({
  WorkspaceFilesService: jest.fn()
}));

const createController = (
  codingListExportService: CodingListExportService,
  codingExportService: CodingExportService,
  codingExportOrchestratorService: CodingExportOrchestratorService,
  jobQueueService: JobQueueService,
  cacheService: CacheService,
  codingPsychometricExportService: CodingPsychometricExportService
): WorkspaceCodingExportController => new WorkspaceCodingExportController(
  codingListExportService,
  codingExportService,
  codingExportOrchestratorService,
  jobQueueService,
  codingPsychometricExportService,
  new ExportArtifactService(cacheService)
);

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
  res.write = jest.fn(
    (
      chunk: unknown,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ) => {
      headersSent = true;
      return originalWrite(chunk, encoding as BufferEncoding, callback);
    }
  ) as never;
  res.end = jest.fn(
    (
      chunk?: unknown,
      encoding?: BufferEncoding | (() => void),
      callback?: () => void
    ) => {
      headersSent = true;
      return originalEnd(chunk, encoding as BufferEncoding, callback);
    }
  ) as never;
  Object.defineProperty(res, 'headersSent', {
    get: () => headersSent
  });

  return res;
};

describe('WorkspaceCodingExportController', () => {
  const codingPsychometricExportServiceMock =
    {} as CodingPsychometricExportService;

  it('returns item dataset options from the shared metadata resolver path', async () => {
    const options = {
      items: [{
        unitId: 'UNIT1',
        unitLabel: 'Aufgabe 1',
        itemId: 'ITEM1',
        itemLabel: 'Item 1',
        columnName: 'Aufgabe1_ITEM1'
      }],
      mappingIssues: []
    };
    const codingExportOrchestratorService = {
      getItemDatasetOptions: jest.fn().mockResolvedValue(options)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      codingExportOrchestratorService as unknown as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getItemDatasetOptions(5)).resolves.toEqual(options);
    expect(codingExportOrchestratorService.getItemDatasetOptions)
      .toHaveBeenCalledWith(5);
  });

  it('ends the response instead of crashing when versioned CSV streaming fails', async () => {
    const csvStream = new PassThrough();
    const codingExportOrchestratorService = {
      exportResultsByVersionAsCsv: jest.fn().mockResolvedValue(csvStream)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      codingExportOrchestratorService as unknown as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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
      res as never,
      '7'
    );
    await new Promise(resolve => {
      setImmediate(resolve);
    });

    csvStream.emit('error', new Error('Connection terminated unexpectedly'));
    await exportPromise;

    expect(
      codingExportOrchestratorService.exportResultsByVersionAsCsv
    ).toHaveBeenCalledWith({
      workspaceId: 5,
      version: 'v2',
      authToken: 'token',
      serverUrl: 'http://server',
      includeReplayUrl: false,
      includeResponseValues: false,
      includeGeoGebraResponseValues: false,
      missingsProfileId: 7
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8'
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('returns application/json for downloaded JSON export jobs', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'coding-export-json-')
    );
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

    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    const res = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    }) as Writable & {
      setHeader: jest.Mock;
      status: jest.Mock;
      json: jest.Mock;
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

  it.each(['json', 'xlsx'])(
    'rejects %s format for background final result exports',
    async format => {
      const jobQueueService = {
        addExportJob: jest.fn()
      };
      const controller = createController(
        {} as CodingListExportService,
        {} as CodingExportService,
        {} as CodingExportOrchestratorService,
        jobQueueService as unknown as JobQueueService,
        {} as CacheService,
        codingPsychometricExportServiceMock
      );

      await expect(
        controller.startExportJob(5, { user: { id: 2 } } as never, {
          exportType: 'results-by-version',
          format: format as never,
          missingsProfileId: 7
        })
      ).rejects.toThrow(BadRequestException);

      expect(jobQueueService.addExportJob).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid item matrix versions before starting a background export job', async () => {
    const jobQueueService = {
      addExportJob: jest.fn()
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.startExportJob(5, { user: { id: 2 } } as never, {
        exportType: 'item-matrix',
        version: 'v4' as never
      })
    ).rejects.toThrow(BadRequestException);

    expect(jobQueueService.addExportJob).not.toHaveBeenCalled();
  });

  it('rejects invalid psychometric category limits before starting a job', async () => {
    const jobQueueService = {
      addExportJob: jest.fn()
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.startExportJob(5, { user: { id: 2 } } as never, {
        exportType: 'psychometrics',
        maxCategoryCount: 0
      })
    ).rejects.toThrow(BadRequestException);

    expect(jobQueueService.addExportJob).not.toHaveBeenCalled();
  });

  it('rejects non-boolean psychometric part-whole options before starting a job', async () => {
    const jobQueueService = {
      addExportJob: jest.fn()
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.startExportJob(5, { user: { id: 2 } } as never, {
        exportType: 'psychometrics',
        partWholeCorrection: 'false' as never
      })
    ).rejects.toThrow(BadRequestException);

    expect(jobQueueService.addExportJob).not.toHaveBeenCalled();
  });

  it('returns selectable VOMD domain candidates', async () => {
    const psychometricService = {
      getDomainCandidates: jest.fn().mockResolvedValue({
        candidates: [
          {
            scope: 'ITEM',
            profileId: 'profile',
            entryId: 'domain',
            label: 'Domäne',
            coverage: 2,
            itemCount: 2,
            singleValued: true,
            selectable: true
          }
        ],
        itemCount: 2,
        mappingIssueCount: 0,
        mappingFallbackCount: 0,
        mappingIssuePreview: [],
        mappingFallbackPreview: []
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      psychometricService as never
    );

    await expect(
      controller.getPsychometricDomainCandidates(5)
    ).resolves.toEqual({
      candidates: [
        expect.objectContaining({ entryId: 'domain', selectable: true })
      ],
      itemCount: 2,
      mappingIssueCount: 0,
      mappingFallbackCount: 0,
      mappingIssuePreview: [],
      mappingFallbackPreview: []
    });
    expect(psychometricService.getDomainCandidates).toHaveBeenCalledWith(5);
  });

  it('normalizes authenticated user IDs before starting background export jobs', async () => {
    const jobQueueService = {
      addExportJob: jest.fn().mockResolvedValue({ id: 'job-1' })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.startExportJob(5, { user: { id: '2' } } as never, {
        exportType: 'detailed'
      })
    ).resolves.toEqual({
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
      exportCodingResultsByCoder: jest
        .fn()
        .mockResolvedValue(Buffer.from('xlsx'))
    };
    const controller = createController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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
    const controller = createController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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
    const controller = createController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.estimateExportJob(5, {
        exportType: 'by-variable',
        excludeAutoCoded: true,
        jobDefinitionIds: [1],
        coderTrainingIds: [2],
        coderIds: [3]
      })
    ).resolves.toEqual({
      exportType: 'by-variable',
      unitVariableCount: 2578,
      worksheetLimit: 1000,
      exceedsWorksheetLimit: true
    });

    expect(
      codingExportService.estimateCodingResultsByVariableExport
    ).toHaveBeenCalledWith(5, 'by-variable', true, [1], [2], [3]);
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
    const controller = createController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.estimateExportJob(5, {
        exportType: 'by-variable-compact'
      })
    ).resolves.toEqual({
      exportType: 'by-variable-compact',
      unitVariableCount: 2578,
      worksheetLimit: null,
      exceedsWorksheetLimit: false
    });

    expect(
      codingExportService.estimateCodingResultsByVariableExport
    ).toHaveBeenCalledWith(
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
    const controller = createController(
      {} as CodingListExportService,
      codingExportService as unknown as CodingExportService,
      {} as CodingExportOrchestratorService,
      {} as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.estimateExportJob(5, {
        exportType: 'detailed'
      })
    ).rejects.toThrow(BadRequestException);

    expect(
      codingExportService.estimateCodingResultsByVariableExport
    ).not.toHaveBeenCalled();
  });

  it('does not expose internal file paths in export job status results', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'export-status-controller-')
    );
    const filePath = path.join(tempDir, 'export_job-1.csv');
    fs.writeFileSync(filePath, 'result');
    const artifact = {
      fileId: 'job-1',
      fileName: 'export_job-1.csv',
      filePath,
      fileSize: 128,
      workspaceId: 5,
      userId: 2,
      exportType: 'detailed' as const,
      createdAt: 123
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'detailed' },
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockResolvedValue(100),
        returnvalue: artifact
      })
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(artifact)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    try {
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
          createdAt: 123,
          expiresAt: 123 + ExportArtifactService.ttlSeconds * 1000
        }
      });
      expect(JSON.stringify(status)).not.toContain('filePath');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('adds structured details for worksheet limit failures in export job status', async () => {
    const failedReason =
      'Der Export enthaelt 2578 Unit-Variable-Kombinationen und ueberschreitet das konfigurierte Limit von 1000 Tabellenblaettern.';
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'by-variable' },
        getState: jest.fn().mockResolvedValue('failed'),
        progress: jest.fn().mockResolvedValue(20),
        failedReason
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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

  it('exposes diagnostics and the quarantined package only for failed item matrices', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'item-matrix-incomplete-controller-')
    );
    const filePath = path.join(tempDir, 'incomplete.zip');
    fs.writeFileSync(filePath, 'zip');
    const diagnostics = {
      total: 1933,
      sampleLimit: 20,
      groups: [{
        reasonCode: 'derived-result-missing' as const,
        bookletName: 'BOOKLET-1',
        columnName: 'UNIT1_1',
        count: 1933,
        sampleRowNumbers: [2, 3]
      }]
    };
    const job = {
      id: 'job-1',
      data: { workspaceId: 5, exportType: 'item-matrix' },
      getState: jest.fn().mockResolvedValue('failed'),
      progress: jest.fn().mockResolvedValue(90),
      failedReason:
        'ITEM_MATRIX_UNRESOLVED_CELLS:1933 ' +
        'Itemdatensatz enthält 1933 nicht exportierbare Zellen.'
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job)
    };
    const cacheService = {
      get: jest.fn((key: string) => {
        if (key === 'item-matrix-diagnostics:job-1') {
          return Promise.resolve({
            diagnostics,
            expiresAt: Date.now() + 3600000
          });
        }
        if (key === 'item-matrix-incomplete-result:job-1') {
          return Promise.resolve({
            fileId: 'job-1',
            fileName: 'Itemdatensatz-UNVOLLSTAENDIG-2026-07-26.zip',
            filePath,
            fileSize: 3,
            workspaceId: 5,
            userId: 2,
            exportType: 'item-matrix',
            createdAt: Date.now()
          });
        }
        return Promise.resolve(undefined);
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    try {
      const status = await controller.getExportJobStatus(5, 'job-1');
      expect(status).toEqual(expect.objectContaining({
        status: 'failed',
        errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
        errorDetails: expect.objectContaining({
          total: 1933,
          groupCount: 1,
          sampleLimit: 20,
          diagnosticsAvailable: true,
          incompleteDownloadAvailable: true
        })
      }));
      await expect(
        controller.getItemMatrixExportDiagnostics(5, 'job-1')
      ).resolves.toEqual(diagnostics);

      const res = createWritableResponse();
      res.resume();
      await controller.downloadIncompleteItemMatrix(5, 'job-1', res as never);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/zip'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="Itemdatensatz-UNVOLLSTAENDIG-2026-07-26.zip"'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects diagnostics for wrong workspaces, job types and expired data', async () => {
    const job = {
      id: 'job-1',
      data: { workspaceId: 5, exportType: 'item-matrix' },
      getState: jest.fn().mockResolvedValue('failed')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job)
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(undefined)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(
      controller.getItemMatrixExportDiagnostics(6, 'job-1')
    ).rejects.toThrow('Access denied');

    job.data.exportType = 'detailed';
    await expect(
      controller.getItemMatrixExportDiagnostics(5, 'job-1')
    ).rejects.toThrow('only for failed item matrix exports');

    job.data.exportType = 'item-matrix';
    await expect(
      controller.getItemMatrixExportDiagnostics(5, 'job-1')
    ).rejects.toThrow('not found or expired');
  });

  it('deletes normal and quarantined files with their cache entries', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'item-matrix-delete-controller-')
    );
    const normalPath = path.join(tempDir, 'normal.csv');
    const incompletePath = path.join(tempDir, 'incomplete.zip');
    fs.writeFileSync(normalPath, 'normal');
    fs.writeFileSync(incompletePath, 'incomplete');
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'item-matrix' }
      }),
      deleteExportJob: jest.fn().mockResolvedValue(true)
    };
    const cacheService = {
      get: jest.fn((key: string) => Promise.resolve(
        key === 'export-result:job-1' ?
          { filePath: normalPath } :
          { filePath: incompletePath }
      )),
      delete: jest.fn().mockResolvedValue(true)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    try {
      await expect(controller.deleteExportJob(5, 'job-1')).resolves.toEqual({
        success: true,
        message: 'Export job deleted successfully'
      });
      expect(fs.existsSync(normalPath)).toBe(false);
      expect(fs.existsSync(incompletePath)).toBe(false);
      expect(cacheService.delete.mock.calls.map(([key]) => key)).toEqual(
        expect.arrayContaining([
          'export-result:job-1',
          'item-matrix-incomplete-result:job-1',
          'item-matrix-diagnostics:job-1'
        ])
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('treats an already deleted export job as a successful deletion', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(null),
      deleteExportJob: jest.fn()
    };
    const cacheService = {
      get: jest.fn(),
      delete: jest.fn()
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.deleteExportJob(5, 'missing')).resolves.toEqual({
      success: true,
      message: 'Export job already deleted'
    });
    expect(jobQueueService.deleteExportJob).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('keeps the export job when an artifact file cannot be deleted', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'item-matrix' }
      }),
      deleteExportJob: jest.fn().mockResolvedValue(true)
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue({ filePath: '/tmp/locked-export.zip' }),
      delete: jest.fn().mockResolvedValue(true)
    };
    const unlink = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      const error = new Error('file is busy') as NodeJS.ErrnoException;
      error.code = 'EBUSY';
      throw error;
    });
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    try {
      await expect(controller.deleteExportJob(5, 'job-1')).resolves.toEqual({
        success: false,
        message: 'file is busy'
      });
      expect(cacheService.delete).not.toHaveBeenCalled();
      expect(jobQueueService.deleteExportJob).not.toHaveBeenCalled();
    } finally {
      unlink.mockRestore();
    }
  });

  it('keeps the export job when artifact cache cleanup is incomplete', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'item-matrix' }
      }),
      deleteExportJob: jest.fn().mockResolvedValue(true)
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.deleteExportJob(5, 'job-1')).resolves.toEqual({
      success: false,
      message: 'Export artifacts could not be deleted completely'
    });
    expect(cacheService.delete).toHaveBeenCalledTimes(3);
    expect(jobQueueService.deleteExportJob).not.toHaveBeenCalled();
  });

  it('normalizes structured export progress details in job status', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'detailed' },
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
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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
        data: {
          workspaceId: 5,
          exportType: 'detailed',
          isCancelled: true
        },
        getState: jest.fn().mockResolvedValue('active'),
        progress: jest.fn().mockResolvedValue(55)
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'cancelled',
      progress: 55
    });
  });

  it('maps stuck export jobs to the public pending state', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'detailed' },
        getState: jest.fn().mockResolvedValue('stuck'),
        progress: jest.fn().mockResolvedValue(0)
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'pending',
      progress: 0
    });
  });

  it('reports completed cancellation-marked export jobs as cancelled without result metadata', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: {
          workspaceId: 5,
          exportType: 'detailed',
          isCancelled: true
        },
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
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      status: 'cancelled',
      progress: 21
    });
  });

  it('reports failed export jobs caused by cancellation as cancelled', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 5, exportType: 'detailed' },
        getState: jest.fn().mockResolvedValue('failed'),
        progress: jest.fn().mockResolvedValue(20),
        failedReason: 'Export job job-1 was cancelled'
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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
          data: {
            workspaceId: 5,
            exportType: 'coding-list',
            isCancelled: true
          },
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
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
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

  it('returns display variants for manual coding exports', async () => {
    const jobQueueService = {
      getExportJobs: jest.fn().mockResolvedValue([
        {
          id: 'manual-aggregated',
          data: {
            workspaceId: 5,
            exportType: 'aggregated',
            excludeAutoCoded: true,
            doubleCodingMethod: 'new-column-per-coder'
          },
          timestamp: 100,
          getState: jest.fn().mockResolvedValue('waiting'),
          progress: jest.fn().mockResolvedValue(0)
        },
        {
          id: 'manual-compact',
          data: {
            workspaceId: 5,
            exportType: 'by-variable-compact',
            excludeAutoCoded: true
          },
          timestamp: 101,
          getState: jest.fn().mockResolvedValue('waiting'),
          progress: jest.fn().mockResolvedValue(0)
        }
      ])
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobs(5)).resolves.toEqual([
      expect.objectContaining({
        jobId: 'manual-aggregated',
        displayVariant: 'manual-review-new-column-per-coder'
      }),
      expect.objectContaining({
        jobId: 'manual-compact',
        displayVariant: 'manual-review-by-variable-compact'
      })
    ]);
  });

  it('returns structured item matrix error details in the job list', async () => {
    const jobQueueService = {
      getExportJobs: jest.fn().mockResolvedValue([{
        id: 'failed-matrix',
        data: { workspaceId: 5, exportType: 'item-matrix' },
        timestamp: 100,
        failedReason:
          'ITEM_MATRIX_UNRESOLVED_CELLS:2 Itemdatensatz enthält 2 nicht exportierbare Zellen.',
        getState: jest.fn().mockResolvedValue('failed'),
        progress: jest.fn().mockResolvedValue(90)
      }])
    };
    const cacheService = {
      get: jest.fn()
        .mockResolvedValueOnce({
          diagnostics: {
            total: 2,
            sampleLimit: 20,
            groups: [{
              reasonCode: 'missing-score',
              bookletName: 'BOOKLET',
              columnName: 'ITEM_1',
              count: 2,
              sampleRowNumbers: []
            }]
          },
          expiresAt: 500
        })
        .mockResolvedValueOnce(undefined)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobs(5)).resolves.toEqual([{
      jobId: 'failed-matrix',
      status: 'failed',
      progress: 90,
      error:
        'ITEM_MATRIX_UNRESOLVED_CELLS:2 Itemdatensatz enthält 2 nicht exportierbare Zellen.',
      errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
      errorDetails: {
        total: 2,
        groupCount: 1,
        sampleLimit: 20,
        diagnosticsAvailable: true,
        incompleteDownloadAvailable: false,
        expiresAt: 500
      },
      exportType: 'item-matrix',
      createdAt: 100
    }]);
  });

  it('omits completed jobs whose artifacts have expired', async () => {
    const jobQueueService = {
      getExportJobs: jest.fn().mockResolvedValue([{
        id: 'completed-expired',
        data: { workspaceId: 5, exportType: 'aggregated' },
        timestamp: 100,
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockResolvedValue(100),
        returnvalue: {
          fileId: 'completed-expired',
          fileName: 'export.xlsx',
          filePath: '/expired/export.xlsx',
          fileSize: 10,
          workspaceId: 5,
          userId: 2,
          exportType: 'aggregated',
          createdAt: 100
        }
      }])
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(undefined)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobs(5)).resolves.toEqual([]);
  });

  it('does not clean up cached export metadata when cancelling coding export jobs', async () => {
    const job = {
      data: { workspaceId: 5, exportType: 'detailed' },
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
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      cacheService as unknown as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: true,
      message:
        'Export job cancellation requested (job will stop at next checkpoint)'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith(
      'job-1'
    );
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('allows cancelling a job that already failed because of cancellation', async () => {
    const job = {
      data: {
        workspaceId: 5,
        exportType: 'detailed',
        isCancelled: true
      },
      getState: jest.fn().mockResolvedValue('failed')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(true)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: true,
      message: 'Export job cancelled successfully'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith(
      'job-1'
    );
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
  });

  it('does not report coding export cancellation as successful when queue cancellation was not accepted', async () => {
    const job = {
      data: { workspaceId: 5, exportType: 'detailed' },
      getState: jest.fn().mockResolvedValue('active')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(false),
      cancelExportJob: jest.fn().mockResolvedValue(false)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: false,
      message: 'Export job cancellation could not be requested'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith(
      'job-1'
    );
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
  });

  it('reports coding export cancellation as successful when cancellation completes during the request', async () => {
    const job = {
      data: { workspaceId: 5, exportType: 'detailed' },
      getState: jest
        .fn()
        .mockResolvedValueOnce('active')
        .mockResolvedValueOnce('completed')
    };
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue(job),
      markExportJobCancelled: jest.fn().mockResolvedValue(true),
      cancelExportJob: jest.fn().mockResolvedValue(true)
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.cancelExportJob(5, 'job-1')).resolves.toEqual({
      success: true,
      message:
        'Export job cancellation requested (job will stop at next checkpoint)'
    });
    expect(jobQueueService.markExportJobCancelled).toHaveBeenCalledWith(
      'job-1'
    );
    expect(jobQueueService.cancelExportJob).toHaveBeenCalledWith('job-1');
  });

  it('rejects export job status access for jobs from another workspace', async () => {
    const jobQueueService = {
      getExportJob: jest.fn().mockResolvedValue({
        data: { workspaceId: 9 }
      })
    };
    const controller = createController(
      {} as CodingListExportService,
      {} as CodingExportService,
      {} as CodingExportOrchestratorService,
      jobQueueService as unknown as JobQueueService,
      {} as CacheService,
      codingPsychometricExportServiceMock
    );

    await expect(controller.getExportJobStatus(5, 'job-1')).resolves.toEqual({
      error: 'Access denied to this export'
    });
  });

  it('requires coding-manager access at controller level', () => {
    expect(
      Reflect.getMetadata('accessLevel', WorkspaceCodingExportController)
    ).toBe(2);
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
    'getPsychometricDomainCandidates',
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
