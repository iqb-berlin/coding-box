import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';
import { AppService } from '../../../core/services/app.service';
import { ResponseMatchingFlag } from '../../../shared/services/workspace/workspace-settings.service';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { DoubleCodedReviewApiService } from '../../services/double-coded-review-api.service';
import { ManualCodingVariableCoverageOverview } from '../../services/manual-coding-planning-snapshot.model';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { ManualCodingPlanningFacade } from './manual-coding-planning.facade';
import { ManualCodingSettingsFacade } from './manual-coding-settings.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

@Component({
  standalone: true,
  template: '<span class="count">{{statistics.variableCoverageOverview()?.totalVariables}}</span><span class="analysis">{{analysis.responseAnalysis()?.analysisTimestamp}}</span>',
  providers: [ManualCodingStatisticsFacade, ManualCodingSettingsFacade, ManualCodingAnalysisFacade, ManualCodingPlanningFacade]
})
class ManualFacadeHost {
  readonly planning = inject(ManualCodingPlanningFacade);
  readonly statistics = inject(ManualCodingStatisticsFacade);
  readonly settings = inject(ManualCodingSettingsFacade);
  readonly analysis = inject(ManualCodingAnalysisFacade);
  constructor() {
    this.analysis.setViewActivity(() => true);
    this.analysis.reloadRequested$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.analysis.loadResponseAnalysis());
  }
}

const coverage = (totalVariables: number): ManualCodingVariableCoverageOverview => ({
  totalVariables,
  coveredVariables: 0,
  coveredByDraft: 0,
  coveredByPendingReview: 0,
  coveredByApproved: 0,
  conflictedVariables: 0,
  missingVariables: totalVariables,
  coveragePercentage: 0,
  variableCaseCounts: [],
  coverageByStatus: {
    draft: [], pending_review: [], approved: [], conflicted: []
  }
});
const analysisValue = (isCalculating = false): ResponseAnalysisDto => ({
  isCalculating,
  analysisTimestamp: 'current',
  emptyResponses: { total: 0, totalUncoded: 0, items: [] },
  duplicateValues: {
    total: 0, totalResponses: 0, groups: [], isAggregationApplied: false
  }
} as ResponseAnalysisDto);

describe('manual coding feature lifetimes in native zoneless mode', () => {
  let fixture: ComponentFixture<ManualFacadeHost>;
  let host: ManualFacadeHost;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let api: {
    getVariableCoverageOverview: jest.Mock; getResponseAnalysis: jest.Mock; saveAggregationSettings: jest.Mock;
    setResponseAnalysisGuardRunning: jest.Mock; trackResponseAnalysisGuardUntilComplete: jest.Mock;
    saveManualCodingPlanningSnapshot: jest.Mock; beginManualCodingPlanningSnapshot?: jest.Mock;
  };
  let snack: { open: jest.Mock };
  const changeWorkspace = (id: number): void => { app.selectedWorkspaceId = id; app.selectedWorkspaceId$.next(id); };

  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    api = {
      getVariableCoverageOverview: jest.fn(),
      getResponseAnalysis: jest.fn(),
      saveAggregationSettings: jest.fn(),
      setResponseAnalysisGuardRunning: jest.fn(),
      trackResponseAnalysisGuardUntilComplete: jest.fn(),
      saveManualCodingPlanningSnapshot: jest.fn()
    };
    snack = { open: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ManualFacadeHost],
      providers: [
        { provide: AppService, useValue: app }, { provide: TestPersonCodingService, useValue: api },
        { provide: CodingJobBackendService, useValue: {} }, { provide: CodingStatisticsService, useValue: {} },
        { provide: DoubleCodedReviewApiService, useValue: {} }, { provide: CodingBackgroundJobsService, useValue: {} },
        { provide: MatSnackBar, useValue: snack }, { provide: TranslateService, useValue: { instant: (key: string) => key } }
      ]
    });
    fixture = TestBed.createComponent(ManualFacadeHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); jest.useRealTimers(); });

  it('exposes read-only settings and event streams and owns restored snapshots', () => {
    const flags = [ResponseMatchingFlag.NO_AGGREGATION];
    const localFlags = [ResponseMatchingFlag.NO_AGGREGATION, ResponseMatchingFlag.IGNORE_CASE];
    host.settings.restoreSettings({ flags, threshold: 1 }, localFlags);
    flags.push(ResponseMatchingFlag.IGNORE_WHITESPACE);
    localFlags.length = 0;
    expect(host.settings.persistedResponseMatchingFlags).toEqual([ResponseMatchingFlag.NO_AGGREGATION]);
    expect(host.settings.responseMatchingFlags()).toEqual([ResponseMatchingFlag.NO_AGGREGATION, ResponseMatchingFlag.IGNORE_CASE]);
    expect(host.settings.duplicateAggregationThreshold()).toBe(2);
    expect('set' in host.settings.responseMatchingFlags).toBe(false);
    expect('set' in host.settings.duplicateAggregationThreshold).toBe(false);
    expect('next' in host.settings.thresholdSaved$).toBe(false);
    expect('next' in host.planning.restored$).toBe(false);
    expect('next' in host.planning.freshnessRefreshRequested$).toBe(false);
  });

  it('exposes statistics, analysis and loading state without writable signal APIs', () => {
    for (const state of [
      host.statistics.variableCoverageOverview, host.statistics.codingProgressOverview,
      host.statistics.isLoadingVariableCoverage, host.statistics.isLoadingManualCodingScopeSummary,
      host.analysis.responseAnalysis, host.analysis.responseAnalysisError,
      host.analysis.emptyPageIndex, host.analysis.isLoadingResponseAnalysis
    ]) {
      expect('set' in state).toBe(false);
      expect('update' in state).toBe(false);
    }
    host.analysis.changeEmptyPage(2, 25);
    host.analysis.changeDuplicatePage(3, 50);
    expect(host.analysis.emptyPageIndex()).toBe(2);
    host.analysis.resetPages();
    expect(host.analysis.emptyPageIndex()).toBe(0);
    expect(host.analysis.duplicatePageIndex()).toBe(0);
    expect(host.analysis.emptyPageSize()).toBe(25);
    host.statistics.restorePlanningSnapshot({ variableCoverageOverview: coverage(4) });
    expect(host.statistics.variableCoverageOverview()?.totalVariables).toBe(4);
  });

  it('renders a delayed statistic and cancels its superseded request', async () => {
    const old = new Subject<ManualCodingVariableCoverageOverview>();
    const latest = new Subject<ManualCodingVariableCoverageOverview>();
    api.getVariableCoverageOverview.mockReturnValueOnce(old).mockReturnValueOnce(latest);
    host.statistics.loadVariableCoverageOverview();
    host.statistics.loadVariableCoverageOverview();
    expect(old.observed).toBe(false);
    latest.next(coverage(7)); latest.complete();
    old.next(coverage(99));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.count').textContent).toBe('7');
    expect(host.statistics.isLoadingVariableCoverage()).toBe(false);
  });

  it.each(['workspace', 'destroy'] as const)('unsubscribes statistics on %s and ignores late results', target => {
    const pending = new Subject<ManualCodingVariableCoverageOverview>();
    api.getVariableCoverageOverview.mockReturnValue(pending);
    host.statistics.loadVariableCoverageOverview();
    if (target === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
    expect(pending.observed).toBe(false);
    pending.next(coverage(99));
    expect(host.statistics.variableCoverageOverview()).toBeNull();
  });

  it('releases failed statistics and renders a later retry without detectChanges', async () => {
    const failed = new Subject<ManualCodingVariableCoverageOverview>();
    api.getVariableCoverageOverview.mockReturnValueOnce(failed).mockReturnValueOnce(of(coverage(3)));
    host.statistics.loadVariableCoverageOverview();
    failed.error(new Error('offline'));
    expect(host.statistics.isLoadingVariableCoverage()).toBe(false);
    host.statistics.loadVariableCoverageOverview();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.count').textContent).toBe('3');
  });

  it('retains the background guard on a polling error and retries once the timer elapses', () => {
    jest.useFakeTimers();
    const first = new Subject<ResponseAnalysisDto>();
    const failed = new Subject<ResponseAnalysisDto>();
    api.getResponseAnalysis.mockReturnValueOnce(first).mockReturnValueOnce(failed).mockReturnValue(of(analysisValue()));
    host.analysis.loadResponseAnalysis(); first.next(analysisValue(true)); first.complete();
    jest.advanceTimersByTime(5000); failed.error(new Error('temporary'));
    expect(host.analysis.responseAnalysisGuardActive).toBe(true);
    expect(snack.open).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(api.getResponseAnalysis).toHaveBeenCalledTimes(3);
    expect(host.analysis.responseAnalysisGuardActive).toBe(false);
    jest.advanceTimersByTime(15000);
    expect(api.getResponseAnalysis).toHaveBeenCalledTimes(3);
  });

  it('never caches a planning bundle between a failed analysis and its error state update', () => {
    const pending = new Subject<ResponseAnalysisDto>();
    api.getResponseAnalysis.mockReturnValue(pending);
    api.beginManualCodingPlanningSnapshot = jest.fn(() => 1);
    host.planning.beginPlanningDataRefresh();
    host.analysis.loadResponseAnalysis();
    pending.error(new Error('offline'));
    expect(api.saveManualCodingPlanningSnapshot).not.toHaveBeenCalled();
    expect(host.planning.isRefreshPending).toBe(false);
    expect(host.analysis.responseAnalysisError()).toContain('offline');
  });

  it('hands off calculating work when leaving the analysis view and removes its timer', () => {
    jest.useFakeTimers();
    api.getResponseAnalysis.mockReturnValue(of(analysisValue(true)));
    host.analysis.loadResponseAnalysis();
    host.analysis.setViewActivity(() => false);
    host.analysis.stop();
    expect(api.trackResponseAnalysisGuardUntilComplete).toHaveBeenCalledWith(5, 2);
    jest.advanceTimersByTime(15000);
    expect(api.getResponseAnalysis).toHaveBeenCalledTimes(1);
  });

  it('serializes threshold saves and keeps the newest threshold while an earlier save finishes', () => {
    jest.useFakeTimers();
    const first = new Subject<unknown>(); const second = new Subject<unknown>();
    api.saveAggregationSettings.mockReturnValueOnce(first).mockReturnValueOnce(second);
    host.settings.updateLocalMatchingFlags([ResponseMatchingFlag.NO_AGGREGATION, ResponseMatchingFlag.IGNORE_CASE]);
    host.settings.updateThreshold(3); host.settings.saveThreshold(3);
    jest.advanceTimersByTime(1000);
    host.settings.updateThreshold(4); host.settings.saveThreshold(4);
    jest.advanceTimersByTime(1000);
    expect(api.saveAggregationSettings).toHaveBeenCalledTimes(1);
    first.next({ success: true, flags: [ResponseMatchingFlag.NO_AGGREGATION], threshold: 3 }); first.complete();
    expect(host.settings.duplicateAggregationThreshold()).toBe(4);
    expect(api.saveAggregationSettings).toHaveBeenLastCalledWith(5, 4, [ResponseMatchingFlag.NO_AGGREGATION]);
    expect(host.settings.responseMatchingFlags()).toContain(ResponseMatchingFlag.IGNORE_CASE);
    second.next({ success: true, flags: [ResponseMatchingFlag.NO_AGGREGATION], threshold: 4 }); second.complete();
    expect(host.settings.isSavingThreshold()).toBe(false);
  });

  it('does not submit a queued threshold after an A to B to A workspace change', () => {
    jest.useFakeTimers();
    host.settings.saveThreshold(3);
    changeWorkspace(6); changeWorkspace(5);
    jest.advanceTimersByTime(1000);
    expect(api.saveAggregationSettings).not.toHaveBeenCalled();
  });

  it('keeps the newest threshold busy and suppresses old errors during debounce', () => {
    jest.useFakeTimers();
    const old = new Subject<unknown>();
    api.saveAggregationSettings.mockReturnValueOnce(old).mockReturnValue(of({ success: true, flags: [], threshold: 4 }));
    host.settings.saveThreshold(3);
    expect(host.settings.isSavingThreshold()).toBe(true);
    jest.advanceTimersByTime(1000);
    host.settings.updateThreshold(4);
    host.settings.saveThreshold(4);
    old.error(new Error('old failure'));
    expect(snack.open).not.toHaveBeenCalled();
    expect(host.settings.duplicateAggregationThreshold()).toBe(4);
    expect(host.settings.isSavingThreshold()).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(host.settings.isSavingThreshold()).toBe(false);
    expect(api.saveAggregationSettings).toHaveBeenCalledTimes(2);
  });

  it('allows retrying the same threshold after a failed save', () => {
    jest.useFakeTimers();
    const failed = new Subject<unknown>();
    api.saveAggregationSettings.mockReturnValueOnce(failed).mockReturnValue(of({ success: true, flags: [], threshold: 3 }));
    host.settings.saveThreshold(3); jest.advanceTimersByTime(1000); failed.error(new Error('offline'));
    host.settings.saveThreshold(3); jest.advanceTimersByTime(1000);
    expect(api.saveAggregationSettings).toHaveBeenCalledTimes(2);
    expect(host.settings.duplicateAggregationThreshold()).toBe(3);
    expect(host.settings.isSavingThreshold()).toBe(false);
  });
});
