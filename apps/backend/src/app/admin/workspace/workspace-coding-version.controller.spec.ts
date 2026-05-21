import { Logger } from '@nestjs/common';
import { WorkspaceCodingVersionController } from './workspace-coding-version.controller';
import { CodingStatisticsService } from '../../database/services/coding';
import { JournalService } from '../../database/services/shared';
import { JobQueueService } from '../../job-queue/job-queue.service';

describe('WorkspaceCodingVersionController', () => {
  it('still returns the queued reset job when audit event recording fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const jobQueueService = {
      assertNoDependencyConflicts: jest.fn().mockResolvedValue(undefined),
      addResetCodingVersionJob: jest.fn().mockResolvedValue({ id: 'reset-job-1' })
    } as unknown as JobQueueService;
    const journalService = {
      recordEvent: jest.fn().mockRejectedValue(new Error('journal unavailable'))
    } as unknown as JournalService;
    const controller = new WorkspaceCodingVersionController(
      {} as CodingStatisticsService,
      journalService,
      jobQueueService
    );

    await expect(
      controller.resetCodingVersion(
        7,
        { version: 'v2', unitFilters: ['unit-a'] },
        { user: { id: 'user-1' } } as never
      )
    ).resolves.toEqual({
      jobId: 'reset-job-1',
      message: 'Reset coding version job enqueued for version v2'
    });

    expect(journalService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        actorUserId: 'user-1',
        eventType: 'CODING_VERSION_RESET',
        jobId: 'reset-job-1'
      })
    );
    loggerSpy.mockRestore();
  });
});
