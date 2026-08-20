import { AutoCodingRunGuardService } from './auto-coding-run-guard.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingProgressService } from './coding-progress.service';

describe('AutoCodingRunGuardService', () => {
  const codingFreshnessService = {
    assertAutoCodingRunCanStart: jest.fn().mockResolvedValue(undefined),
    getSummary: jest.fn().mockResolvedValue({ currentRevision: 12 }),
    isRevisionCurrent: jest.fn().mockResolvedValue(true),
    reconcileCompletedManualCodingFreshness: jest.fn().mockResolvedValue(0)
  };
  const codingProgressService = {
    getCaseCoverageOverview: jest.fn()
  };
  let service: AutoCodingRunGuardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AutoCodingRunGuardService(
      codingFreshnessService as unknown as CodingFreshnessService,
      codingProgressService as unknown as CodingProgressService
    );
  });

  it('does not calculate manual coverage for the first auto-coding run', async () => {
    await service.assertAutoCodingRunCanStart(7, 1);

    expect(codingProgressService.getCaseCoverageOverview).not.toHaveBeenCalled();
    expect(codingFreshnessService.getSummary).not.toHaveBeenCalled();
    expect(codingFreshnessService.reconcileCompletedManualCodingFreshness)
      .not.toHaveBeenCalled();
    expect(codingFreshnessService.assertAutoCodingRunCanStart).toHaveBeenCalledWith(7, 1);
  });

  it('ignores raw unassigned cases when effective manual coverage is complete', async () => {
    codingProgressService.getCaseCoverageOverview.mockResolvedValue({
      unassignedCases: 838,
      effectiveUnassignedCases: 0
    });

    await service.assertAutoCodingRunCanStart(7, 2);

    expect(codingFreshnessService.assertAutoCodingRunCanStart)
      .toHaveBeenCalledWith(7, 2, []);
    expect(codingFreshnessService.reconcileCompletedManualCodingFreshness)
      .toHaveBeenCalledWith(7, 12);
    expect(codingFreshnessService.isRevisionCurrent).toHaveBeenCalledWith(7, 12);
  });

  it('rejects the second auto-coding run when the workspace revision changes during the check', async () => {
    codingFreshnessService.isRevisionCurrent.mockResolvedValueOnce(false);
    codingProgressService.getCaseCoverageOverview.mockResolvedValue({
      unassignedCases: 0,
      effectiveUnassignedCases: 0
    });

    await expect(service.assertAutoCodingRunCanStart(7, 2))
      .rejects.toThrow('Kodierstand wurde während der Startprüfung geändert');

    expect(codingFreshnessService.reconcileCompletedManualCodingFreshness)
      .toHaveBeenCalledWith(7, 12);
  });

  it('adds an effective manual coverage blocker for the second auto-coding run', async () => {
    codingProgressService.getCaseCoverageOverview.mockResolvedValue({
      unassignedCases: 9,
      effectiveUnassignedCases: 3
    });

    await service.assertAutoCodingRunCanStart(7, 2);

    expect(codingFreshnessService.assertAutoCodingRunCanStart)
      .toHaveBeenCalledWith(7, 2, [{
        version: 'v2',
        state: 'MANUAL_REVIEW_REQUIRED',
        unitCount: 3,
        affectedResponseCount: 9
      }]);
    expect(codingFreshnessService.reconcileCompletedManualCodingFreshness)
      .not.toHaveBeenCalled();
  });
});
