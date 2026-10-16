import { CodingStatisticsService } from '../../database/services/coding';
import { BullJobManagementService } from '../../database/services/jobs';
import { WorkspaceCodingJobController } from './workspace-coding-job.controller';

describe('WorkspaceCodingJobController job ownership context', () => {
  it.each(['getJobStatus', 'cancelJob', 'deleteJob'] as const)(
    'passes the URL workspace to %s', async operation => {
      const statistics = {
        [operation]: jest.fn().mockResolvedValue({ success: false })
      };
      const controller = new WorkspaceCodingJobController(
        {} as BullJobManagementService,
        statistics as unknown as CodingStatisticsService
      );

      await controller[operation](42, '17');

      expect(statistics[operation]).toHaveBeenCalledWith('17', 42);
    }
  );

  it.each(['pauseJob', 'resumeJob', 'restartJob'] as const)(
    'passes the URL workspace to %s', async operation => {
      const jobs = {
        [operation]: jest.fn().mockResolvedValue({ success: false })
      };
      const controller = new WorkspaceCodingJobController(
        jobs as unknown as BullJobManagementService,
        {} as CodingStatisticsService
      );

      await controller[operation](42, '17');

      expect(jobs[operation]).toHaveBeenCalledWith('17', 42);
    }
  );
});
