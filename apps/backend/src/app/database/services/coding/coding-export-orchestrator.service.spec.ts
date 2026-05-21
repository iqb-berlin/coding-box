import { Readable } from 'stream';
import type { CodingExportService } from './coding-export.service';
import { CodingExportOrchestratorService } from './coding-export-orchestrator.service';
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
      exportCodingResultsDetailed: jest.fn()
    };

    const service = new CodingExportOrchestratorService(
      codingExportService as unknown as CodingExportService,
      codingResultsExportService as unknown as CodingResultsExportService
    );

    return { service, codingExportService, codingResultsExportService };
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
      false
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
