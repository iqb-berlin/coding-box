import { CodingStatusRevisionRecoverySchedulerService } from './coding-status-revision-recovery-scheduler.service';

describe('CodingStatusRevisionRecoverySchedulerService', () => {
  it('runs revision recovery and deduplicates overlapping scheduler calls', async () => {
    let resolveRecovery: (count: number) => void = () => undefined;
    const recovery = new Promise<number>(resolve => {
      resolveRecovery = resolve;
    });
    const codingFreshnessService = {
      reconcileRecoverableWorkspaceRevisionFailures: jest.fn()
        .mockReturnValue(recovery)
    };
    const service = new CodingStatusRevisionRecoverySchedulerService(
      codingFreshnessService as never
    );

    const firstRun = service.recoverWorkspaceRevisionFailures();
    const overlappingRun = service.recoverWorkspaceRevisionFailures();
    resolveRecovery(1);
    await Promise.all([firstRun, overlappingRun]);

    expect(
      codingFreshnessService.reconcileRecoverableWorkspaceRevisionFailures
    ).toHaveBeenCalledTimes(1);
  });

  it('does not reject the scheduler run when recovery fails', async () => {
    const codingFreshnessService = {
      reconcileRecoverableWorkspaceRevisionFailures: jest.fn()
        .mockRejectedValue(new Error('database unavailable'))
    };
    const service = new CodingStatusRevisionRecoverySchedulerService(
      codingFreshnessService as never
    );

    await expect(service.recoverWorkspaceRevisionFailures())
      .resolves.toBeUndefined();
  });
});
