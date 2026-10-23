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
  private readonly overviewState = signal<TestResultsOverviewResponse | null>(null);
  readonly overview = this.overviewState.asReadonly();

  private readonly isLoadingOverviewState = signal<boolean>(false);
  readonly isLoadingOverview = this.isLoadingOverviewState.asReadonly();

  private readonly showTestResultsLogAnomaliesState = signal<boolean>(false);
  readonly showTestResultsLogAnomalies = this.showTestResultsLogAnomaliesState.asReadonly();

  private readonly enableRegexSearchState = signal<boolean>(false);
  readonly enableRegexSearch = this.enableRegexSearchState.asReadonly();

  private readonly logAnomalySummaryState = signal<LogAnomalyDashboardSummary | null>(null);
  readonly logAnomalySummary = this.logAnomalySummaryState.asReadonly();

  private readonly isLoadingLogAnomalySummaryState = signal<boolean>(false);
  readonly isLoadingLogAnomalySummary = this.isLoadingLogAnomalySummaryState.asReadonly();

  private readonly logAnomalySummaryLoadFailedState = signal<boolean>(false);
  readonly logAnomalySummaryLoadFailed = this.logAnomalySummaryLoadFailedState.asReadonly();

  private readonly logAnomalySummaryRequestedState = signal<boolean>(false);
  readonly logAnomalySummaryRequested = this.logAnomalySummaryRequestedState.asReadonly();

  private readonly codingFreshnessSummaryState = signal<CodingFreshnessSummaryDto | null>(null);
  readonly codingFreshnessSummary = this.codingFreshnessSummaryState.asReadonly();

  private readonly manualAppliedResultsOverviewState = signal<AppliedResultsOverview | null>(null);
  readonly manualAppliedResultsOverview = this.manualAppliedResultsOverviewState.asReadonly();

  private readonly manualAppliedResultsOverviewLoadFailedState = signal<boolean>(false);
  readonly manualAppliedResultsOverviewLoadFailed = this.manualAppliedResultsOverviewLoadFailedState.asReadonly();

  private readonly isLoadingManualAppliedResultsOverviewState = signal<boolean>(false);
  readonly isLoadingManualAppliedResultsOverview = this.isLoadingManualAppliedResultsOverviewState.asReadonly();

  private readonly autoRefreshCodingStatusState = signal<boolean>(true);
  readonly autoRefreshCodingStatus = this.autoRefreshCodingStatusState.asReadonly();

  private readonly codingFreshnessStatusCheckedState = signal<boolean>(false);
  readonly codingFreshnessStatusChecked = this.codingFreshnessStatusCheckedState.asReadonly();

  private readonly isLoadingCodingFreshnessStatusState = signal<boolean>(false);
  readonly isLoadingCodingFreshnessStatus = this.isLoadingCodingFreshnessStatusState.asReadonly();

  codingFreshnessStatusRequestGeneration = 0;

  acceptWorkspaceOverview(overview: TestResultsOverviewResponse): void {
    this.overviewState.set(overview);
  }

  acceptLogAnomalySummary(summary: LogAnomalyDashboardSummary | null): void {
    this.logAnomalySummaryState.set(summary);
  }

  acceptImportedFreshness(summary: CodingFreshnessSummaryDto): void {
    this.codingFreshnessSummaryState.set(summary);
  }

  acceptImportedManualOverview(result: { overview: AppliedResultsOverview | null; loadFailed: boolean }): void {
    this.manualAppliedResultsOverviewState.set(result.overview);
    this.manualAppliedResultsOverviewLoadFailedState.set(result.loadFailed);
  }

  loadWorkspaceOverview(): void {
    this.overviewRequest?.unsubscribe();
    this.isLoadingOverviewState.set(true);
    this.overviewRequest = this.testResultService
      .getWorkspaceOverview(this.appService.selectedWorkspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => this.isLoadingOverviewState.set(false)))
      .subscribe({
        next: result => {
          if (result) {
            this.acceptWorkspaceOverview(result);
          }
          this.isLoadingOverviewState.set(false);
        },
        error: () => {
          this.isLoadingOverviewState.set(false);
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
      this.enableRegexSearchState.set(false);
      return;
    }

    this.workspaceSettingsService
      .getEnableRegexSearch(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.enableRegexSearchState.set(enabled);
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
    this.autoRefreshCodingStatusState.set(enabled);

    if (enabled) {
      this.loadCodingFreshnessStatus({ force: true });
      return;
    }

    this.clearCodingFreshnessStatus();
  }

  clearCodingFreshnessStatus(): void {
    this.freshnessRequest?.unsubscribe();
    this.codingFreshnessStatusRequestGeneration += 1;
    this.codingFreshnessSummaryState.set(null);
    this.manualAppliedResultsOverviewState.set(null);
    this.manualAppliedResultsOverviewLoadFailedState.set(false);
    this.isLoadingManualAppliedResultsOverviewState.set(false);
    this.isLoadingCodingFreshnessStatusState.set(false);
    this.codingFreshnessStatusCheckedState.set(false);
  }

  setShowTestResultsLogAnomalies(enabled: boolean): void {
    this.showTestResultsLogAnomaliesState.set(enabled);

    if (!enabled) {
      this.logAnomalySummaryState.set(null);
      this.logAnomalySummaryLoadFailedState.set(false);
      this.isLoadingLogAnomalySummaryState.set(false);
      this.logAnomalySummaryRequestedState.set(false);
    }
  }

  loadLogAnomalySummary(): void {
    this.anomalyRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.showTestResultsLogAnomalies()) {
      this.logAnomalySummaryState.set(null);
      this.logAnomalySummaryLoadFailedState.set(false);
      this.isLoadingLogAnomalySummaryState.set(false);
      this.logAnomalySummaryRequestedState.set(false);
      return;
    }

    const getLogAnomalySummary =
      (this.testResultService as Partial<TestResultService>).getLogAnomalySummary;
    if (!getLogAnomalySummary) {
      return;
    }

    this.logAnomalySummaryRequestedState.set(true);
    this.isLoadingLogAnomalySummaryState.set(true);
    this.logAnomalySummaryLoadFailedState.set(false);
    this.anomalyRequest = getLogAnomalySummary.call(this.testResultService, workspaceId)
      .pipe(finalize(() => {
        this.isLoadingLogAnomalySummaryState.set(false);
      })).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: summary => {
          this.acceptLogAnomalySummary(summary);
        },
        error: () => {
          this.logAnomalySummaryState.set(null);
          this.logAnomalySummaryLoadFailedState.set(true);
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
    this.codingFreshnessStatusCheckedState.set(true);
    this.isLoadingCodingFreshnessStatusState.set(true);
    this.isLoadingManualAppliedResultsOverviewState.set(true);
    this.manualAppliedResultsOverviewLoadFailedState.set(false);

    this.freshnessRequest = forkJoin([
      codingFreshness$,
      this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
        .pipe(catchError(() => of(null)))
    ])
      .pipe(finalize(() => {
        if (this.codingFreshnessStatusRequestGeneration === requestGeneration) {
          this.isLoadingCodingFreshnessStatusState.set(false);
          this.isLoadingManualAppliedResultsOverviewState.set(false);
        }
      })).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([summary, overview]) => {
          if (this.codingFreshnessStatusRequestGeneration !== requestGeneration) {
            return;
          }

          this.codingFreshnessSummaryState.set(summary);
          this.manualAppliedResultsOverviewState.set(overview);
          this.manualAppliedResultsOverviewLoadFailedState.set(overview === null);
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
