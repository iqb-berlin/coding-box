import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { Readable, Writable } from 'stream';
import { WorkspaceCodingCodebookController } from './workspace-coding-codebook.controller';
import { CodeBookContentSetting } from '../code-book/codebook.interfaces';
import { CodebookJobResult } from '../../job-queue/job-queue.service';

const contentOptions: CodeBookContentSetting = {
  exportFormat: 'json',
  missingsProfile: '',
  hasOnlyManualCoding: true,
  hasGeneralInstructions: true,
  hasDerivedVars: true,
  hasOnlyVarsWithCodes: true,
  hasClosedVars: true,
  codeLabelToUpper: true,
  showScore: true,
  hideItemVarRelation: true
};

const codebookResult: CodebookJobResult = {
  fileId: '42',
  fileName: 'codebook_42.json',
  filePath: '/server/temp/codebook_42.json',
  fileSize: 2,
  workspaceId: 12,
  exportFormat: 'json',
  createdAt: 1
};

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  removeHeader: jest.Mock;
};

const createMockResponse = (): MockResponse => {
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  }) as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  response.setHeader = jest.fn();
  response.removeHeader = jest.fn();
  return response;
};

describe('WorkspaceCodingCodebookController', () => {
  const codebookGenerationService = {
    generateCodebook: jest.fn()
  };
  const jobQueueService = {
    addCodebookGenerationJob: jest.fn(),
    getCodebookGenerationJob: jest.fn()
  };
  const cacheService = {
    get: jest.fn(),
    delete: jest.fn()
  };
  let controller: WorkspaceCodingCodebookController;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    controller = new WorkspaceCodingCodebookController(
      codebookGenerationService as never,
      jobQueueService as never,
      cacheService as never
    );
  });

  it('normalizes and validates codebook job requests', async () => {
    jobQueueService.addCodebookGenerationJob.mockResolvedValue({ id: 42 });

    await controller.startCodebookJob(12, {
      missingsProfile: '3',
      contentOptions: {
        ...contentOptions,
        exportFormat: 'DOCX' as never
      },
      unitList: ['1', 2, 2]
    });

    expect(jobQueueService.addCodebookGenerationJob).toHaveBeenCalledWith({
      workspaceId: 12,
      missingsProfile: 3,
      contentOptions: {
        ...contentOptions,
        exportFormat: 'docx',
        missingsProfile: '3'
      },
      unitIds: [1, 2]
    });
  });

  it('rejects unsupported codebook export formats', async () => {
    await expect(
      controller.startCodebookJob(12, {
        missingsProfile: 0,
        contentOptions: {
          ...contentOptions,
          exportFormat: 'pdf' as never
        },
        unitList: [1]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobQueueService.addCodebookGenerationJob).not.toHaveBeenCalled();
  });

  it.each([
    { missingsProfile: true, unitList: [1] },
    { missingsProfile: '', unitList: [1] },
    { missingsProfile: '1.2', unitList: [1] },
    { missingsProfile: 1, unitList: [true] },
    { missingsProfile: 1, unitList: [' '] },
    { missingsProfile: 1, unitList: [1.2] }
  ])('rejects non-integer request values %#', async requestPatch => {
    await expect(
      controller.startCodebookJob(12, {
        missingsProfile: requestPatch.missingsProfile,
        contentOptions,
        unitList: requestPatch.unitList
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobQueueService.addCodebookGenerationJob).not.toHaveBeenCalled();
  });

  it('does not expose server file paths in completed job status responses', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    cacheService.get.mockResolvedValue(codebookResult);
    jobQueueService.getCodebookGenerationJob.mockResolvedValue({
      data: { workspaceId: 12 },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100),
      failedReason: undefined,
      returnvalue: codebookResult
    });

    const result = await controller.getCodebookJobStatus(12, '42');

    expect(result).toMatchObject({
      status: 'completed',
      result: {
        fileId: '42',
        fileName: 'codebook_42.json',
        fileSize: 2,
        workspaceId: 12,
        exportFormat: 'json',
        createdAt: 1
      }
    });
    expect(JSON.stringify(result)).not.toContain('filePath');
  });

  it('reports completed codebook jobs as failed when the result file is expired', async () => {
    cacheService.get.mockResolvedValue(null);
    jobQueueService.getCodebookGenerationJob.mockResolvedValue({
      data: { workspaceId: 12 },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100),
      failedReason: undefined,
      returnvalue: codebookResult
    });

    const result = await controller.getCodebookJobStatus(12, '42');

    expect(result).toEqual({
      status: 'failed',
      progress: 100,
      error: 'Codebook file expired'
    });
  });

  it('clears stale codebook cache entries when completed result files are missing', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    cacheService.get.mockResolvedValue(codebookResult);
    jobQueueService.getCodebookGenerationJob.mockResolvedValue({
      data: { workspaceId: 12 },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100),
      failedReason: undefined,
      returnvalue: codebookResult
    });

    const result = await controller.getCodebookJobStatus(12, '42');

    expect(result).toMatchObject({
      status: 'failed',
      error: 'Codebook file expired'
    });
    expect(cacheService.delete).toHaveBeenCalledWith('codebook-result:42');
  });

  it('rejects completed job status when cached metadata does not match the job result', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    cacheService.get.mockResolvedValue({
      ...codebookResult,
      fileId: 'foreign-result'
    });
    jobQueueService.getCodebookGenerationJob.mockResolvedValue({
      data: { workspaceId: 12 },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100),
      failedReason: undefined,
      returnvalue: codebookResult
    });

    const result = await controller.getCodebookJobStatus(12, '42');

    expect(result).toMatchObject({
      status: 'failed',
      error: 'Codebook file expired'
    });
    expect(cacheService.delete).toHaveBeenCalledWith('codebook-result:42');
  });

  it('rejects status access across workspaces', async () => {
    jobQueueService.getCodebookGenerationJob.mockResolvedValue({
      data: { workspaceId: 99 }
    });

    await expect(
      controller.getCodebookJobStatus(12, '42')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('handles codebook stream errors without leaving an unhandled stream error', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    cacheService.get.mockResolvedValue(codebookResult);
    const failingStream = new Readable({
      read() {
        this.destroy(new Error('stream failed'));
      }
    });
    jest
      .spyOn(fs, 'createReadStream')
      .mockReturnValue(failingStream as fs.ReadStream);
    const response = createMockResponse();

    await controller.downloadCodebook('42', 12, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'stream failed' });
    expect(cacheService.delete).not.toHaveBeenCalled();
  });

  it('clears stale codebook cache entries when download files are missing', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    cacheService.get.mockResolvedValue(codebookResult);
    const response = createMockResponse();

    await controller.downloadCodebook('42', 12, response);

    expect(cacheService.delete).toHaveBeenCalledWith('codebook-result:42');
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Codebook file not found on disk'
    });
  });
});
