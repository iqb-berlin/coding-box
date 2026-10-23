import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ManualCodingPlanningSnapshot } from '../../services/manual-coding-planning-snapshot.model';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { ManualCodingSettingsFacade } from './manual-coding-settings.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

/** A coherent planning snapshot is cached only after all requested parts have settled. */
@Injectable()
export class ManualCodingPlanningFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly analysis = inject(ManualCodingAnalysisFacade);
  private readonly settings = inject(ManualCodingSettingsFacade);
  private readonly restoredSubject = new Subject<void>();
  readonly restored$ = this.restoredSubject.asObservable();
  private readonly freshnessRefreshRequested = new Subject<{ force?: boolean; invalidateCache?: boolean }>();
  readonly freshnessRefreshRequested$ = this.freshnessRefreshRequested.asObservable();
  private readonly analysisRequested = new Subject<void>();
  readonly analysisRequested$ = this.analysisRequested.asObservable();
  private readonly hasLoadedBundle = signal(false);
  get hasLoadedPlanningDataBundle(): boolean { return this.hasLoadedBundle(); }
  private isPlanningDataBundleLoadPending = false;
  private planningDataBundleCacheGeneration: number | null = null;
  private deferredPlanningDataBundleForceRefresh: boolean | null = null;
  private isStartingPlanningDataBundleLoad = false;
  private planningDataBundleLoadFailed = false;
  private readonly responseAnalysis = this.analysis.responseAnalysis;
  private readonly responseAnalysisError = this.analysis.responseAnalysisError;
  private readonly codingProgressOverview = this.statistics.codingProgressOverview;
  private readonly variableCoverageOverview = this.statistics.variableCoverageOverview;
  private readonly caseCoverageOverview = this.statistics.caseCoverageOverview;
  private readonly codingIncompleteVariables = this.statistics.codingIncompleteVariables;
  private readonly manualCodingScopeSummary = this.statistics.manualCodingScopeSummary;
  private readonly manualCodeAvailabilityWarnings = this.statistics.manualCodeAvailabilityWarnings;
  private readonly appliedResultsOverview = this.statistics.appliedResultsOverview;
  private readonly codingFreshnessSummary = this.statistics.codingFreshnessSummary;
  private readonly isLoadingCodingFreshness = this.statistics.isLoadingCodingFreshness;

  constructor() {
    this.settings.settled$.pipe(takeUntilDestroyed()).subscribe(() => this.trySavePlanningDataBundleSnapshot());
    this.statistics.settled$.pipe(takeUntilDestroyed()).subscribe(() => this.trySavePlanningDataBundleSnapshot());
    this.analysis.settled$.pipe(takeUntilDestroyed()).subscribe(() => this.trySavePlanningDataBundleSnapshot());
    this.statistics.failed$.pipe(takeUntilDestroyed()).subscribe(() => this.markPlanningDataBundleLoadFailed());
    this.analysis.failed$.pipe(takeUntilDestroyed()).subscribe(() => this.markPlanningDataBundleLoadFailed());
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (workspaceId !== id) { this.resetPlanningDataBundleState(); workspaceId = id; }
    });
    this.destroyRef.onDestroy(() => { this.resetPlanningDataBundleState(); this.restoredSubject.complete(); this.freshnessRefreshRequested.complete(); this.analysisRequested.complete(); });
  }

  private isLoading(): boolean {
    return this.analysis.isLoadingResponseAnalysis() || this.settings.isLoadingMatchingMode() || this.statistics.isLoadingManualCodingScopeSummary ||
      this.statistics.isLoadingVariableCoverage() || this.statistics.isLoadingCaseCoverage() || this.statistics.isLoadingCodingProgress() || this.statistics.isLoadingManualCodeAvailability() || this.statistics.isLoadingCodingIncompleteVariables() || this.statistics.isLoadingAppliedResultsOverview() || this.statistics.isLoadingManualFreshnessJobSummary() || this.statistics.isLoadingDoubleCodingConflictSummary();
  }

  loadPlanningDataBundle(forceRefresh: boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    if (this.isPlanningDataBundleBusy()) {
      this.deferredPlanningDataBundleForceRefresh =
        (this.deferredPlanningDataBundleForceRefresh ?? false) || forceRefresh;
      return;
    }

    this.beginPlanningDataRefresh();
    this.isStartingPlanningDataBundleLoad = true;
    this.statistics.loadVariableCoverageOverview();
    this.statistics.loadCaseCoverageOverview();
    this.statistics.loadCodingProgressOverview();
    this.statistics.loadCodingIncompleteVariables();
    this.statistics.loadManualFreshnessDecisionData();
    this.freshnessRefreshRequested.next({
      force: forceRefresh,
      invalidateCache: false
    });
    this.analysisRequested.next();
    this.isStartingPlanningDataBundleLoad = false;
    this.trySavePlanningDataBundleSnapshot();
  }

  get isRefreshPending(): boolean { return this.isPlanningDataBundleLoadPending; }

  markPlanningDataAvailable(): void { this.hasLoadedBundle.set(true); }

  beginPlanningDataRefresh(): void {
    this.deferredPlanningDataBundleForceRefresh = null;
    this.markPlanningDataAvailable();
    this.isPlanningDataBundleLoadPending = true;
    this.planningDataBundleLoadFailed = false;
    this.planningDataBundleCacheGeneration =
      this.testPersonCodingService.beginManualCodingPlanningSnapshot();
  }

  restorePlanningDataBundleSnapshot(): boolean {
    if (this.hasLoadedPlanningDataBundle) {
      return true;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return false;
    }

    const snapshot = this.testPersonCodingService
      .getManualCodingPlanningSnapshot(workspaceId);
    if (!snapshot) {
      return false;
    }

    this.applyPlanningDataBundleSnapshot(snapshot);
    this.markPlanningDataAvailable();

    this.restoredSubject.next();
    return true;
  }

  applyPlanningDataBundleSnapshot(
    snapshot: ManualCodingPlanningSnapshot
  ): void {
    this.responseAnalysis.set(snapshot.responseAnalysis);
    this.responseAnalysisError.set(null);
    this.codingProgressOverview.set(snapshot.codingProgressOverview);
    this.variableCoverageOverview.set(snapshot.variableCoverageOverview);
    this.caseCoverageOverview.set(snapshot.caseCoverageOverview);
    this.codingIncompleteVariables.set([...snapshot.codingIncompleteVariables]);
    this.manualCodingScopeSummary.set(snapshot.manualCodingScopeSummary);
    this.statistics.setManualCodeAvailabilityWarnings([
      ...snapshot.manualCodeAvailabilityWarnings
    ]);
    this.appliedResultsOverview.set(snapshot.appliedResultsOverview);
    this.statistics.manualFreshnessJobSummary = snapshot.manualFreshnessJobSummary;
    this.statistics.openDoubleCodingConflictCount =
      snapshot.openDoubleCodingConflictCount;
    this.codingFreshnessSummary.set(snapshot.codingFreshnessSummary);
    this.statistics.lastCodingFreshnessRefreshAt = snapshot.codingFreshnessSummary ?
      Date.now() : 0;
  }

  trySavePlanningDataBundleSnapshot(): void {
    if (this.isPlanningDataBundleBusy()) {
      return;
    }

    const deferredForceRefresh = this.deferredPlanningDataBundleForceRefresh;
    if (deferredForceRefresh !== null) {
      this.deferredPlanningDataBundleForceRefresh = null;
      this.loadPlanningDataBundle(deferredForceRefresh);
      return;
    }

    if (!this.isPlanningDataBundleLoadPending) {
      return;
    }

    if (this.responseAnalysisError() || this.planningDataBundleLoadFailed) {
      this.isPlanningDataBundleLoadPending = false;
      this.planningDataBundleCacheGeneration = null;
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    const cacheGeneration = this.planningDataBundleCacheGeneration;
    if (!workspaceId || cacheGeneration === null) {
      return;
    }

    this.testPersonCodingService.saveManualCodingPlanningSnapshot(
      workspaceId,
      {
        responseAnalysis: this.responseAnalysis(),
        codingProgressOverview: this.codingProgressOverview(),
        variableCoverageOverview: this.variableCoverageOverview(),
        caseCoverageOverview: this.caseCoverageOverview(),
        codingIncompleteVariables: [...this.codingIncompleteVariables()],
        manualCodingScopeSummary: this.manualCodingScopeSummary(),
        manualCodeAvailabilityWarnings: [
          ...this.manualCodeAvailabilityWarnings()
        ],
        appliedResultsOverview: this.appliedResultsOverview(),
        manualFreshnessJobSummary: this.statistics.manualFreshnessJobSummary,
        openDoubleCodingConflictCount: this.statistics.openDoubleCodingConflictCount,
        codingFreshnessSummary: this.codingFreshnessSummary()
      },
      cacheGeneration
    );
    this.isPlanningDataBundleLoadPending = false;
    this.planningDataBundleCacheGeneration = null;
  }

  markPlanningDataBundleLoadFailed(): void {
    if (this.isPlanningDataBundleLoadPending) {
      this.planningDataBundleLoadFailed = true;
    }
  }

  discardPendingPlanningDataBundle(): void {
    if (this.isPlanningDataBundleLoadPending) {
      this.resetPlanningDataBundleState();
    }
  }

  isPlanningDataBundleBusy(): boolean {
    return this.isStartingPlanningDataBundleLoad ||
      this.isLoading() ||
      this.isLoadingCodingFreshness() ||
      this.analysis.responseAnalysisGuardActive ||
      this.responseAnalysis()?.isCalculating === true;
  }

  resetPlanningDataBundleState(): void {
    this.hasLoadedBundle.set(false);
    this.isPlanningDataBundleLoadPending = false;
    this.planningDataBundleCacheGeneration = null;
    this.deferredPlanningDataBundleForceRefresh = null;
    this.planningDataBundleLoadFailed = false;
  }
}
