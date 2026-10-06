import * as fs from 'fs';
import { DatabaseExportProcessor } from './database-export.processor';
import { DatabaseExportCancelledError } from './database-export-cancelled.error';

jest.mock('./database-export.service', () => ({ DatabaseExportService: class {} }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(true),
  statSync: jest.fn().mockReturnValue({ size: 42 }),
  unlinkSync: jest.fn()
}));

describe('Database export audit outcomes', () => {
  function fixture(scope: 'workspace' | 'system' = 'workspace') {
    const exportService = { exportWorkspaceToSqliteFile: jest.fn(), exportToSqliteFile: jest.fn() };
    const journalService = { recordEvent: jest.fn().mockResolvedValue({}) };
    const job = { id: '123', data: { scope, workspaceId: 3, requestedByUserId: 7 }, progress: jest.fn() };
    const processor = new DatabaseExportProcessor(exportService as never, journalService as never);
    return {
      exportService, journalService, job, processor
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('records completion before returning a downloadable workspace export', async () => {
    const f = fixture();
    await expect(f.processor.process(f.job as never)).resolves.toMatchObject({ scope: 'workspace', workspaceId: 3 });
    expect(f.journalService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 3,
      actorUserId: 7,
      actorType: 'job',
      jobId: '123',
      eventType: 'DATABASE_EXPORT_COMPLETED',
      result: 'success',
      details: { fileSize: 42 }
    }));
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it.each([new Error('export failed'), new DatabaseExportCancelledError()])('cleans up and records failure for %s', async error => {
    const f = fixture();
    f.exportService.exportWorkspaceToSqliteFile.mockRejectedValueOnce(error);
    await expect(f.processor.process(f.job as never)).rejects.toThrow(error);
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(f.journalService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'DATABASE_EXPORT_FAILED', result: 'failure', details: { cancelled: error instanceof DatabaseExportCancelledError }
    }));
  });

  it('does not expose an export whose completion could not be audited', async () => {
    const f = fixture();
    f.journalService.recordEvent.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.processor.process(f.job as never)).rejects.toThrow('audit unavailable');
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('does not misattribute a system export to a workspace', async () => {
    const f = fixture('system');
    await f.processor.process(f.job as never);
    expect(f.journalService.recordEvent).not.toHaveBeenCalled();
  });
});
