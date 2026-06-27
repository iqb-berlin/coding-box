import { Readable } from 'stream';
import type { CodingExportService } from './coding-export.service';
import { CodingExportOrchestratorService } from './coding-export-orchestrator.service';
import type { CodingItemMatrixExportService } from './coding-item-matrix-export.service';
import type { CodingResultsExportService } from './coding-results-export.service';

jest.mock('./coding-export.service', () => ({
  CodingExportService: jest.fn()
}));
jest.mock('./coding-results-export.service', () => ({
  CodingResultsExportService: jest.fn()
}));

describe('CodingExportOrchestratorService', () => {
  const createService = () => {
    const codingExportService = {
      exportCodingResultsDetailed: jest.fn()
    };
    const codingResultsExportService = {
      exportCodingResultsByVersionAsCsv: jest.fn(),
      exportCodingResultsByVersionAsExcel: jest.fn(),
      exportCodingResultsByVersionAsExcelToFile: jest.fn(),
      exportCodingResultsByVersionAsGeoGebraZip: jest.fn(),
      exportCodingResultsByVersionAsGeoGebraZipToFile: jest.fn().mockResolvedValue(undefined),
      exportCodingResultsDetailed: jest.fn()
    };
    const codingItemMatrixExportService = {
      exportItemMatrixAsCsvStream: jest.fn(),
      exportItemMatrixAsExcel: jest.fn(),
      writeItemMatrixExcelToFile: jest.fn().mockResolvedValue(undefined)
    };

    const service = new CodingExportOrchestratorService(
      codingExportService as unknown as CodingExportService,
      codingResultsExportService as unknown as CodingResultsExportService,
      codingItemMatrixExportService as unknown as CodingItemMatrixExportService
    );

    return {
      service,
      codingExportService,
      codingResultsExportService,
      codingItemMatrixExportService
    };
  };

  it('routes versioned CSV exports to the specialized results export service', async () => {
    const { service, codingResultsExportService } = createService();
    const csvStream = Readable.from(['csv']);
    const onProgress = jest.fn();
    codingResultsExportService.exportCodingResultsByVersionAsCsv.mockResolvedValue(csvStream);

    await expect(service.exportResultsByVersionAsCsv({
      workspaceId: 7,
      version: 'v3',
      authToken: 'token',
      serverUrl: 'http://app.example',
      includeReplayUrl: true,
      includeResponseValues: false,
      onProgress
    })).resolves.toBe(csvStream);

    expect(codingResultsExportService.exportCodingResultsByVersionAsCsv).toHaveBeenCalledWith(
      7,
      'v3',
      'token',
      'http://app.example',
      true,
      onProgress,
      false,
      false,
      undefined
    );
  });

  it('passes raw GeoGebra response value option to versioned exports', async () => {
    const { service, codingResultsExportService } = createService();
    const buffer = Buffer.from('xlsx');
    codingResultsExportService.exportCodingResultsByVersionAsExcel.mockResolvedValue(buffer);

    await expect(service.exportResultsByVersionAsExcel({
      workspaceId: 7,
      version: 'v2',
      includeResponseValues: true,
      includeGeoGebraResponseValues: true
    })).resolves.toBe(buffer);

    expect(codingResultsExportService.exportCodingResultsByVersionAsExcel).toHaveBeenCalledWith(
      7,
      'v2',
      '',
      '',
      false,
      undefined,
      true,
      true,
      undefined
    );
  });

  it('routes versioned Excel GeoGebra packages to the ZIP export service', async () => {
    const { service, codingResultsExportService } = createService();
    const buffer = Buffer.from('zip');
    const onProgress = jest.fn();
    codingResultsExportService.exportCodingResultsByVersionAsGeoGebraZip.mockResolvedValue(buffer);

    await expect(service.exportResultsByVersionAsExcel({
      workspaceId: 7,
      version: 'v2',
      authToken: 'token',
      serverUrl: 'http://app.example',
      includeReplayUrl: true,
      includeGeoGebraFiles: true,
      onProgress
    })).resolves.toBe(buffer);

    expect(codingResultsExportService.exportCodingResultsByVersionAsGeoGebraZip).toHaveBeenCalledWith(
      7,
      'v2',
      'token',
      'http://app.example',
      true,
      onProgress,
      undefined
    );
    expect(codingResultsExportService.exportCodingResultsByVersionAsExcel).not.toHaveBeenCalled();
  });

  it('routes versioned Excel file exports to the specialized results export service', async () => {
    const { service, codingResultsExportService } = createService();
    const onProgress = jest.fn();
    const checkCancellation = jest.fn();

    await expect(service.exportResultsByVersionAsExcelToFile('/tmp/export.xlsx', {
      workspaceId: 7,
      version: 'v3',
      authToken: 'token',
      serverUrl: 'http://app.example',
      includeReplayUrl: true,
      includeResponseValues: false,
      includeGeoGebraResponseValues: true,
      onProgress,
      checkCancellation
    })).resolves.toBeUndefined();

    expect(codingResultsExportService.exportCodingResultsByVersionAsExcelToFile).toHaveBeenCalledWith(
      '/tmp/export.xlsx',
      7,
      'v3',
      'token',
      'http://app.example',
      true,
      onProgress,
      false,
      true,
      checkCancellation
    );
  });

  it('routes versioned GeoGebra ZIP file exports to the specialized ZIP file export service', async () => {
    const { service, codingResultsExportService } = createService();
    const onProgress = jest.fn();
    const checkCancellation = jest.fn();

    await expect(service.exportResultsByVersionAsExcelToFile('/tmp/export.zip', {
      workspaceId: 7,
      version: 'v2',
      authToken: 'token',
      serverUrl: 'http://app.example',
      includeReplayUrl: true,
      includeGeoGebraFiles: true,
      onProgress,
      checkCancellation
    })).resolves.toBeUndefined();

    expect(codingResultsExportService.exportCodingResultsByVersionAsGeoGebraZipToFile).toHaveBeenCalledWith(
      '/tmp/export.zip',
      7,
      'v2',
      'token',
      'http://app.example',
      true,
      onProgress,
      checkCancellation
    );
    expect(codingResultsExportService.exportCodingResultsByVersionAsExcelToFile).not.toHaveBeenCalled();
  });

  it('routes item matrix CSV exports to the item matrix export service', async () => {
    const { service, codingItemMatrixExportService } = createService();
    const csvStream = Readable.from(['csv']);
    const onProgress = jest.fn();
    const checkCancellation = jest.fn();
    codingItemMatrixExportService.exportItemMatrixAsCsvStream.mockReturnValue(csvStream);

    await expect(service.exportItemMatrixAsCsv({
      workspaceId: 7,
      matrixValue: 'code',
      version: 'v1',
      onProgress,
      checkCancellation
    })).resolves.toBe(csvStream);

    expect(codingItemMatrixExportService.exportItemMatrixAsCsvStream).toHaveBeenCalledWith(
      7,
      'code',
      'v1',
      onProgress,
      checkCancellation
    );
  });

  it('routes item matrix Excel exports to the item matrix export service', async () => {
    const { service, codingItemMatrixExportService } = createService();
    const buffer = Buffer.from('xlsx');
    codingItemMatrixExportService.exportItemMatrixAsExcel.mockResolvedValue(buffer);

    await expect(service.exportItemMatrixAsExcel({
      workspaceId: 7,
      matrixValue: 'score',
      version: 'v2'
    })).resolves.toBe(buffer);

    expect(codingItemMatrixExportService.exportItemMatrixAsExcel).toHaveBeenCalledWith(
      7,
      'score',
      'v2',
      undefined,
      undefined
    );
  });

  it('routes item matrix Excel file exports to the item matrix export service', async () => {
    const { service, codingItemMatrixExportService } = createService();
    const onProgress = jest.fn();
    const checkCancellation = jest.fn();

    await expect(service.exportItemMatrixAsExcelToFile('/tmp/matrix.xlsx', {
      workspaceId: 7,
      matrixValue: 'score',
      version: 'v2',
      onProgress,
      checkCancellation
    })).resolves.toBeUndefined();

    expect(codingItemMatrixExportService.writeItemMatrixExcelToFile).toHaveBeenCalledWith(
      '/tmp/matrix.xlsx',
      7,
      'score',
      'v2',
      onProgress,
      checkCancellation
    );
  });

  it('routes unscoped detailed exports to the specialized batched results export service', async () => {
    const { service, codingExportService, codingResultsExportService } = createService();
    const buffer = Buffer.from('csv');
    const checkCancellation = jest.fn();
    const req = {} as never;
    codingResultsExportService.exportCodingResultsDetailed.mockResolvedValue(buffer);

    await expect(service.exportDetailed({
      workspaceId: 5,
      outputCommentsInsteadOfCodes: true,
      includeReplayUrl: true,
      anonymizeCoders: true,
      usePseudoCoders: false,
      authToken: 'token',
      req,
      excludeAutoCoded: true,
      checkCancellation
    })).resolves.toBe(buffer);

    expect(codingResultsExportService.exportCodingResultsDetailed).toHaveBeenCalledWith(
      5,
      true,
      true,
      true,
      false,
      'token',
      req,
      true,
      checkCancellation
    );
    expect(codingExportService.exportCodingResultsDetailed).not.toHaveBeenCalled();
  });

  it('keeps scoped detailed exports on the monolithic path to preserve job filters', async () => {
    const { service, codingExportService, codingResultsExportService } = createService();
    const buffer = Buffer.from('csv');
    const checkCancellation = jest.fn();
    codingExportService.exportCodingResultsDetailed.mockResolvedValue(buffer);

    await expect(service.exportDetailed({
      workspaceId: 5,
      outputCommentsInsteadOfCodes: true,
      includeReplayUrl: true,
      anonymizeCoders: true,
      usePseudoCoders: false,
      authToken: 'token',
      excludeAutoCoded: true,
      checkCancellation,
      jobDefinitionIds: [1],
      coderTrainingIds: [2],
      coderIds: [3],
      serverUrl: 'http://app.example'
    })).resolves.toBe(buffer);

    expect(codingExportService.exportCodingResultsDetailed).toHaveBeenCalledWith(
      5,
      true,
      true,
      true,
      false,
      'token',
      undefined,
      true,
      checkCancellation,
      [1],
      [2],
      [3],
      'http://app.example'
    );
    expect(codingResultsExportService.exportCodingResultsDetailed).not.toHaveBeenCalled();
  });

  it('keeps background detailed replay URL exports on the monolithic path', async () => {
    const { service, codingExportService, codingResultsExportService } = createService();
    const buffer = Buffer.from('csv');
    codingExportService.exportCodingResultsDetailed.mockResolvedValue(buffer);

    await expect(service.exportDetailed({
      workspaceId: 5,
      includeReplayUrl: true,
      serverUrl: 'http://app.example'
    })).resolves.toBe(buffer);

    expect(codingExportService.exportCodingResultsDetailed).toHaveBeenCalledWith(
      5,
      false,
      true,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'http://app.example'
    );
    expect(codingResultsExportService.exportCodingResultsDetailed).not.toHaveBeenCalled();
  });
});
