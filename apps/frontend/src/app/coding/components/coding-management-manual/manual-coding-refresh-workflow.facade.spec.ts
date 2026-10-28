import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ManualCodingExportScopeFacade } from './manual-coding-export-scope.facade';
import { ManualCodingJobsRefreshFacade } from './manual-coding-jobs-refresh.facade';
import { ManualCodingTab } from './manual-coding-planning';
import { ManualCodingPlanningFacade } from './manual-coding-planning.facade';
import { ManualCodingRefreshWorkflowFacade, ManualCodingTabLoadOptions } from './manual-coding-refresh-workflow.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

@Component({
  standalone: true,
  template: '{{ loads() }}',
  providers: [ManualCodingRefreshWorkflowFacade]
})
class RefreshHost {
  readonly refresh = inject(ManualCodingRefreshWorkflowFacade);
  readonly loads = signal(0);
}

const statisticLoaders = [
  'loadCodingProgressOverview', 'loadVariableCoverageOverview', 'loadCaseCoverageOverview',
  'loadWorkspaceKappaSummary', 'loadCodingIncompleteVariables', 'loadStatusDistribution',
  'loadStatusDistributionV2', 'loadCompletedJobsReadyForApply', 'loadManualFreshnessDecisionData'
] as const;

describe('ManualCodingRefreshWorkflowFacade', () => {
  let fixture: ComponentFixture<RefreshHost>;
  let refresh: ManualCodingRefreshWorkflowFacade;
  let tab: ManualCodingTab;
  let settingLoaded: boolean;
  let autoRefresh: boolean;
  let workspaceChanges: Subject<number>;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  let jobs: CodingBackgroundJobsService;
  let loadTab: jest.Mock<void, [ManualCodingTab, ManualCodingTabLoadOptions]>;
  let statistics: Record<typeof statisticLoaders[number] | 'loadCodingFreshness' | 'cancelFreshness', jest.Mock>;
  let invalidate: jest.Mock;
  let reloadJobs: jest.Mock;
  let refreshDefinitions: jest.Mock;
  let loadExportDefinitions: jest.Mock;
  let planning: { resetPlanningDataBundleState: jest.Mock; markPlanningDataAvailable: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-27T12:00:00Z').getTime());
    tab = 'execution';
    settingLoaded = true;
    autoRefresh = true;
    workspaceChanges = new Subject<number>();
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: workspaceChanges };
    statistics = Object.fromEntries([...statisticLoaders, 'loadCodingFreshness', 'cancelFreshness']
      .map(name => [name, jest.fn()])) as typeof statistics;
    invalidate = jest.fn();
    reloadJobs = jest.fn();
    refreshDefinitions = jest.fn();
    loadExportDefinitions = jest.fn();
    planning = { resetPlanningDataBundleState: jest.fn(), markPlanningDataAvailable: jest.fn() };
    TestBed.configureTestingModule({
      imports: [RefreshHost],
      providers: [
        { provide: AppService, useValue: app },
        CodingBackgroundJobsService,
        { provide: TestPersonCodingService, useValue: { invalidateCodingStatusCache: invalidate } },
        { provide: ManualCodingStatisticsFacade, useValue: statistics },
        { provide: ManualCodingPlanningFacade, useValue: planning },
        { provide: ManualCodingJobsRefreshFacade, useValue: { reload: reloadJobs } },
        { provide: ManualCodingExportScopeFacade, useValue: { loadJobDefinitionsForExport: loadExportDefinitions } }
      ]
    });
    fixture = TestBed.createComponent(RefreshHost);
    refresh = fixture.componentInstance.refresh;
    loadTab = jest.fn(() => fixture.componentInstance.loads.update(value => value + 1));
    refresh.connect({
      activeTab: () => tab,
      hasLoadedRefreshSetting: () => settingLoaded,
      autoRefreshEnabled: () => autoRefresh,
      loadTabData: loadTab,
      jobDefinitions: () => ({ refresh: refreshDefinitions })
    });
    jobs = TestBed.inject(CodingBackgroundJobsService);
    refresh.start();
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
  });

  function startJob(id = 5): void { jobs.setJobRunning(id, 'freshness-coding', true, 'job'); }
  function endJob(id = 5): void { jobs.setJobRunning(id, 'freshness-coding', false, 'job'); }
  function focus(): void { window.dispatchEvent(new Event('focus')); }
  function workspace(id: number): void {
    app.selectedWorkspaceId = id;
    workspaceChanges.next(id);
  }

  it('loads the existing statistics set and invalidates the planning snapshot', () => {
    refresh.refreshAllStatistics();
    expect(invalidate).toHaveBeenCalledWith(5);
    expect(planning.resetPlanningDataBundleState).toHaveBeenCalledTimes(1);
    expect(planning.markPlanningDataAvailable).toHaveBeenCalledTimes(1);
    statisticLoaders.forEach(name => expect(statistics[name]).toHaveBeenCalledTimes(1));
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
  });

  it('defers statistics during background work and resumes only the active tab once', () => {
    startJob();
    refresh.refreshAllStatistics();
    refresh.refreshAllStatistics();
    statisticLoaders.forEach(name => expect(statistics[name]).not.toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
    expect(loadTab).not.toHaveBeenCalled();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith('execution', { reloadCodingJobs: false });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(undefined);
    expect(reloadJobs).not.toHaveBeenCalled();
    startJob();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
  });

  it.each<ManualCodingTab>(['preparation', 'planning', 'completion'])('keeps %s status data deferred during a manual refresh', activeTab => {
    tab = activeTab;
    startJob();
    refresh.refreshManually();
    expect(loadTab).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith(tab, { reloadCodingJobs: false, forceRefresh: true });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(tab === 'planning' ? 0 : 1);
  });

  it.each<ManualCodingTab>(['training', 'execution'])('reveals %s lists immediately while deferring guarded status checks', activeTab => {
    tab = activeTab;
    autoRefresh = false;
    startJob();
    refresh.refreshManually();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith(tab, {
      forceRefresh: true, reloadCodingJobs: true, codingJobsReloadScope: 'active', deferStatusChecks: true
    });
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    endJob();
    expect(loadTab).toHaveBeenLastCalledWith(tab, { reloadCodingJobs: false, forceRefresh: true });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(true);
  });

  it('coalesces repeated pending requests without downgrading forced refreshes', () => {
    startJob();
    refresh.refreshAllStatistics();
    refresh.loadCodingFreshness();
    refresh.refreshManually();
    refresh.refreshManually();
    refresh.refreshAllStatistics();
    refresh.loadCodingFreshness();
    loadTab.mockClear(); // Immediate list reveals are separate from deferred status work.
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith('execution', { reloadCodingJobs: false, forceRefresh: true });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(5);
    expect(loadExportDefinitions).not.toHaveBeenCalled();
    expect(refreshDefinitions).not.toHaveBeenCalled();
  });

  it('keeps a forced freshness-only request when automatic refresh is disabled', () => {
    autoRefresh = false;
    startJob();
    refresh.loadCodingFreshness({ force: true });
    refresh.loadCodingFreshness();
    endJob();
    expect(loadTab).not.toHaveBeenCalled();
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(5);
  });

  it('rechecks automatic policy when a deferred request resumes', () => {
    startJob();
    refresh.loadCodingFreshness();
    autoRefresh = false;
    endJob();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
    expect(statistics.cancelFreshness).toHaveBeenCalled();
  });

  it('uses the current tab when a guarded refresh resumes after a tab change', () => {
    startJob();
    refresh.refreshManually();
    loadTab.mockClear();
    tab = 'planning';
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith('planning', { reloadCodingJobs: false, forceRefresh: true });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(true);
    expect(reloadJobs).not.toHaveBeenCalled();
  });

  it('does not invent a freshness request when a planning refresh resumes on another tab', () => {
    tab = 'planning';
    startJob();
    refresh.refreshManually();
    autoRefresh = false;
    tab = 'execution';
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith('execution', { reloadCodingJobs: false, forceRefresh: true });
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
  });

  it('preserves explicit refresh options and refreshes definitions without loading hidden lists', () => {
    autoRefresh = false;
    refresh.refreshManually();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith('execution', {
      forceRefresh: true, reloadCodingJobs: true, codingJobsReloadScope: 'active'
    });
    expect(loadExportDefinitions).toHaveBeenCalledTimes(1);
    expect(refreshDefinitions).toHaveBeenCalledTimes(1);
    expect(reloadJobs).not.toHaveBeenCalled();
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(true);
  });

  it.each<ManualCodingTab>(['preparation', 'planning', 'training'])('keeps %s idle on focus', activeTab => {
    tab = activeTab;
    focus();
    expect(loadTab).not.toHaveBeenCalled();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
  });

  it('waits for the refresh setting and respects disabled automatic refresh on focus', () => {
    settingLoaded = false;
    focus();
    settingLoaded = true;
    autoRefresh = false;
    focus();
    expect(loadTab).not.toHaveBeenCalled();
    autoRefresh = true;
    focus();
    expect(loadTab).toHaveBeenCalledTimes(1);
  });

  it('throttles focus for 30 seconds across execution and completion', () => {
    focus();
    tab = 'completion';
    jest.mocked(Date.now).mockReturnValue(Date.now() + 29999);
    focus();
    expect(loadTab).toHaveBeenCalledTimes(1);
    jest.mocked(Date.now).mockReturnValue(Date.now() + 1);
    focus();
    expect(loadTab).toHaveBeenCalledTimes(2);
    expect(loadTab).toHaveBeenLastCalledWith('completion', { reloadCodingJobs: false });
  });

  it('coalesces guarded focus without consuming the focus throttle', () => {
    startJob();
    focus();
    focus();
    expect(loadTab).not.toHaveBeenCalled();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    focus();
    expect(loadTab).toHaveBeenCalledTimes(2);
    focus();
    expect(loadTab).toHaveBeenCalledTimes(2);
  });

  it('cancels freshness while policy is unknown or disabled but allows forced loads', () => {
    settingLoaded = false;
    refresh.loadCodingFreshness();
    expect(statistics.cancelFreshness).toHaveBeenCalledWith();
    settingLoaded = true;
    autoRefresh = false;
    refresh.loadCodingFreshness();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
    refresh.loadCodingFreshness({ force: true, invalidateCache: false });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('clears freshness without a workspace even for a forced request', () => {
    workspace(0);
    refresh.loadCodingFreshness({ force: true });
    expect(statistics.cancelFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.cancelFreshness).toHaveBeenCalledWith(true);
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
  });

  it('waits for the last background job before resuming pending status work', () => {
    startJob();
    jobs.setJobRunning(5, 'autocoder-reset', true, 'reset');
    refresh.refreshAllStatistics();
    endJob();
    expect(loadTab).not.toHaveBeenCalled();
    jobs.setJobRunning(5, 'autocoder-reset', false, 'reset');
    expect(loadTab).toHaveBeenCalledTimes(1);
  });

  it('ignores guard events for another workspace', () => {
    startJob();
    refresh.refreshAllStatistics();
    startJob(6);
    endJob(6);
    expect(loadTab).not.toHaveBeenCalled();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
  });

  it('drops pending state and force flags on A → B → A without resuming old work', () => {
    startJob();
    refresh.refreshManually();
    loadTab.mockClear();
    workspace(6);
    workspace(5);
    endJob();
    expect(loadTab).not.toHaveBeenCalled();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    startJob();
    refresh.refreshAllStatistics();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(loadTab).toHaveBeenCalledWith('execution', { reloadCodingJobs: false });
    expect(statistics.loadCodingFreshness).toHaveBeenCalledTimes(1);
    expect(statistics.loadCodingFreshness).toHaveBeenCalledWith(undefined);
  });

  it('drops a freshness-only request on workspace changes', () => {
    startJob();
    refresh.loadCodingFreshness({ force: true });
    workspace(6);
    endJob();
    workspace(5);
    startJob();
    endJob();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
  });

  it('keeps focus throttling local to the current workspace', () => {
    focus();
    workspace(6);
    focus();
    expect(loadTab).toHaveBeenCalledTimes(2);
  });

  it('removes the listener and pending guard continuation when the host is destroyed', () => {
    startJob();
    refresh.refreshAllStatistics();
    refresh.loadCodingFreshness({ force: true });
    fixture.destroy();
    endJob();
    focus();
    refresh.refreshManually();
    refresh.refreshAllStatistics();
    refresh.loadCodingFreshness({ force: true });
    expect(loadTab).not.toHaveBeenCalled();
    expect(statistics.loadCodingFreshness).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('keeps pending refreshes local to their host instance', () => {
    const other = TestBed.createComponent(RefreshHost);
    const otherLoad = jest.fn();
    other.componentInstance.refresh.connect({
      activeTab: () => 'completion',
      hasLoadedRefreshSetting: () => true,
      autoRefreshEnabled: () => true,
      loadTabData: otherLoad,
      jobDefinitions: () => undefined
    });
    other.componentInstance.refresh.start();
    startJob();
    refresh.refreshAllStatistics();
    endJob();
    expect(loadTab).toHaveBeenCalledTimes(1);
    expect(otherLoad).not.toHaveBeenCalled();
    other.destroy();
  });

  it('renders a resumed refresh in the native zoneless host without manual change detection', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toBe('0');
    startJob();
    refresh.refreshAllStatistics();
    endJob();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toBe('1');
  });
});
