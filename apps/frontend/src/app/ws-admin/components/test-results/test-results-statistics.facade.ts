import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError, finalize, firstValueFrom, forkJoin, of, Subscription, timeout
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestResultService, TestResultsOverviewResponse, LogAnomalyDashboardSummary } from '../../../shared/services/test-result/test-result.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { TestPersonCodingService, AppliedResultsOverview } from '../../../coding/services/test-person-coding.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { CodingFreshnessSummaryDto } from '../../../../../../../api-dto/coding/coding-freshness.dto';

@Injectable()
export class TestResultsStatisticsFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testResultService = inject(TestResultService);
  private readonly statisticsService = inject(CodingStatisticsService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly workspaceSettingsService = inject(WorkspaceSettingsService);
  private overviewRequest?: Subscription;
  private anomalyRequest?: Subscription;
  private freshnessRequest?: Subscription;
  readonly overview = signal<TestResultsOverviewResponse | null>(null);

  readonly isLoadingOverview = signal<boolean>(false);

  readonly showTestResultsLogAnomalies = signal<boolean>(false);

  readonly enableRegexSearch = signal<boolean>(false);

  readonly logAnomalySummary = signal<LogAnomalyDashboardSummary | null>(null);

  readonly isLoadingLogAnomalySummary = signal<boolean>(false);

  readonly logAnomalySummaryLoadFailed = signal<boolean>(false);

  readonly logAnomalySummaryRequested = signal<boolean>(false);

  readonly codingFreshnessSummary = signal<CodingFreshnessSummaryDto | null>(null);

  readonly manualAppliedResultsOverview = signal<AppliedResultsOverview | null>(null);

  readonly manualAppliedResultsOverviewLoadFailed = signal<boolean>(false);

  readonly isLoadingManualAppliedResultsOverview = signal<boolean>(false);

  readonly autoRefreshCodingStatus = signal<boolean>(true);

  readonly codingFreshnessStatusChecked = signal<boolean>(false);

  readonly isLoadingCodingFreshnessStatus = signal<boolean>(false);

  codingFreshnessStatusRequestGeneration = 0;

  loadWorkspaceOverview(): void {
    this.overviewRequest?.unsubscribe();
    this.isLoadingOverview.set(true);
    this.overviewRequest = this.testResultService
      .getWorkspaceOverview(this.appService.selectedWorkspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => this.isLoadingOverview.set(false)))
      .subscribe({
        next: result => {
          if (result) {
            this.overview.set(result);
          }
          this.isLoadingOverview.set(false);
        },
        error: () => {
          this.isLoadingOverview.set(false);
        }
      });
  }

  loadTestResultsLogAnomalySetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.setShowTestResultsLogAnomalies(false);
      return;
    }

    this.workspaceSettingsService
      .getShowTestResultsLogAnomalies(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.setShowTestResultsLogAnomalies(enabled);
      });
  }

  loadRegexSearchSetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.enableRegexSearch.set(false);
      return;
    }

    this.workspaceSettingsService
      .getEnableRegexSearch(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.enableRegexSearch.set(enabled);
      });
  }

  loadCodingStatusAutoRefreshSetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.setAutoRefreshCodingStatus(true);
      return;
    }

    this.workspaceSettingsService
      .getAutoRefreshManualCodingJobs(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.setAutoRefreshCodingStatus(enabled);
      });
  }

  setAutoRefreshCodingStatus(enabled: boolean): void {
    this.autoRefreshCodingStatus.set(enabled);

    if (enabled) {
      this.loadCodingFreshnessStatus({ force: true });
      return;
    }

    this.clearCodingFreshnessStatus();
  }

  clearCodingFreshnessStatus(): void {
    this.freshnessRequest?.unsubscribe();
    this.codingFreshnessStatusRequestGeneration += 1;
    this.codingFreshnessSummary.set(null);
    this.manualAppliedResultsOverview.set(null);
    this.manualAppliedResultsOverviewLoadFailed.set(false);
    this.isLoadingManualAppliedResultsOverview.set(false);
    this.isLoadingCodingFreshnessStatus.set(false);
    this.codingFreshnessStatusChecked.set(false);
  }

  setShowTestResultsLogAnomalies(enabled: boolean): void {
    this.showTestResultsLogAnomalies.set(enabled);

    if (!enabled) {
      this.logAnomalySummary.set(null);
      this.logAnomalySummaryLoadFailed.set(false);
      this.isLoadingLogAnomalySummary.set(false);
      this.logAnomalySummaryRequested.set(false);
    }
  }

  loadLogAnomalySummary(): void {
    this.anomalyRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.showTestResultsLogAnomalies()) {
      this.logAnomalySummary.set(null);
      this.logAnomalySummaryLoadFailed.set(false);
      this.isLoadingLogAnomalySummary.set(false);
      this.logAnomalySummaryRequested.set(false);
      return;
    }

    const getLogAnomalySummary =
      (this.testResultService as Partial<TestResultService>).getLogAnomalySummary;
    if (!getLogAnomalySummary) {
      return;
    }

    this.logAnomalySummaryRequested.set(true);
    this.isLoadingLogAnomalySummary.set(true);
    this.logAnomalySummaryLoadFailed.set(false);
    this.anomalyRequest = getLogAnomalySummary.call(this.testResultService, workspaceId)
      .pipe(finalize(() => {
        this.isLoadingLogAnomalySummary.set(false);
      })).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: summary => {
          this.logAnomalySummary.set(summary);
        },
        error: () => {
          this.logAnomalySummary.set(null);
          this.logAnomalySummaryLoadFailed.set(true);
        }
      });
  }

  reloadLogAnomalySummaryIfRequested(): void {
    if (this.showTestResultsLogAnomalies() && this.logAnomalySummaryRequested()) {
      this.loadLogAnomalySummary();
    }
  }

  loadCodingFreshnessStatus(
    options: { force?: boolean } = {}
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.clearCodingFreshnessStatus();
      return;
    }

    if (this.isLoadingCodingFreshnessStatus() && !options.force) {
      return;
    }

    this.freshnessRequest?.unsubscribe();
    if (options.force) {
      this.testPersonCodingService.invalidateCodingStatusCache(workspaceId);
    }

    const getCodingFreshness =
      (this.statisticsService as Partial<CodingStatisticsService>).getCodingFreshness;
    const codingFreshness$ = getCodingFreshness ?
      getCodingFreshness.call(this.statisticsService, workspaceId)
        .pipe(catchError(() => of(null))) :
      of(null);

    const requestGeneration =
      this.codingFreshnessStatusRequestGeneration + 1;
    this.codingFreshnessStatusRequestGeneration = requestGeneration;
    this.codingFreshnessStatusChecked.set(true);
    this.isLoadingCodingFreshnessStatus.set(true);
    this.isLoadingManualAppliedResultsOverview.set(true);
    this.manualAppliedResultsOverviewLoadFailed.set(false);

    this.freshnessRequest = forkJoin([
      codingFreshness$,
      this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
        .pipe(catchError(() => of(null)))
    ])
      .pipe(finalize(() => {
        if (this.codingFreshnessStatusRequestGeneration === requestGeneration) {
          this.isLoadingCodingFreshnessStatus.set(false);
          this.isLoadingManualAppliedResultsOverview.set(false);
        }
      })).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([summary, overview]) => {
          if (this.codingFreshnessStatusRequestGeneration !== requestGeneration) {
            return;
          }

          this.codingFreshnessSummary.set(summary);
          this.manualAppliedResultsOverview.set(overview);
          this.manualAppliedResultsOverviewLoadFailed.set(overview === null);
        }
      });
  }

  refreshCodingFreshnessStatusAfterChange(): void {
    if (this.autoRefreshCodingStatus()) {
      this.loadCodingFreshnessStatus({ force: true });
      return;
    }

    this.clearCodingFreshnessStatus();
  }

  async fetchCodingFreshnessSummary(
    workspaceId: number
  ): Promise<CodingFreshnessSummaryDto | null> {
    const getCodingFreshness =
      (this.statisticsService as Partial<CodingStatisticsService>).getCodingFreshness;
    if (!getCodingFreshness) {
      return null;
    }

    try {
      return await firstValueFrom(
        getCodingFreshness.call(this.statisticsService, workspaceId).pipe(timeout(5000), takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
      );
    } catch {
      return null;
    }
  }

  async fetchManualAppliedResultsOverview(
    workspaceId: number
  ): Promise<{ overview: AppliedResultsOverview | null; loadFailed: boolean }> {
    try {
      const overview = await firstValueFrom(
        this.testPersonCodingService.getAppliedResultsOverview(workspaceId).pipe(timeout(5000), takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
      );
      return {
        overview,
        loadFailed: overview === null
      };
    } catch {
      return {
        overview: null,
        loadFailed: true
      };
    }
  }
}
