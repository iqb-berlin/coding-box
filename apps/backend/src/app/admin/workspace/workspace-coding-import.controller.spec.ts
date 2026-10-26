import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceCodingImportController } from './workspace-coding-import.controller';
import { removeExternalCodingImportFile } from '../../job-queue/external-coding-import-file.util';

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
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined),
      addExternalCodingImportJob: jest.fn().mockResolvedValue({ id: 'import-test' })
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

  it.each(['coding.csv', '../../../outside.xlsx', '..\\..\\outside.csv', '/absolute/coding.xls'])(
    'stages imports privately without using filename %s as a disk path', async fileName => {
      const { controller, jobQueueService } = createController();
      let filePath: string | undefined;
      try {
        await expect(controller.applyExternalCodingImport(17, {
          file: Buffer.from('private coding').toString('base64'),
          fileName
        }, { user: { id: 7 } })).resolves.toEqual({ jobId: 'import-test' });
        filePath = jobQueueService.addExternalCodingImportJob.mock.calls[0][0].tempFilePath;
        expect(path.basename(filePath!)).toBe('import');
        expect(fs.statSync(path.dirname(filePath!)).mode % 0o1000).toBe(0o700);
        expect(fs.statSync(filePath!).mode % 0o1000).toBe(0o600);
        expect(fs.readFileSync(filePath!, 'utf8')).toBe('private coding');
        expect(jobQueueService.addExternalCodingImportJob).toHaveBeenCalledWith(expect.objectContaining({
          fileName, requestedByUserId: 7
        }));
      } finally {
        if (filePath) removeExternalCodingImportFile(filePath);
      }
    }
  );

  it('removes staged data if queue insertion fails', async () => {
    const { controller, jobQueueService } = createController();
    let filePath = '';
    jobQueueService.addExternalCodingImportJob.mockImplementationOnce(async data => {
      filePath = data.tempFilePath;
      throw new Error('Queue unavailable');
    });
    await expect(controller.applyExternalCodingImport(17, {
      file: Buffer.from('private coding').toString('base64'), fileName: 'coding.csv'
    }, { user: { id: 7 } })).rejects.toThrow('Queue unavailable');
    expect(filePath).not.toBe('');
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(path.dirname(filePath))).toBe(false);
  });

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
