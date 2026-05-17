import { BadRequestException } from '@nestjs/common';
import { WorkspaceCodingImportController } from './workspace-coding-import.controller';

describe('WorkspaceCodingImportController', () => {
  const createController = () => {
    const externalCodingImportService = {
      importExternalCoding: jest.fn().mockResolvedValue({
        message: 'preview',
        processedRows: 1,
        updatedRows: 0,
        errors: [],
        affectedRows: []
      })
    };
    const jobQueueService = {
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined)
    };
    const cacheService = { get: jest.fn() };

    return {
      controller: new WorkspaceCodingImportController(
        externalCodingImportService as never,
        jobQueueService as never,
        cacheService as never
      ),
      externalCodingImportService,
      jobQueueService
    };
  };

  it('rejects direct external coding imports that would apply changes synchronously', async () => {
    const { controller, externalCodingImportService, jobQueueService } = createController();

    await expect(controller.importExternalCoding(17, {
      file: 'Zm9v',
      fileName: 'coding.csv',
      previewOnly: false
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(jobQueueService.assertNoDependencyConflicts).not.toHaveBeenCalled();
    expect(externalCodingImportService.importExternalCoding).not.toHaveBeenCalled();
  });

  it('keeps the direct endpoint as preview-only', async () => {
    const { controller, externalCodingImportService, jobQueueService } = createController();

    await expect(controller.importExternalCoding(17, {
      file: 'Zm9v',
      fileName: 'coding.csv',
      previewOnly: true
    })).resolves.toMatchObject({ message: 'preview' });

    expect(jobQueueService.assertNoDependencyConflicts)
      .toHaveBeenCalledWith('external-coding-import', 17);
    expect(externalCodingImportService.importExternalCoding).toHaveBeenCalledWith(
      17,
      {
        file: 'Zm9v',
        fileName: 'coding.csv',
        previewOnly: true
      }
    );
  });
});
