import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ManualCodingExportScopeFacade } from './manual-coding-export-scope.facade';
import { CodingJobsReloadScope, ManualCodingJobsRefreshFacade } from './manual-coding-jobs-refresh.facade';
import { ManualCodingTab } from './manual-coding-planning';
import { ManualCodingPlanningFacade } from './manual-coding-planning.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

export interface ManualCodingTabLoadOptions {
  reloadCodingJobs?: boolean;
  codingJobsReloadScope?: CodingJobsReloadScope;
  forceRefresh?: boolean;
  deferStatusChecks?: boolean;
}

/** The page retains tab loading, policy, navigation and deferred view queries. */
export interface ManualCodingRefreshContext {
  activeTab: () => ManualCodingTab;
  hasLoadedRefreshSetting: () => boolean;
  autoRefreshEnabled: () => boolean;
  loadTabData: (tab: ManualCodingTab, options: ManualCodingTabLoadOptions) => void;
  jobDefinitions: () => { refresh(): void } | undefined;
}

/** Admits status refreshes and resumes coalesced requests after background work. */
@Injectable()
export class ManualCodingRefreshWorkflowFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly appService = inject(AppService);
  private readonly backgroundJobs = inject(CodingBackgroundJobsService);
  private readonly coding = inject(TestPersonCodingService);
  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly planning = inject(ManualCodingPlanningFacade);
  private readonly jobsRefresh = inject(ManualCodingJobsRefreshFacade);
  private readonly exportScope = inject(ManualCodingExportScopeFacade);
  private context?: ManualCodingRefreshContext;
  private guardSubscription?: Subscription;
  private stopped = false;
  private lastWindowFocusRefreshAt = 0;
  private pendingManualState = false;
  private pendingForcedManualState = false;
  private pendingFreshness = false;
  private pendingForcedFreshness = false;

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) {
        workspaceId = id;
        this.clearPending();
        this.lastWindowFocusRefreshAt = 0;
      }
    });
    this.destroyRef.onDestroy(() => this.stop());
  }

  connect(context: ManualCodingRefreshContext): void {
    this.context = context;
  }

  start(): void {
    if (this.stopped || this.guardSubscription) return;
    this.guardSubscription = this.backgroundJobs.statusGuardCleared$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        if (event.workspaceId === this.appService.selectedWorkspaceId) this.resumePending();
      });
    this.window?.addEventListener('focus', this.handleWindowFocus);
  }

  stop(): void {
    this.stopped = true;
    this.window?.removeEventListener('focus', this.handleWindowFocus);
    this.guardSubscription?.unsubscribe();
    this.clearPending();
  }

  private readonly handleWindowFocus = (): void => {
    const context = this.context;
    if (this.stopped || !context?.hasLoadedRefreshSetting() || !context.autoRefreshEnabled() ||
      !['execution', 'completion'].includes(context.activeTab())) return;

    const now = Date.now();
    if (now - this.lastWindowFocusRefreshAt < 30000) return;
    if (this.isGuardActive()) {
      this.pendingManualState = true;
      return;
    }

    this.lastWindowFocusRefreshAt = now;
    this.refreshAfterExternalChange();
  };

  refreshAllStatistics(): void {
    if (this.stopped) return;
    if (this.isGuardActive()) {
      this.pendingManualState = true;
      return;
    }

    this.invalidateStatusCache();
    this.planning.markPlanningDataAvailable();
    this.statistics.loadCodingProgressOverview();
    this.statistics.loadVariableCoverageOverview();
    this.statistics.loadCaseCoverageOverview();
    this.statistics.loadWorkspaceKappaSummary();
    this.statistics.loadCodingIncompleteVariables();
    this.statistics.loadStatusDistribution();
    this.statistics.loadStatusDistributionV2();
    this.statistics.loadCompletedJobsReadyForApply();
    this.statistics.loadManualFreshnessDecisionData();
  }

  refreshManually(): void {
    const context = this.context;
    if (this.stopped || !context) return;
    const tab = context.activeTab();
    if (this.isGuardActive()) {
      this.pendingManualState = true;
      this.pendingForcedManualState = true;
      if (tab !== 'planning') {
        this.pendingFreshness = true;
        this.pendingForcedFreshness = true;
      }
      if (tab === 'training' || tab === 'execution') {
        context.loadTabData(tab, {
          forceRefresh: true,
          reloadCodingJobs: true,
          codingJobsReloadScope: 'active',
          deferStatusChecks: true
        });
      }
      return;
    }

    this.invalidateStatusCache();
    context.loadTabData(tab, {
      forceRefresh: true,
      reloadCodingJobs: true,
      codingJobsReloadScope: 'active'
    });
    this.exportScope.loadJobDefinitionsForExport();
    if (tab !== 'planning') this.loadCodingFreshness({ force: true });
    if (tab === 'preparation') this.jobsRefresh.reload('active');
    context.jobDefinitions()?.refresh();
  }

  loadCodingFreshness(options: { force?: boolean; invalidateCache?: boolean } = {}): void {
    const context = this.context;
    if (this.stopped || !context) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.statistics.cancelFreshness(true);
      return;
    }
    if (!options.force && (!context.hasLoadedRefreshSetting() || !context.autoRefreshEnabled())) {
      this.statistics.cancelFreshness();
      return;
    }
    if (this.isGuardActive()) {
      this.pendingFreshness = true;
      this.pendingForcedFreshness ||= !!options.force;
      this.statistics.cancelFreshness();
      return;
    }
    if (options.force && options.invalidateCache !== false) {
      this.coding.invalidateCodingStatusCache(workspaceId);
    }
    this.statistics.loadCodingFreshness(options.force);
  }

  private refreshAfterExternalChange(
    options: { forceCodingFreshness?: boolean; forceManualTabData?: boolean } = {}
  ): void {
    const context = this.context;
    if (this.stopped || !context) return;
    if (this.isGuardActive()) {
      this.pendingManualState = true;
      this.pendingForcedManualState ||= !!options.forceManualTabData;
      if (options.forceCodingFreshness) {
        this.pendingFreshness = true;
        this.pendingForcedFreshness = true;
      }
      return;
    }

    const tab = context.activeTab();
    const loadOptions: ManualCodingTabLoadOptions = { reloadCodingJobs: false };
    if (options.forceManualTabData) loadOptions.forceRefresh = true;
    context.loadTabData(tab, loadOptions);
    if (tab !== 'planning') {
      this.loadCodingFreshness(options.forceCodingFreshness ? { force: true } : {});
    }
    if (tab === 'preparation') this.jobsRefresh.reload('active');
  }

  private resumePending(): void {
    const refreshManualState = this.pendingManualState;
    const forceManualTabData = this.pendingForcedManualState;
    const refreshFreshness = this.pendingFreshness || this.pendingForcedFreshness;
    const forceFreshness = this.pendingForcedFreshness;
    const tab = this.context?.activeTab();
    this.clearPending();
    if (refreshManualState) {
      this.refreshAfterExternalChange({
        forceCodingFreshness: refreshFreshness && forceFreshness,
        forceManualTabData
      });
    }
    if (refreshFreshness && (!refreshManualState || tab === 'planning')) {
      this.loadCodingFreshness({ force: forceFreshness });
    }
  }

  private clearPending(): void {
    this.pendingManualState = false;
    this.pendingForcedManualState = false;
    this.pendingFreshness = false;
    this.pendingForcedFreshness = false;
  }

  private isGuardActive(): boolean {
    return this.backgroundJobs.isStatusCheckGuardActive(this.appService.selectedWorkspaceId);
  }

  private invalidateStatusCache(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) this.coding.invalidateCodingStatusCache(workspaceId);
    this.planning.resetPlanningDataBundleState();
  }
}
