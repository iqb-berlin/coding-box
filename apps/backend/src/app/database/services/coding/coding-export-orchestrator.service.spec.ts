import { Readable } from 'stream';
import type { CodingExportService } from './coding-export.service';
import { CodingExportOrchestratorService } from './coding-export-orchestrator.service';
import type { CodingItemMatrixExportService } from './coding-item-matrix-export.service';
import type { CodingListService } from './coding-list.service';

jest.mock('./coding-export.service', () => ({
  CodingExportService: jest.fn()
}));

describe('CodingExportOrchestratorService', () => {
  const createService = () => {
    const codingExportService = {
      exportCodingResultsDetailed: jest.fn(),
      exportCodingResultsDetailedToFile: jest.fn().mockResolvedValue(undefined)
    };
    const codingListService = {
      getCodingResultsByVersionCsvStream: jest.fn(),
      getCodingResultsByVersionAsExcel: jest.fn(),
      writeCodingResultsByVersionExcelToFile: jest.fn().mockResolvedValue(undefined),
      getCodingResultsByVersionAsGeoGebraZip: jest.fn(),
      writeCodingResultsByVersionGeoGebraZipToFile: jest.fn().mockResolvedValue(undefined)
    };
    const codingItemMatrixExportService = {
      exportItemMatrixAsCsvStream: jest.fn(),
      exportItemMatrixAsExcel: jest.fn(),
      writeItemMatrixExcelToFile: jest.fn().mockResolvedValue(undefined)
    };

    const service = new CodingExportOrchestratorService(
      codingExportService as unknown as CodingExportService,
      codingListService as unknown as CodingListService,
      codingItemMatrixExportService as unknown as CodingItemMatrixExportService
    );

    return {
      service,
      codingExportService,
      codingListService,
      codingItemMatrixExportService
    };
  };

  it('routes versioned CSV exports directly to the streaming coding-list service', async () => {
    const { service, codingListService } = createService();
    const csvStream = Readable.from(['csv']);
    const onProgress = jest.fn();
    codingListService.getCodingResultsByVersionCsvStream.mockResolvedValue(csvStream);

    await expect(service.exportResultsByVersionAsCsv({
      workspaceId: 7,
      version: 'v3',
      authToken: 'token',
      serverUrl: 'http://app.example',
      includeReplayUrl: true,
      includeResponseValues: false,
      onProgress
    })).resolves.toBe(csvStream);

    expect(codingListService.getCodingResultsByVersionCsvStream).toHaveBeenCalledWith(
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
    const { service, codingListService } = createService();
    const buffer = Buffer.from('xlsx');
    codingListService.getCodingResultsByVersionAsExcel.mockResolvedValue(buffer);

    await expect(service.exportResultsByVersionAsExcel({
      workspaceId: 7,
      version: 'v2',
      includeResponseValues: true,
      includeGeoGebraResponseValues: true
    })).resolves.toBe(buffer);

    expect(codingListService.getCodingResultsByVersionAsExcel).toHaveBeenCalledWith(
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
    const { service, codingListService } = createService();
    const buffer = Buffer.from('zip');
    const onProgress = jest.fn();
    codingListService.getCodingResultsByVersionAsGeoGebraZip.mockResolvedValue(buffer);

    await expect(service.exportResultsByVersionAsExcel({
      workspaceId: 7,
      version: 'v2',
      authToken: 'token',
      serverUrl: 'http://app.example',
      includeReplayUrl: true,
      includeGeoGebraFiles: true,
      onProgress
    })).resolves.toBe(buffer);

    expect(codingListService.getCodingResultsByVersionAsGeoGebraZip).toHaveBeenCalledWith(
      7,
      'v2',
      'token',
      'http://app.example',
      true,
      onProgress,
      undefined
    );
    expect(codingListService.getCodingResultsByVersionAsExcel).not.toHaveBeenCalled();
  });

  it('routes versioned Excel file exports directly to the streaming coding-list service', async () => {
    const { service, codingListService } = createService();
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

    expect(codingListService.writeCodingResultsByVersionExcelToFile).toHaveBeenCalledWith(
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
    const { service, codingListService } = createService();
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

    expect(codingListService.writeCodingResultsByVersionGeoGebraZipToFile).toHaveBeenCalledWith(
      '/tmp/export.zip',
      7,
      'v2',
      'token',
      'http://app.example',
      true,
      onProgress,
      checkCancellation
    );
    expect(codingListService.writeCodingResultsByVersionExcelToFile).not.toHaveBeenCalled();
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

  it('routes unscoped detailed exports to the cancellable export service', async () => {
    const { service, codingExportService } = createService();
    const buffer = Buffer.from('csv');
    const checkCancellation = jest.fn();
    const req = {} as never;
    codingExportService.exportCodingResultsDetailed.mockResolvedValue(buffer);

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

    expect(codingExportService.exportCodingResultsDetailed).toHaveBeenCalledWith(
      5,
      true,
      true,
      true,
      false,
      'token',
      req,
      true,
      checkCancellation,
      undefined,
      undefined,
      undefined,
      ''
    );
  });

  it('keeps scoped detailed exports on the monolithic path to preserve job filters', async () => {
    const { service, codingExportService } = createService();
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
  });

  it('keeps background detailed replay URL exports on the monolithic path', async () => {
    const { service, codingExportService } = createService();
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
  });

  it('routes detailed file exports to the monolithic file export path', async () => {
    const { service, codingExportService } = createService();
    const checkCancellation = jest.fn();

    await expect(service.exportDetailedToFile('/tmp/detailed.csv', {
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
    })).resolves.toBeUndefined();

    expect(codingExportService.exportCodingResultsDetailedToFile).toHaveBeenCalledWith(
      '/tmp/detailed.csv',
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
  });
});
