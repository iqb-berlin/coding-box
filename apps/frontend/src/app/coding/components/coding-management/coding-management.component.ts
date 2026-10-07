import {
  Component, OnInit, OnDestroy, inject, signal, computed, input, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  concatMap,
  finalize,
  reduce,
  takeUntil
} from 'rxjs/operators';
import { combineLatest, range, Subject } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import {
  MatAnchor,
  MatButton,
  MatIconButton
} from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { CodingStatistics } from '../../../../../../../api-dto/coding/coding-statistics';
import {
  ExportDialogComponent,
  ExportFormat
} from '../export-dialog/export-dialog.component';
import { Success } from '../../models/success.model';
import { ResponseEntity } from '../../../shared/models/response-entity.model';
import {
  TestPersonCodingDialogComponent,
  TestPersonCodingDialogData,
  TestPersonCodingDialogResult
} from '../test-person-coding-dialog/test-person-coding-dialog.component';
import {
  AppliedResultsOverview,
  TestPersonCodingService,
  TestResultsChangedEvent
} from '../../services/test-person-coding.service';
import {
  CodingBackgroundJobsService,
  CodingStatusGuardClearedEvent
} from '../../services/coding-background-jobs.service';
import { ExportCodingBookComponent } from '../export-coding-book/export-coding-book.component';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';
import { CodingVariablesDialogComponent } from '../../../coding-management/coding-variables-dialog/coding-variables-dialog.component';
import { ResetVersionDialogComponent } from './reset-version-dialog/reset-version-dialog.component';
import { DownloadCodingResultsDialogComponent } from './download-coding-results-dialog/download-coding-results-dialog.component';
import {
  CodingManagementService,
  StatisticsVersion,
  FilterParams,
  CodingResultsExportFormat
} from '../../services/coding-management.service';
import { CodingManagementUiService } from './services/coding-management-ui.service';
import { StatisticsCardComponent } from './components/statistics-card/statistics-card.component';
import { ResponseFiltersComponent } from './components/response-filters/response-filters.component';
import { ResponseTableComponent } from './components/response-table/response-table.component';
import {
  CodingResponseSortBy,
  CodingResponseSortDirection,
  SearchResponseItem
} from '../../../models/coding-interfaces';
import { ItemListDialogComponent } from '../../../shared/dialogs/item-list-dialog/item-list-dialog.component';
import { ReviewListDialogComponent } from './components/review-list-dialog/review-list-dialog.component';
import {
  CodingFreshnessScopeDto,
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessSummaryItemDto
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { AutocodingReadinessDto } from '../../../../../../../api-dto/coding/autocoding-readiness.dto';
import {
  CODING_FRESHNESS_TASK_RESULT_HELP,
  getCodingFreshnessAffectedResponseCount,
  getCodingFreshnessAffectedTaskResultCount,
  getCodingFreshnessAttentionTitle,
  getCodingFreshnessAutoCodingWarnings,
  getCodingFreshnessAutoCodingButtonLabel,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessManualReviewWarnings,
  getCodingFreshnessStateLabel,
  getCodingFreshnessSummaryText,
  getCodingFreshnessVersionLabel,
  getSecondAutocodingFreshnessWarnings,
  hasOnlyManualCodingFreshnessWarnings,
  isCodingFreshnessOpenWarning,
  isSecondAutocodingWaitingForManualCoding
} from '../../../shared/utils/coding-freshness-text.util';
import { getResponseStatusLabel } from '../../../shared/utils/response-status-metadata.util';
import { extractGeoGebraBase64 } from '../../utils/geogebra-value.util';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-management',
  templateUrl: './coding-management.component.html',
  standalone: true,
  imports: [
    MatSnackBarModule,
    MatIcon,
    MatAnchor,
    MatButton,
    MatIconButton,
    MatTooltipModule,
    TranslateModule,
    StatisticsCardComponent,
    ResponseFiltersComponent,
    ResponseTableComponent,
    MatProgressSpinnerModule
  ],
  styleUrls: ['./coding-management.component.scss']
})
export class CodingManagementComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  readonly hideActionButtons = input(false);

  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private codingManagementService = inject(CodingManagementService);
  private testPersonCodingService = inject(TestPersonCodingService);
  private codingBackgroundJobsService = inject(CodingBackgroundJobsService);
  private uiService = inject(CodingManagementUiService);
  private translateService = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly reviewBatchSize = 500;
  private readonly maxReviewResponses = 5000;

  // State
  data: Success[] = [];
  protected displayedColumns: string[] = [
    'unitname',
    'variableid',
    'value',
    'codedstatus',
    'code',
    'score',
    'person_code',
    'person_login',
    'person_group',
    'booklet_id',
    'actions'
  ];

  protected readonly isLoading = signal(false);
  protected readonly isLoadingStatistics = signal(false);
  protected readonly isLoadingReview = signal(false);
  protected readonly isDownloadInProgress = signal(false);
  protected readonly resetProgress = signal<number | null>(null);
  protected readonly downloadProgress = signal<number | null>(null);
  protected readonly codingListDownloadProgress = signal<number | null>(null);

  // Statistics state
  readonly codingStatistics = signal<CodingStatistics>({ totalResponses: 0, statusCounts: {} });
  protected readonly referenceStatistics = signal<CodingStatistics | null>(null);
  protected readonly referenceVersion = signal<StatisticsVersion | null>(null);
  readonly statisticsLoaded = signal(false);
  protected readonly isGeogebraAvailable = signal(false);

  readonly currentStatusFilter = signal<string | null>(null);
  protected pageSizeOptions = [100, 200, 500, 1000];
  readonly pageSize = signal(100);
  readonly totalRecords = signal(0);
  readonly pageIndex = signal(0);
  readonly sortBy = signal<CodingResponseSortBy | ''>('');
  readonly sortDirection = signal<CodingResponseSortDirection | ''>('');

  readonly selectedStatisticsVersion = signal<'v1' | 'v2' | 'v3'>('v1');
  readonly codingFreshnessSummary = signal<CodingFreshnessSummaryDto | null>(null);
  readonly codingFreshnessScope = signal<CodingFreshnessScopeDto | null>(null);
  readonly isLoadingCodingFreshness = signal(false);
  readonly autocodingReadiness = signal<AutocodingReadinessDto | null>(null);
  protected readonly isLoadingAutocodingReadiness = signal(false);
  readonly autocodingReadinessLoadFailed = signal(false);
  readonly manualAppliedResultsOverview = signal<AppliedResultsOverview | null>(null);
  protected readonly isLoadingManualAppliedResultsOverview = signal(false);
  readonly manualAppliedResultsOverviewLoadFailed = signal(false);
  readonly evaluationMode = signal(false);
  protected readonly enableRegexSearch = signal(false);
  readonly autoRefreshManualCodingJobs = signal(true);
  readonly hasLoadedFullCodingStatusOverview = signal(false);
  protected readonly isStartingFreshnessCoding = signal(false);
  readonly activeFreshnessJobId = signal<string | null>(null);
  readonly activeFreshnessJobProgress = signal<number | null>(null);

  readonly filterParams = signal<FilterParams>({
    value: '',
    unitName: '',
    codedStatus: '',
    version: 'v1',
    code: '',
    codingCode: '',
    score: '',
    group: '',
    bookletName: '',
    variableId: '',
    geogebra: false,
    responseSource: 'all',
    personLogin: ''
  });

  private destroy$ = new Subject<void>();
  private freshnessJobPollingInterval: number | null = null;
  private activeFreshnessJobWorkspaceId: number | null = null;
  private lastResetProgress: number | null | undefined;
  private hasLoadedManualCodingJobRefreshSetting = false;
  private pendingAutomaticCodingStatusRefreshAfterBackgroundJob = false;
  private pendingForcedCodingStatusRefreshAfterBackgroundJob = false;
  private scheduledAutomaticCodingStatusRefresh: number | null = null;
  private freshnessJobCompletionRefreshHandledIds = new Set<string>();
  private resetCompletionRefreshHandledAfterGuardClear = false;
  private hasShownFreshnessJobStatusPollingError = false;
  private readonly responseTableRequestCancel$ = new Subject<void>();
  private responseTableRequestId = 0;
  private readonly automaticCodingStatusRefreshDebounceMs = 250;

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    let pendingStatisticsVersion: StatisticsVersion | null = null;

    if (workspaceId) {
      pendingStatisticsVersion = this.testPersonCodingService.consumePendingStatisticsVersion(workspaceId);
      if (pendingStatisticsVersion) {
        this.selectStatisticsVersion(pendingStatisticsVersion);
      }

      combineLatest([
        this.workspaceSettingsService.getEvaluationMode(workspaceId),
        this.workspaceSettingsService.getAutoFetchCodingStatistics(workspaceId),
        this.workspaceSettingsService.getAutoRefreshManualCodingJobs(workspaceId)
      ])
        .pipe(takeUntil(this.destroy$))
        .subscribe(([evaluationMode, autoFetch, autoRefresh]) => {
          const effectiveAutoRefresh = !evaluationMode && autoRefresh;
          const shouldFetchInitialStatistics =
            !evaluationMode && (autoFetch || pendingStatisticsVersion);

          this.evaluationMode.set(evaluationMode);
          this.hasLoadedManualCodingJobRefreshSetting = true;
          this.autoRefreshManualCodingJobs.set(effectiveAutoRefresh);

          if (shouldFetchInitialStatistics) {
            this.fetchCodingStatistics();
          }
          if (effectiveAutoRefresh) {
            this.loadInitialCodingStatusOverview();
          } else if (!evaluationMode) {
            this.loadCachedAutocodingReadiness();
          }
        });
      this.workspaceSettingsService
        .getEnableRegexSearch(workspaceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(enabled => {
          this.enableRegexSearch.set(enabled);
        });

      this.codingManagementService.hasGeogebraResponses()
        .pipe(takeUntil(this.destroy$))
        .subscribe(available => {
          this.isGeogebraAvailable.set(available);
        });

      this.codingBackgroundJobsService.statusGuardCleared$
        .pipe(takeUntil(this.destroy$))
        .subscribe(event => {
          if (event.workspaceId === this.appService.selectedWorkspaceId) {
            this.refreshPendingCodingStatusOverviewAfterBackgroundJob(event);
          }
        });
    }

    // Subscribe to service state
    this.codingManagementService.codingStatistics$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => {
        if (stats) {
          this.codingStatistics.set(stats);
          this.statisticsLoaded.set(true);
        }
      });

    this.codingManagementService.referenceStatistics$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => {
        this.referenceStatistics.set(stats);
      });

    this.codingManagementService.referenceVersion$
      .pipe(takeUntil(this.destroy$))
      .subscribe(version => {
        this.referenceVersion.set(version);
      });

    this.codingManagementService.isLoadingStatistics$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isLoading => {
        this.isLoadingStatistics.set(isLoading);
      });

    this.codingManagementService.resetProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        const previousProgress = this.lastResetProgress;
        this.lastResetProgress = progress;
        this.resetProgress.set(progress);
        if (previousProgress !== undefined &&
          previousProgress !== null &&
          progress === null) {
          this.invalidateCodingStatusOverviewCache();
          if (this.resetCompletionRefreshHandledAfterGuardClear) {
            this.resetCompletionRefreshHandledAfterGuardClear = false;
            return;
          }
          this.refreshCodingStatusOverviewAfterChange();
        }
      });

    this.codingManagementService.downloadProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.downloadProgress.set(progress);
        this.isDownloadInProgress.set(progress !== null);
      });

    this.codingManagementService.codingListDownloadProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.codingListDownloadProgress.set(progress);
      });

    this.testPersonCodingService.autoCodingCompleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event?.jobId &&
          this.consumeHandledFreshnessJobCompletionRefresh(event.jobId)) {
          if (event.jobId === this.activeFreshnessJobId()) {
            this.finishFreshnessCodingJob(event.jobId);
            this.stopFreshnessJobPolling();
          }
          return;
        }

        if (event?.jobId && event.jobId === this.activeFreshnessJobId()) {
          const pendingRefreshHandled = this.finishFreshnessCodingJob(event.jobId);
          this.stopFreshnessJobPolling();
          if (pendingRefreshHandled) {
            return;
          }
        }
        this.refreshCodingStatusOverviewAfterChange();
      });

    this.testPersonCodingService.testResultsChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        this.refreshAfterTestResultsChanged(event);
      });

    // Check for active reset job (persists across navigation)
    this.codingManagementService.checkActiveResetJob();
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const refreshRequested = params.get('refreshCodingFreshness');
        if (refreshRequested === '1' || refreshRequested === 'true') {
          this.refreshCodingStatusOverview();
        }
      });
  }

  ngOnDestroy(): void {
    if (this.activeFreshnessJobId()) {
      this.testPersonCodingService.trackFreshnessCodingGuardUntilComplete(
        this.activeFreshnessJobWorkspaceId || this.appService.selectedWorkspaceId,
        this.activeFreshnessJobId()
      );
    }
    this.stopFreshnessJobPolling();
    this.clearScheduledAutomaticCodingStatusRefresh();
    this.codingManagementService.cancelViewBoundStatisticsFetches(this.appService.selectedWorkspaceId);
    this.responseTableRequestCancel$.next();
    this.responseTableRequestCancel$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Statistics Card Event Handlers
  onVersionChange(version: 'v1' | 'v2' | 'v3'): void {
    this.selectStatisticsVersion(version);

    if (this.statisticsLoaded()) {
      this.fetchCodingStatistics();
    }
  }

  private selectStatisticsVersion(version: 'v1' | 'v2' | 'v3'): void {
    this.selectedStatisticsVersion.set(version);
    this.filterParams.set({
      ...this.filterParams(),
      version
    });
    this.data = [];
    this.currentStatusFilter.set(null);
    this.totalRecords.set(0);
    this.referenceStatistics.set(null);
    this.referenceVersion.set(null);
  }

  private refreshAfterTestResultsChanged(event: TestResultsChangedEvent = {}): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (event.workspaceId && event.workspaceId !== workspaceId) {
      return;
    }

    if (event.statisticsVersion) {
      this.selectStatisticsVersion(event.statisticsVersion);
      if (workspaceId) {
        this.testPersonCodingService.consumePendingStatisticsVersion(workspaceId);
      }
    }
    this.refreshCodingStatusOverviewAfterChange();
  }

  fetchCodingStatistics(): void {
    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(false)) {
      return;
    }

    this.codingManagementService.fetchCodingStatistics(this.selectedStatisticsVersion());
  }

  loadCodingFreshness(loadScopeOnWarnings = true): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(false)) {
      return;
    }

    this.isLoadingCodingFreshness.set(true);
    this.testPersonCodingService.getCodingFreshness(workspaceId)
      .pipe(
        finalize(() => {
          this.isLoadingCodingFreshness.set(false);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(summary => {
        this.codingFreshnessSummary.set(summary);
        if (loadScopeOnWarnings && this.hasCodingFreshnessWarnings()) {
          this.loadCodingFreshnessScope();
        } else {
          this.codingFreshnessScope.set(null);
        }
        if (!loadScopeOnWarnings && this.hasSecondAutocodingFreshnessWarnings()) {
          this.loadManualAppliedResultsOverview();
        }
      });
  }

  loadCodingFreshnessScope(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.testPersonCodingService.getCodingFreshnessScope(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(scope => {
        this.codingFreshnessScope.set(scope);
      });
  }

  loadManualAppliedResultsOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.manualAppliedResultsOverview.set(null);
      this.manualAppliedResultsOverviewLoadFailed.set(false);
      return;
    }

    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(false)) {
      return;
    }

    this.isLoadingManualAppliedResultsOverview.set(true);
    this.manualAppliedResultsOverviewLoadFailed.set(false);
    this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
      .pipe(
        finalize(() => {
          this.isLoadingManualAppliedResultsOverview.set(false);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(overview => {
        this.manualAppliedResultsOverview.set(overview);
        this.manualAppliedResultsOverviewLoadFailed.set(overview === null);
      });
  }

  loadAutocodingReadiness(forceRefresh = false): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(forceRefresh)) {
      return;
    }

    this.isLoadingAutocodingReadiness.set(true);
    this.autocodingReadinessLoadFailed.set(false);
    this.testPersonCodingService.getAutocodingReadiness(workspaceId, 1, forceRefresh)
      .pipe(
        finalize(() => {
          this.isLoadingAutocodingReadiness.set(false);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: readiness => {
          this.autocodingReadiness.set(readiness);
          this.hasLoadedFullCodingStatusOverview.set(true);
        },
        error: () => {
          this.autocodingReadiness.set(null);
          this.autocodingReadinessLoadFailed.set(true);
        }
      });
  }

  private loadCachedAutocodingReadiness(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    if (this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId)) {
      return;
    }

    const cachedOverview =
      this.testPersonCodingService.getCachedCodingStatusOverview(workspaceId, 1);
    if (cachedOverview) {
      this.codingFreshnessSummary.set(cachedOverview.codingFreshness);
      this.autocodingReadiness.set(cachedOverview.autocodingReadiness);
      this.manualAppliedResultsOverview.set(cachedOverview.appliedResultsOverview);
      this.autocodingReadinessLoadFailed.set(false);
      this.manualAppliedResultsOverviewLoadFailed.set(false);
      this.hasLoadedFullCodingStatusOverview.set(true);
      return;
    }

    this.testPersonCodingService.getCachedAutocodingReadiness(workspaceId, 1)
      .pipe(takeUntil(this.destroy$))
      .subscribe(readiness => {
        if (!readiness) {
          return;
        }

        this.autocodingReadiness.set(readiness);
        this.autocodingReadinessLoadFailed.set(false);
      });
  }

  refreshAutocodingReadiness(): void {
    this.loadAutocodingReadiness(true);
  }

  refreshCodingStatusOverview(): void {
    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(true)) {
      return;
    }

    this.performCodingStatusOverviewRefresh(true);
  }

  private performCodingStatusOverviewRefresh(includeAutocodingReadiness = false): void {
    this.invalidateCodingStatusOverviewCache();
    this.fetchCodingStatistics();
    this.loadCodingStatusOverview(includeAutocodingReadiness);
    this.refreshTableData();
  }

  private refreshCodingStatusOverviewAfterChange(): void {
    this.hasLoadedFullCodingStatusOverview.set(false);
    if (!this.hasLoadedManualCodingJobRefreshSetting ||
      !this.autoRefreshManualCodingJobs()) {
      return;
    }

    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(false)) {
      return;
    }

    this.scheduleAutomaticCodingStatusOverviewRefresh();
  }

  private invalidateCodingStatusOverviewCache(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.hasLoadedFullCodingStatusOverview.set(false);
      this.testPersonCodingService.invalidateCodingStatusCache(workspaceId);
    }
  }

  loadCodingStatusOverview(includeAutocodingReadiness = false): void {
    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(includeAutocodingReadiness)) {
      return;
    }

    if (includeAutocodingReadiness) {
      this.hasLoadedFullCodingStatusOverview.set(false);
    }
    this.loadCodingFreshness();
    this.loadManualAppliedResultsOverview();
    if (includeAutocodingReadiness) {
      this.loadAutocodingReadiness(true);
    }
  }

  private loadInitialCodingStatusOverview(): void {
    if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(false)) {
      return;
    }

    this.hasLoadedFullCodingStatusOverview.set(false);
    this.loadCodingFreshness(false);
    this.loadCachedAutocodingReadiness();
  }

  private scheduleAutomaticCodingStatusOverviewRefresh(): void {
    if (this.scheduledAutomaticCodingStatusRefresh !== null) {
      return;
    }

    this.scheduledAutomaticCodingStatusRefresh = window.setTimeout(() => {
      this.scheduledAutomaticCodingStatusRefresh = null;
      if (this.deferCodingStatusRefreshIfBackgroundJobIsRunning(false)) {
        return;
      }
      this.performCodingStatusOverviewRefresh();
    }, this.automaticCodingStatusRefreshDebounceMs);
  }

  private clearScheduledAutomaticCodingStatusRefresh(): void {
    if (this.scheduledAutomaticCodingStatusRefresh !== null) {
      clearTimeout(this.scheduledAutomaticCodingStatusRefresh);
      this.scheduledAutomaticCodingStatusRefresh = null;
    }
  }

  private deferCodingStatusRefreshIfBackgroundJobIsRunning(forceRefresh: boolean): boolean {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId)) {
      return false;
    }

    if (forceRefresh) {
      this.pendingForcedCodingStatusRefreshAfterBackgroundJob = true;
    } else {
      this.pendingAutomaticCodingStatusRefreshAfterBackgroundJob = true;
    }
    return true;
  }

  private hasPendingCodingStatusOverviewRefreshAfterBackgroundJob(): boolean {
    return this.pendingForcedCodingStatusRefreshAfterBackgroundJob ||
      this.pendingAutomaticCodingStatusRefreshAfterBackgroundJob;
  }

  private refreshPendingCodingStatusOverviewAfterBackgroundJob(
    event?: CodingStatusGuardClearedEvent
  ): void {
    const forceRefresh = this.pendingForcedCodingStatusRefreshAfterBackgroundJob;
    const shouldRefresh = this.hasPendingCodingStatusOverviewRefreshAfterBackgroundJob();

    this.pendingForcedCodingStatusRefreshAfterBackgroundJob = false;
    this.pendingAutomaticCodingStatusRefreshAfterBackgroundJob = false;

    if (!shouldRefresh) {
      return;
    }

    if (forceRefresh) {
      this.performCodingStatusOverviewRefresh(true);
      this.rememberGuardClearedCompletionRefresh(event);
      return;
    }

    this.refreshCodingStatusOverviewAfterChange();
    this.rememberGuardClearedCompletionRefresh(event);
  }

  private rememberGuardClearedCompletionRefresh(
    event?: CodingStatusGuardClearedEvent
  ): void {
    if (event?.kind === 'freshness-coding' && event.jobId) {
      this.freshnessJobCompletionRefreshHandledIds.add(event.jobId);
    }

    if (event?.kind === 'autocoder-reset') {
      this.resetCompletionRefreshHandledAfterGuardClear = true;
    }
  }

  private consumeHandledFreshnessJobCompletionRefresh(jobId: string): boolean {
    return this.freshnessJobCompletionRefreshHandledIds.delete(jobId);
  }

  shouldShowManualCodingStatusRefresh(): boolean {
    if (this.isStartingFreshnessCoding() || this.activeFreshnessJobId()) {
      return false;
    }

    return !this.autoRefreshManualCodingJobs() ||
      !this.hasLoadedFullCodingStatusOverview();
  }

  startFreshnessCoding(version: 'v1' | 'v3'): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.isStartingFreshnessCoding()) {
      return;
    }

    if (version === 'v3' && this.isSecondAutocodingWaitingForManualCoding()) {
      this.snackBar.open(
        this.translateService.instant('coding-management.readiness.second-autocoding-waits-snackbar'),
        this.translateService.instant('coding-management.actions.close'),
        { duration: 6000 }
      );
      return;
    }

    this.isStartingFreshnessCoding.set(true);
    this.testPersonCodingService.startFreshnessCoding(workspaceId, {
      version,
      states: ['PENDING', 'STALE']
    })
      .pipe(
        finalize(() => {
          this.isStartingFreshnessCoding.set(false);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(result => {
        if (!result.jobId) {
          this.snackBar.open(
            result.message || 'Keine betroffenen Ergebnisse für Auto-Coding gefunden.',
            'Schließen',
            { duration: 5000 }
          );
          this.invalidateCodingStatusOverviewCache();
          this.loadCodingFreshness();
          return;
        }

        this.codingBackgroundJobsService.setJobRunning(
          workspaceId,
          'freshness-coding',
          true,
          result.jobId
        );
        this.activeFreshnessJobId.set(result.jobId);
        this.activeFreshnessJobWorkspaceId = workspaceId;
        this.activeFreshnessJobProgress.set(0);
        const dialogRef = this.openTestPersonCodingDialog({
          initialJobId: result.jobId,
          initialAutoCoderRun: version === 'v3' ? 2 : 1
        });
        dialogRef.afterClosed()
          .pipe(takeUntil(this.destroy$))
          .subscribe(dialogResult => {
            if (this.activeFreshnessJobId() !== result.jobId) {
              return;
            }

            const dialogStatus = dialogResult?.jobId === result.jobId ?
              dialogResult.jobStatus :
              null;
            if (this.isTerminalJobStatus(dialogStatus)) {
              const alreadyRefreshed =
                this.consumeHandledFreshnessJobCompletionRefresh(result.jobId);
              const pendingRefreshHandled = this.finishFreshnessCodingJob(result.jobId);
              this.stopFreshnessJobPolling();
              if (!alreadyRefreshed && !pendingRefreshHandled) {
                this.performCodingStatusOverviewRefresh(true);
              }
              return;
            }

            this.startFreshnessJobPolling(result.jobId, workspaceId);
          });
        this.snackBar.open(
          `Auto-Coding für ${result.unitCount} betroffene Einträge gestartet.`,
          'Schließen',
          { duration: 5000 }
        );
      });
  }

  protected onDownloadResults(): void {
    this.openDownloadCodingResultsDialog();
  }

  protected onCancelDownloadResults(): void {
    this.codingManagementService.cancelCodingResultsDownload();
  }

  protected cancelCodingListDownload(): void {
    this.codingManagementService.cancelCodingListDownload();
  }

  protected onResetVersion(): void {
    this.openResetVersionDialog();
  }

  onStatusClick(status: string): void {
    this.filterParams.set({
      ...this.filterParams(),
      version: this.selectedStatisticsVersion(),
      codedStatus: status,
      responseSource: 'all'
    });
    this.currentStatusFilter.set(null);
    this.pageIndex.set(0);
    this.fetchResponsesWithFilters();
  }

  onDerivedClick(): void {
    this.filterParams.set({
      ...this.createDefaultFilterParams(this.selectedStatisticsVersion()),
      responseSource: 'derived'
    });
    this.currentStatusFilter.set(null);
    this.pageIndex.set(0);
    this.fetchResponsesWithFilters();
  }

  // Filter Event Handlers
  onFilterChange(filterParams: FilterParams): void {
    this.filterParams.set(this.normalizeFilterParams({
      ...filterParams,
      version: this.selectedStatisticsVersion()
    }));

    if (!this.hasActiveFilters(this.filterParams())) {
      this.data = [];
      this.totalRecords.set(0);
      this.currentStatusFilter.set(null);
      this.pageIndex.set(0);
      return;
    }

    this.currentStatusFilter.set(null);
    this.pageIndex.set(0);
    this.fetchResponsesWithFilters();
  }

  onClearFilters(): void {
    this.filterParams.set(this.createDefaultFilterParams(this.selectedStatisticsVersion()));
    this.data = [];
    this.totalRecords.set(0);
    this.currentStatusFilter.set(null);
    this.pageIndex.set(0);
  }

  // Table Event Handlers
  onPageChange(event: PageEvent): void {
    const currentStatusFilterValue = this.currentStatusFilter();

    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);

    if (currentStatusFilterValue) {
      this.fetchResponsesByStatus(
        currentStatusFilterValue,
        this.pageIndex() + 1,
        this.pageSize()
      );
    } else if (this.hasActiveFilters()) {
      this.fetchResponsesWithFilters();
    }
  }

  onSortChange(sort: Sort): void {
    const currentStatusFilterSnapshot = this.currentStatusFilter();

    this.sortBy.set(this.isSupportedResponseSort(sort.active) && sort.direction ?
      sort.active :
      '');
    this.sortDirection.set(sort.direction === 'asc' || sort.direction === 'desc' ?
      sort.direction :
      '');
    this.pageIndex.set(0);

    if (currentStatusFilterSnapshot) {
      this.fetchResponsesByStatus(currentStatusFilterSnapshot, 1, this.pageSize());
    } else if (this.hasActiveFilters()) {
      this.fetchResponsesWithFilters();
    }
  }

  onReplayClick(response: Success): void {
    this.uiService.openReplayForResponse(response)
      .pipe(takeUntil(this.destroy$))
      .subscribe(replayUrl => {
        if (replayUrl) {
          window.open(replayUrl, '_blank');
        }
      });
  }

  onShowCodingScheme(unitId: number): void {
    this.uiService.getCodingSchemeFromUnit(unitId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(codingSchemeRef => {
        if (codingSchemeRef) {
          this.uiService.showCodingSchemeDialog(codingSchemeRef, this.destroyRef);
        }
      });
  }

  onShowUnitXml(unitId: number): void {
    this.uiService.showUnitXmlDialog(unitId, this.destroyRef);
  }

  onReviewClick(): void {
    if (!this.data || this.data.length === 0) {
      this.snackBar.open(
        this.translateService.instant('coding-management.messages.no-data-to-review'),
        this.translateService.instant('coding-management.actions.close'),
        { duration: 3000 }
      );
      return;
    }

    if (this.hasActiveFilters() && this.totalRecords() > this.data.length) {
      if (this.totalRecords() > this.maxReviewResponses) {
        this.snackBar.open(
          this.translateService.instant(
            'coding-management.messages.review-too-many-results',
            {
              count: this.totalRecords(),
              max: this.maxReviewResponses
            }
          ),
          this.translateService.instant('coding-management.actions.close'),
          { duration: 7000 }
        );
        return;
      }
      this.loadAllReviewResponses();
      return;
    }

    this.openReviewDialog(this.data);
  }

  private loadAllReviewResponses(): void {
    const totalReviewRecords = this.totalRecords();
    if (totalReviewRecords <= 0) {
      this.snackBar.open(
        this.translateService.instant('coding-management.messages.no-data-to-review'),
        this.translateService.instant('coding-management.actions.close'),
        { duration: 3000 }
      );
      return;
    }

    this.isLoadingReview.set(true);
    const reviewFilterParams = {
      ...this.filterParams(),
      regexSearch: this.enableRegexSearch()
    };
    const reviewBatchSize = Math.min(this.reviewBatchSize, totalReviewRecords);
    const reviewPageCount = Math.ceil(totalReviewRecords / reviewBatchSize);

    range(0, reviewPageCount).pipe(
      concatMap(batchIndex => this.codingManagementService.searchResponses(
        reviewFilterParams,
        batchIndex + 1,
        reviewBatchSize,
        this.sortBy() || undefined,
        this.sortDirection() || undefined
      )),
      reduce(
        (
          responses: Success[],
          response: { data: SearchResponseItem[]; total: number }
        ) => responses.concat(this.mapSearchResponseItemsToSuccess(response.data)),
        [] as Success[]
      ),
      finalize(() => {
        this.isLoadingReview.set(false);
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: responses => {
        if (!responses.length) {
          this.snackBar.open(
            this.translateService.instant('coding-management.messages.no-data-to-review'),
            this.translateService.instant('coding-management.actions.close'),
            { duration: 3000 }
          );
          return;
        }
        this.openReviewDialog(responses);
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('coding-management.messages.review-load-failed'),
          this.translateService.instant('coding-management.actions.close'),
          { duration: 5000 }
        );
      }
    });
  }

  private openReviewDialog(responses: Success[]): void {
    this.dialog.open(ReviewListDialogComponent, {
      width: '95vw',
      height: '95vh',
      maxWidth: '100vw',
      panelClass: 'full-screen-dialog',
      data: {
        responses,
        title: this.translateService.instant('coding-management.actions.review-session')
      }
    });
  }

  readonly codingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => this.allCodingFreshnessWarnings()
    .filter(item => !(item.version === 'v3' && this.isSecondAutocodingWaitingForManualCoding())));

  readonly hasCodingFreshnessWarnings = computed<boolean>(() => this.codingFreshnessWarnings().length > 0 ||
      this.shouldShowSecondAutocodingWaitingState());

  readonly codingFreshnessChipWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => {
    if (this.codingFreshnessWarnings().length > 0) {
      return this.codingFreshnessWarnings();
    }

    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.secondAutocodingFreshnessWarnings();
    }

    return [];
  });

  protected readonly hasImportedResultsWithoutCoding = computed<boolean>(() => this.statisticsLoaded() &&
      !this.hasCodingFreshnessWarnings() &&
      (this.codingFreshnessSummary()?.currentRevision || 0) > 0 &&
      (this.codingFreshnessSummary()?.items || []).length === 0 &&
      (this.codingStatistics().totalResponses || 0) === 0);

  protected readonly isAutocodingReadinessBlocked = computed<boolean>(() => this.autocodingReadiness()?.readiness === 'BLOCKED');

  readonly hasAutocodingReadinessLoadFailed = computed<boolean>(() => this.autocodingReadinessLoadFailed());

  get hasCodingFreshnessAttention(): boolean {
    return this.isCodingStatusOverviewPendingManualRefresh ||
      this.hasAutocodingReadinessLoadFailed() ||
      this.isAutocodingReadinessBlocked() ||
      this.hasCodingFreshnessWarnings() ||
      this.hasImportedResultsWithoutCoding();
  }

  readonly isFullCodingStatusCheckLoading = computed<boolean>(() => this.isLoadingAutocodingReadiness());

  get isCodingStatusOverviewPendingManualRefresh(): boolean {
    return !this.hasLoadedFullCodingStatusOverview() &&
      this.shouldShowManualCodingStatusRefresh() &&
      !this.hasAutocodingReadinessLoadFailed() &&
      !this.isAutocodingReadinessBlocked() &&
      !this.hasCodingFreshnessWarnings() &&
      !this.hasImportedResultsWithoutCoding();
  }

  readonly autoCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getCodingFreshnessAutoCodingWarnings(this.codingFreshnessWarnings()));

  readonly manualCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getCodingFreshnessManualReviewWarnings(this.codingFreshnessWarnings()));

  readonly hasManualCodingFreshnessAction = computed<boolean>(() => this.manualCodingFreshnessWarnings().length > 0 ||
      this.shouldShowSecondAutocodingWaitingState());

  readonly hasOnlyManualCodingFreshnessWarnings = computed<boolean>(() => hasOnlyManualCodingFreshnessWarnings(this.codingFreshnessWarnings()));

  readonly codingFreshnessAffectedUnits = computed<number>(() => getCodingFreshnessAffectedTaskResultCount(this.codingFreshnessWarnings()));

  readonly codingFreshnessAffectedResponses = computed<number>(() => getCodingFreshnessAffectedResponseCount(this.codingFreshnessWarnings()));

  get codingFreshnessSummaryText(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      if (this.manualAppliedResultsOverviewLoadFailed()) {
        return this.translateService.instant(
          'coding-management.readiness.manual-results-overview-load-failed'
        );
      }

      const remaining = this.manualAppliedResultsOverview()?.remainingResponses || 0;
      const remainingText = remaining > 0 ?
        this.translateService.instant(
          'coding-management.readiness.second-autocoding-waits-remaining',
          { count: remaining }
        ) :
        '';

      return this.translateService.instant(
        'coding-management.readiness.second-autocoding-waits-summary',
        { remaining: remainingText }
      );
    }

    return getCodingFreshnessSummaryText(this.codingFreshnessWarnings());
  }

  protected get codingFreshnessExplanationText(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.translateService.instant(
        'coding-management.readiness.second-autocoding-waits-help',
        { taskResultHelp: CODING_FRESHNESS_TASK_RESULT_HELP }
      );
    }

    return CODING_FRESHNESS_TASK_RESULT_HELP;
  }

  get codingFreshnessPanelTitle(): string {
    if (this.isCodingStatusOverviewPendingManualRefresh) {
      return this.translateService.instant('coding-management.readiness.title-not-checked');
    }

    if (this.hasAutocodingReadinessLoadFailed()) {
      return this.translateService.instant('coding-management.readiness.title-load-failed');
    }

    if (this.isAutocodingReadinessBlocked()) {
      return this.translateService.instant('coding-management.readiness.title-blocked');
    }

    if (this.hasImportedResultsWithoutCoding()) {
      return this.translateService.instant('coding-management.readiness.title-not-started');
    }

    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.translateService.instant('coding-management.readiness.title-manual-coding-open');
    }

    return getCodingFreshnessAttentionTitle(this.codingFreshnessWarnings());
  }

  get autocodingReadinessSummaryText(): string {
    const autocodingReadinessValue = this.autocodingReadiness();

    if (!autocodingReadinessValue) {
      return '';
    }

    return this.translateService.instant(
      'coding-management.readiness.summary',
      {
        rawResponsesTotal: autocodingReadinessValue.rawResponsesTotal,
        rawResponsesWithRelevantStatus: autocodingReadinessValue.rawResponsesWithRelevantStatus,
        codeableResponses: autocodingReadinessValue.codeableResponses
      }
    );
  }

  get autocodingReadinessDetailsText(): string {
    const autocodingReadinessValue = this.autocodingReadiness();

    if (!autocodingReadinessValue) {
      return '';
    }

    return [
      this.translateService.instant(
        'coding-management.readiness.details-result-units',
        { count: autocodingReadinessValue.resultUnitKeysTotal }
      ),
      this.translateService.instant(
        'coding-management.readiness.details-unit-files',
        { count: autocodingReadinessValue.matchedUnitFiles }
      ),
      this.translateService.instant(
        'coding-management.readiness.details-coding-schemes',
        { count: autocodingReadinessValue.matchedCodingSchemes }
      ),
      this.translateService.instant(
        'coding-management.readiness.details-valid-responses',
        { count: autocodingReadinessValue.validResponses }
      )
    ].join(' · ');
  }

  get autocodingReadinessMissingUnitPreview(): string {
    return this.formatPreview(this.autocodingReadiness()?.missingUnitFiles || [], 5);
  }

  protected get autocodingReadinessMissingCodingSchemePreview(): string {
    return this.formatPreview(this.autocodingReadiness()?.missingCodingSchemes || [], 5);
  }

  get autocodingReadinessInvalidCodingSchemePreview(): string {
    return this.formatPreview(this.autocodingReadiness()?.invalidCodingSchemes || [], 5);
  }

  get autocodingReadinessInvalidVariablePreview(): string {
    const samples = this.autocodingReadiness()?.invalidVariableSamples || [];
    if (samples.length === 0) {
      return '';
    }

    const visible = samples.slice(0, 3)
      .map(sample => {
        const variablePreview = this.formatPreview(sample.sampleVariableIds, 4);
        return `${sample.unitName}: ${variablePreview}`;
      })
      .join(' · ');
    const hidden = samples.length - 3;

    return hidden > 0 ?
      `${visible} · ${this.translateService.instant(
        'coding-management.readiness.additional-items',
        { count: hidden }
      )}` :
      visible;
  }

  protected readonly manualCodingFreshnessGuidanceText = computed<string>(() => getCodingFreshnessManualReviewGuidanceText(this.codingFreshnessWarnings()));

  protected readonly codingFreshnessGroupPreview = computed<string>(() => {
    const groupNames = this.codingFreshnessScope()?.groupNames || [];
    if (groupNames.length === 0) {
      return '';
    }
    const visible = groupNames.slice(0, 4).join(', ');
    const hidden = groupNames.length - 4;
    return hidden > 0 ? `${visible} +${hidden}` : visible;
  });

  hasFreshnessAutoCodingWork(version: 'v1' | 'v3'): boolean {
    return this.autoCodingFreshnessWarnings().some(item => item.version === version);
  }

  getFreshnessVersionLabel(version: 'v1' | 'v2' | 'v3'): string {
    return getCodingFreshnessVersionLabel(version);
  }

  getFreshnessStateLabel(state: CodingFreshnessState): string {
    return getCodingFreshnessStateLabel(state);
  }

  getFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
    if (item.version === 'v3' && this.isSecondAutocodingWaitingForManualCoding()) {
      const count = getCodingFreshnessAffectedTaskResultCount([item]);
      const countLabel = `${count} ${count === 1 ? 'Aufgabenbearbeitung' : 'Aufgabenbearbeitungen'}`;
      return this.translateService.instant(
        'coding-management.readiness.second-autocoding-waits-chip',
        {
          version: getCodingFreshnessVersionLabel(item.version),
          count: countLabel
        }
      );
    }

    return getCodingFreshnessChipLabel(item);
  }

  protected getFreshnessAutoCodingButtonLabel(version: 'v1' | 'v3'): string {
    return getCodingFreshnessAutoCodingButtonLabel(this.autoCodingFreshnessWarnings(), version);
  }

  private startFreshnessJobPolling(
    jobId: string,
    workspaceId = this.activeFreshnessJobWorkspaceId || this.appService.selectedWorkspaceId
  ): void {
    this.stopFreshnessJobPolling();
    this.activeFreshnessJobId.set(jobId);
    this.activeFreshnessJobWorkspaceId = workspaceId;
    this.freshnessJobPollingInterval = window.setInterval(() => {
      const currentWorkspaceId = this.activeFreshnessJobWorkspaceId || this.appService.selectedWorkspaceId;
      if (!currentWorkspaceId) {
        this.stopFreshnessJobPolling();
        return;
      }

      this.testPersonCodingService.getJobStatus(currentWorkspaceId, jobId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(status => {
          if (!('status' in status)) {
            if (!this.hasShownFreshnessJobStatusPollingError) {
              this.hasShownFreshnessJobStatusPollingError = true;
              this.snackBar.open(status.error, 'Schließen', { duration: 5000 });
            }
            return;
          }

          this.hasShownFreshnessJobStatusPollingError = false;
          this.activeFreshnessJobProgress.set(status.progress);
          if (['completed', 'failed', 'cancelled', 'paused'].includes(status.status)) {
            const pendingRefreshHandled = this.finishFreshnessCodingJob(jobId);
            this.stopFreshnessJobPolling();
            if (status.status === 'completed') {
              this.freshnessJobCompletionRefreshHandledIds.add(jobId);
              this.testPersonCodingService.notifyAutoCodingCompleted(jobId);
              this.snackBar.open(
                'Betroffene Ergebnisse wurden kodiert.',
                'Schließen',
                { duration: 4000 }
              );
            } else if (status.status === 'failed') {
              this.snackBar.open(
                status.error || 'Auto-Coding für betroffene Ergebnisse fehlgeschlagen.',
                'Schließen',
                { duration: 6000 }
              );
            }
            if (!pendingRefreshHandled) {
              this.performCodingStatusOverviewRefresh(true);
            }
          }
        });
    }, 2000);
  }

  private finishFreshnessCodingJob(jobId: string): boolean {
    const workspaceId = this.activeFreshnessJobWorkspaceId || this.appService.selectedWorkspaceId;
    const hadPendingRefresh = this.hasPendingCodingStatusOverviewRefreshAfterBackgroundJob();
    this.codingBackgroundJobsService.setJobRunning(
      workspaceId,
      'freshness-coding',
      false,
      jobId
    );
    return hadPendingRefresh &&
      !this.codingBackgroundJobsService.isStatusCheckGuardActive(workspaceId);
  }

  private readonly allCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => (this.codingFreshnessSummary()?.items || [])
    .filter(isCodingFreshnessOpenWarning));

  private readonly secondAutocodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getSecondAutocodingFreshnessWarnings(this.allCodingFreshnessWarnings()));

  private readonly hasSecondAutocodingFreshnessWarnings = computed<boolean>(() => this.secondAutocodingFreshnessWarnings().length > 0);

  private readonly isSecondAutocodingWaitingForManualCoding = computed<boolean>(() => isSecondAutocodingWaitingForManualCoding(
    this.allCodingFreshnessWarnings(),
    this.manualAppliedResultsOverview(),
    this.manualAppliedResultsOverviewLoadFailed()
  ));

  private readonly shouldShowSecondAutocodingWaitingState = computed<boolean>(() => this.isSecondAutocodingWaitingForManualCoding() &&
      this.codingFreshnessWarnings().length === 0);

  private stopFreshnessJobPolling(): void {
    if (this.freshnessJobPollingInterval) {
      clearInterval(this.freshnessJobPollingInterval);
      this.freshnessJobPollingInterval = null;
    }
    this.activeFreshnessJobId.set(null);
    this.activeFreshnessJobWorkspaceId = null;
    this.activeFreshnessJobProgress.set(null);
  }

  private startResponseTableRequest(): number {
    this.responseTableRequestCancel$.next();
    this.responseTableRequestId += 1;
    return this.responseTableRequestId;
  }

  private isCurrentResponseTableRequest(requestId: number): boolean {
    return requestId === this.responseTableRequestId;
  }

  // Data Fetching Methods
  private fetchResponsesByStatus(
    status: string,
    page: number = 1,
    limit: number = this.pageSize()
  ): void {
    const requestId = this.startResponseTableRequest();
    this.isLoading.set(true);
    this.currentStatusFilter.set(status);

    this.codingManagementService.fetchResponsesByStatus(
      status,
      this.selectedStatisticsVersion(),
      page,
      limit,
      this.sortBy() || undefined,
      this.sortDirection() || undefined
    ).pipe(
      takeUntil(this.responseTableRequestCancel$),
      takeUntil(this.destroy$)
    ).subscribe({
      next: response => {
        if (!this.isCurrentResponseTableRequest(requestId)) {
          return;
        }
        this.data = response.data.map((item: ResponseEntity) => {
          const codeKey = `code_${this.selectedStatisticsVersion()}` as keyof ResponseEntity;
          const scoreKey = `score_${this.selectedStatisticsVersion()}` as keyof ResponseEntity;
          const statusKey = `status_${this.selectedStatisticsVersion()}` as keyof ResponseEntity;

          return {
            id: item.id,
            unitid: item.unitId,
            variableid: item.variableid || '',
            status: item.status || '',
            value: item.value || '',
            subform: item.subform || '',
            code: (item[codeKey] as number)?.toString() || null,
            score: (item[scoreKey] as number)?.toString() || null,
            unit: item.unit,
            codedstatus: (item[statusKey] as string) || '',
            unitname: item.unit?.name || '',
            login_name: item.unit?.booklet?.person?.login || '',
            login_group: (item.unit?.booklet?.person as { group?: string } | undefined)?.group || '',
            login_code: item.unit?.booklet?.person?.code || '',
            booklet_id: item.unit?.booklet?.bookletinfo?.name || ''
          } as Success;
        });
        this.totalRecords.set(response.total);
        this.isLoading.set(false);

        if (this.data.length === 0) {
          const statusName = getResponseStatusLabel(status);
          this.snackBar.open(
            this.translateService.instant('coding-management.descriptions.no-results', { status: statusName === 'null' ? this.translateService.instant('coding-management.statistics.uncoded-responses-title') : statusName }),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      },
      error: () => {
        if (!this.isCurrentResponseTableRequest(requestId)) {
          return;
        }
        this.isLoading.set(false);
      }
    });
  }

  private fetchResponsesWithFilters(): void {
    const requestId = this.startResponseTableRequest();
    this.isLoading.set(true);

    if (!this.hasActiveFilters()) {
      this.data = [];
      this.totalRecords.set(0);
      this.isLoading.set(false);
      return;
    }

    this.codingManagementService.searchResponses(
      {
        ...this.filterParams(),
        regexSearch: this.enableRegexSearch()
      },
      this.pageIndex() + 1,
      this.pageSize(),
      this.sortBy() || undefined,
      this.sortDirection() || undefined
    ).pipe(
      takeUntil(this.responseTableRequestCancel$),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response: { data: SearchResponseItem[]; total: number }) => {
        if (!this.isCurrentResponseTableRequest(requestId)) {
          return;
        }
        this.data = this.mapSearchResponseItemsToSuccess(response.data);
        this.totalRecords.set(response.total);
        this.isLoading.set(false);

        if (this.data.length === 0) {
          this.snackBar.open(
            'Keine Daten mit den angegebenen Filtern gefunden.',
            'Schließen',
            { duration: 5000 }
          );
        }
      },
      error: () => {
        if (!this.isCurrentResponseTableRequest(requestId)) {
          return;
        }
        this.isLoading.set(false);
      }
    });
  }

  private mapSearchResponseItemsToSuccess(items: SearchResponseItem[]): Success[] {
    return items.map(item => this.mapSearchResponseItemToSuccess(item));
  }

  private mapSearchResponseItemToSuccess(item: SearchResponseItem): Success {
    const geoGebraBase64 = extractGeoGebraBase64(item.value);
    return {
      id: item.responseId,
      unitid: item.unitId,
      variableid: item.variableId || '',
      status: item.status || '',
      value: item.value || '',
      isGeoGebraValue: !!geoGebraBase64,
      geoGebraBase64,
      subform: '',
      code: item.code?.toString() || null,
      score: item.score?.toString() || null,
      unit: { name: item.unitName },
      codedstatus: item.codedStatus || '',
      unitname: item.unitName || '',
      login_name: item.personLogin || '',
      login_group: item.personGroup || '',
      login_code: item.personCode || '',
      booklet_id: item.bookletName || '',
      person_code: item.personCode || '',
      person_group: item.personGroup || '',
      variable_page: item.variablePage || '0',
      code_v1: item.code_v1,
      code_v2: item.code_v2,
      code_v3: item.code_v3,
      status_v1: item.status_v1,
      status_v2: item.status_v2,
      status_v3: item.status_v3
    };
  }

  private isSupportedResponseSort(sortBy: string): sortBy is CodingResponseSortBy {
    return [
      'unitname',
      'variableid',
      'value',
      'codedstatus',
      'code',
      'score',
      'person_code',
      'person_login',
      'person_group',
      'booklet_id'
    ].includes(sortBy);
  }

  // Dialog Methods
  protected onAutoCode(): void {
    this.openTestPersonCodingDialog();
  }

  private openTestPersonCodingDialog(
    data?: TestPersonCodingDialogData
  ): MatDialogRef<TestPersonCodingDialogComponent, TestPersonCodingDialogResult | undefined> {
    const dialogRef = this.dialog.open(TestPersonCodingDialogComponent, {
      height: '90vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      disableClose: true,
      data
    });

    dialogRef.afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe(dialogResult => {
        if (data?.initialJobId) {
          return;
        }
        if (this.isTerminalJobStatus(dialogResult?.jobStatus)) {
          this.refreshCodingStatusOverviewAfterChange();
        }
      });

    return dialogRef;
  }

  private isTerminalJobStatus(status?: string | null): boolean {
    return ['completed', 'failed', 'cancelled', 'paused'].includes(status || '');
  }

  protected fetchCodingList(): void {
    const dialogRef = this.dialog.open(ExportDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: { format: ExportFormat; trainingRequired?: boolean } | undefined) => {
      if (result && result.format) {
        this.codingManagementService.downloadCodingList(result.format, result.trainingRequired);
      }
    });
  }

  protected openExportCodingBook(): void {
    this.dialog.open(ExportCodingBookComponent, {
      width: '80%',
      height: '80%'
    });
  }

  openManualCoding(focusManualFreshness = false): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const navigationExtras = focusManualFreshness ?
      { queryParams: { focus: 'manual-freshness' } } :
      undefined;

    this.router.navigate([`/workspace-admin/${workspaceId}/coding/manual`], navigationExtras);
  }

  openTestFiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.router.navigate([`/workspace-admin/${workspaceId}/test-files`]);
  }

  protected fetchVariableAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.dialog.open(VariableAnalysisDialogComponent, {
      width: '90%',
      height: '90%',
      maxWidth: '1400px',
      maxHeight: '900px',
      data: { workspaceId }
    });
  }

  protected fetchUnitVariables(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.dialog.open(CodingVariablesDialogComponent, {
      width: '95vw',
      maxWidth: '1400px',
      height: '95vh',
      data: { workspaceId },
      panelClass: 'coding-variables-dialog-container'
    });
  }

  private openResetVersionDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        'Fehler: Kein Workspace ausgewählt',
        'Schließen',
        {
          duration: 5000,
          panelClass: ['error-snackbar']
        }
      );
      return;
    }

    const versionOption = [
      { value: 'v1', label: 'coding-management.statistics.first-autocode-run' },
      { value: 'v2', label: 'coding-management.statistics.manual-coding-run' },
      { value: 'v3', label: 'coding-management.statistics.second-autocode-run' }
    ].find(opt => opt.value === this.selectedStatisticsVersion());

    const versionLabel = versionOption?.label || '';
    const cascadeVersions = this.selectedStatisticsVersion() === 'v2' ? ['v3'] : [];

    const dialogRef = this.dialog.open(ResetVersionDialogComponent, {
      width: '500px',
      data: {
        version: this.selectedStatisticsVersion(),
        versionLabel: versionLabel,
        cascadeVersions: cascadeVersions
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: boolean | undefined) => {
      if (result === true) {
        this.resetCodingVersion(this.selectedStatisticsVersion());
      }
    });
  }

  private resetCodingVersion(version: 'v1' | 'v2' | 'v3'): void {
    this.codingManagementService.resetCodingVersion(version);
  }

  private openDownloadCodingResultsDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        'Fehler: Kein Workspace ausgewählt',
        'Schließen',
        {
          duration: 5000,
          panelClass: ['error-snackbar']
        }
      );
      return;
    }

    const dialogRef = this.dialog.open(DownloadCodingResultsDialogComponent, {
      width: '550px',
      data: {
        workspaceId,
        currentVersion: this.selectedStatisticsVersion(),
        hasGeoGebraResponses: this.isGeogebraAvailable()
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: {
      version: StatisticsVersion;
      format: CodingResultsExportFormat;
      includeReplayUrls: boolean;
      includeResponseValues: boolean;
      includeGeoGebraFiles: boolean;
      includeGeoGebraResponseValues: boolean;
      missingsProfileId: number;
    } | undefined) => {
      if (result) {
        const {
          version,
          format,
          includeReplayUrls,
          includeResponseValues,
          includeGeoGebraFiles,
          includeGeoGebraResponseValues,
          missingsProfileId
        } = result;
        this.codingManagementService.downloadCodingResults(
          version,
          format,
          missingsProfileId,
          includeReplayUrls,
          includeResponseValues,
          includeGeoGebraFiles,
          includeGeoGebraResponseValues
        )
          .finally(() => {
            this.isDownloadInProgress.set(false);
          });
      }
    });
  }

  getAvailableStatuses(): string[] {
    const ignoredStatuses = [
      '0', '1', '2', '3', '10',
      'UNSET', 'NOT_REACHED', 'DISPLAYED', 'VALUE_CHANGED', 'PARTLY_DISPLAYED'
    ];
    return Object.keys(this.codingStatistics().statusCounts).filter(s => !ignoredStatuses.includes(s));
  }

  private refreshTableData(): void {
    const currentStatusFilterSnapshot = this.currentStatusFilter();

    if (this.data.length === 0) return;

    if (currentStatusFilterSnapshot) {
      this.fetchResponsesByStatus(currentStatusFilterSnapshot);
    } else if (this.hasActiveFilters()) {
      this.fetchResponsesWithFilters();
    }
  }

  private createDefaultFilterParams(version: StatisticsVersion = this.selectedStatisticsVersion()): FilterParams {
    return {
      value: '',
      unitName: '',
      codedStatus: '',
      version,
      code: '',
      codingCode: '',
      score: '',
      group: '',
      bookletName: '',
      variableId: '',
      geogebra: false,
      responseSource: 'all',
      personLogin: ''
    };
  }

  private normalizeFilterParams(filterParams: FilterParams): FilterParams {
    if (filterParams.geogebra && filterParams.responseSource === 'all') {
      return {
        ...filterParams,
        responseSource: 'base'
      };
    }

    return filterParams;
  }

  private hasActiveFilters(filterParams: FilterParams = this.filterParams()): boolean {
    return Object.entries(filterParams).some(
      ([key, value]) => {
        if (key === 'version') return false;
        if (key === 'regexSearch') return false;
        if (key === 'responseSource') return value !== 'all';
        return typeof value === 'string' ? value.trim() !== '' : value === true;
      }
    );
  }

  private formatPreview(values: string[], maxItems: number): string {
    if (values.length === 0) {
      return '';
    }

    const visible = values.slice(0, maxItems).join(', ');
    const hidden = values.length - maxItems;

    return hidden > 0 ? `${visible} +${hidden}` : visible;
  }

  protected openItemListDialog(): void {
    this.dialog.open(ItemListDialogComponent, {
      width: '600px',
      maxHeight: '80vh'
    });
  }
}
