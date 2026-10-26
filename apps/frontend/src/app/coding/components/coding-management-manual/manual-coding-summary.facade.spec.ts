import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';
import { ManualCodingSummaryFacade } from './manual-coding-summary.facade';

describe('ManualCodingSummaryFacade', () => {
  it('derives and memoizes counts and updates them when their source changes', () => {
    const readAvailable = jest.fn(() => 8);
    const progress = signal({ totalCasesToCode: 20, completedCases: 5 });
    const cases = signal({ effectiveUnassignedCases: 8 });
    TestBed.configureTestingModule({
      providers: [ManualCodingSummaryFacade,
        { provide: ManualCodingAnalysisFacade, useValue: { responseAnalysis: signal(null) } },
        {
          provide: ManualCodingStatisticsFacade,
          useValue: {
            codingProgressOverview: progress,
            appliedResultsOverview: signal(null),
            codingIncompleteVariables: signal([{ responseCount: 10, get availableCases() { return readAvailable(); } }]),
            caseCoverageOverview: cases,
            variableCoverageOverview: signal(null),
            manualCodingScopeSummary: signal(null),
            completedJobsReadyForApply: signal([]),
            completedJobsBlockedForReview: signal([]),
            manualCodeAvailabilityWarnings: signal([]),
            manualFreshnessJobSummary: null,
            openDoubleCodingConflictCount: 0
          }
        }]
    });
    const summary = TestBed.inject(ManualCodingSummaryFacade);
    expect(summary.getOpenCodingCases()).toBe(15);
    expect(summary.getAvailableCasesForNewJobs()).toBe(8);
    expect(summary.getAvailableCasesForNewJobs()).toBe(8);
    expect(readAvailable).toHaveBeenCalledTimes(1);
    expect(summary.getUnavailableCasesForNewJobs()).toBe(2);
    progress.set({ totalCasesToCode: 20, completedCases: 25 });
    expect(summary.getOpenCodingCases()).toBe(0);
    cases.set({ effectiveUnassignedCases: 0 });
    expect(summary.getAvailableCasesForNewJobs()).toBe(0);
    expect(summary.getUnavailableCasesForNewJobs()).toBe(10);
  });
});
