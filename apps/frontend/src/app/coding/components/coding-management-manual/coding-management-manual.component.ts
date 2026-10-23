import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef, Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy, OnInit,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  debounceTime, finalize, Observable,
  Subject, takeUntil
} from 'rxjs';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CoderTraining } from '../../models/coder-training.model';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { CoderTrainingComponent } from '../coder-training/coder-training.component';
import { CODER_TRAINING_RECOVERY_KEY, CoderTrainingRecoveryDraft, VariableConfig } from '../coder-training/coder-training.models';
import { CoderTrainingsListComponent } from '../coder-trainings-list/coder-trainings-list.component';
import { CodingJobDefinitionsComponent } from '../coding-job-definitions/coding-job-definitions.component';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';
import { ManualCodingAggregationSettingsComponent } from './manual-coding-aggregation-settings.component';
import { ManualCodingAggregationFacade } from './manual-coding-aggregation.facade';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { createManualCodingExportConfig } from './manual-coding-export-plan';
import { ManualCodingExportScopeFacade } from './manual-coding-export-scope.facade';
import { ManualCodingExportFacade, ManualExportDecision, ManualExportWorksheetWarning } from './manual-coding-export.facade';
import { ManualCodingImportFacade } from './manual-coding-import.facade';
import {
  buildManualFreshnessJobSummary,
  hasBlockingCodingIssues, hasCodingIssuesForCompletedJob,
  isActiveCodingJob,
  isCodingJobReadyForApply,
  isCompletedManualCodingJob,
  isTrainingCodingJob
} from './manual-coding-job-summary';
import {
  ManualCodingPlanning, ManualCodingTab, ManualFreshnessTarget, PlanningStatusState
} from './manual-coding-planning';
import { ManualCodingPlanningFacade } from './manual-coding-planning.facade';
import { ManualCodingSettingsFacade } from './manual-coding-settings.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import type { Coder } from '../../models/coder.model';
import { CodingJob } from '../../models/coding-job.model';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import {
  ApplyCodingResultsDialogComponent,
  ApplyCodingResultsDialogResult
} from '../coding-jobs/apply-coding-results-dialog.component';

import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';

import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import {
  ApplyCodingResultsResponse, BulkApplyCodingResultsResponse, CodingJobBackendService, JobDefinition
} from '../../services/coding-job-backend.service';
import { MissingsProfileService } from '../../services/missings-profile.service';

import {
  ResponseMatchingFlag,
  WorkspaceSettingsService
} from '../../../shared/services/workspace/workspace-settings.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';

import { CodingFreshnessSummaryItemDto } from '../../../../../../../api-dto/coding/coding-freshness.dto';
import type {
  ManualCodeAvailabilityWarningDto
} from '../../../../../../../api-dto/coding/manual-code-availability.dto';
import { MissingDto, MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import {
  CODING_FRESHNESS_TASK_RESULT_HELP,
  formatCodingFreshnessResponseCount,
  formatCodingFreshnessTaskResultCount,
  getCodingFreshnessAffectedResponseCount,
  getCodingFreshnessAffectedTaskResultCount,
  getCodingFreshnessAttentionTitle,
  getCodingFreshnessAutoCodingWarnings,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessManualReviewWarnings,
  getCodingFreshnessSummaryText,
  isCodingFreshnessOpenWarning
} from '../../../shared/utils/coding-freshness-text.util';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { CohensKappaStatisticsComponent } from '../cohens-kappa-statistics/cohens-kappa-statistics.component';
import { DoubleCodedReviewComponent } from '../double-coded-review/double-coded-review.component';
import {
  ManualCodingExportDialogComponent,
  ManualCodingExportDialogResult
} from '../manual-coding-export-dialog/manual-coding-export-dialog.component';

type ConcreteCodingJobsReloadScope = 'productive' | 'training';
type CodingJobsReloadScope = 'active' | 'productive' | 'training' | 'rendered';

interface ManualFreshnessJobSummary {
  activeTrainingJobs: number;
  openProductiveJobs: number;
  completedProductiveJobs: number;
  staleSourceJobs: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  standalone: true,
  providers: [ManualCodingAggregationFacade, ManualCodingExportScopeFacade, ManualCodingExportFacade, ManualCodingImportFacade, ManualCodingStatisticsFacade, ManualCodingSettingsFacade, ManualCodingAnalysisFacade, ManualCodingPlanningFacade],
  imports: [
    ManualCodingAggregationSettingsComponent,
    TranslateModule,
    MatAnchor,
    CodingJobsComponent,
    CodingJobDefinitionsComponent,
    MatIcon,
    MatButton,
    MatIconButton,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTooltipModule,
    VariableBundleManagerComponent,
    CoderTrainingComponent,
    CoderTrainingsListComponent,
    CommonModule,
    FormsModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatTabsModule
  ]
})
export class CodingManagementManualComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly importFacade = inject(ManualCodingImportFacade);
  private readonly statistics = inject(ManualCodingStatisticsFacade);
  private readonly settings = inject(ManualCodingSettingsFacade);
  private readonly aggregation = inject(ManualCodingAggregationFacade);
  private readonly analysis = inject(ManualCodingAnalysisFacade);
  private readonly planningData = inject(ManualCodingPlanningFacade);
  private readonly exportScope = inject(ManualCodingExportScopeFacade);
  private readonly exports = inject(ManualCodingExportFacade);

  readonly codingJobsComponent = viewChild(CodingJobsComponent);

  readonly productiveCodingJobsComponent = viewChild<CodingJobsComponent>('productiveCodingJobs');

  readonly trainingCodingJobsComponent = viewChild<CodingJobsComponent>('trainingCodingJobs');

  readonly codingJobDefinitionsComponent = viewChild(CodingJobDefinitionsComponent);

  readonly coderTrainingsListComponent = viewChild(CoderTrainingsListComponent);

  private testPersonCodingService = inject(TestPersonCodingService);

  private codingJobBackendService = inject(CodingJobBackendService);
  private missingsProfileService = inject(MissingsProfileService);

  private appService = inject(AppService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private sessionRecoveryService = inject(SessionRecoveryService);
  private snackBar = inject(MatSnackBar);
  private validationStateService = inject(ValidationStateService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private userBackendService = inject(UserBackendService);
  private translateService = inject(TranslateService);
  private dialog = inject(MatDialog);
  private codingBackgroundJobsService = inject(CodingBackgroundJobsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private document = inject(DOCUMENT);

  protected readonly validationProgress = signal<ValidationProgress | null>(null);
  private readonly validationIsLoading = signal(false);
  protected readonly isLoading = computed(() => this.validationIsLoading() || this.importFacade.isImporting());
  readonly autoRefreshManualCodingJobs = signal(true);
  private hasLoadedManualCodingJobRefreshSetting = false;
  readonly canApplyManualCodingResults = signal(false);
  readonly canManageManualCodingJobs = signal(false);
  readonly selectedManualTabIndex = signal(0);
  readonly manualCodingTabs: ManualCodingTab[] = [
    'preparation',
    'planning',
    'training',
    'execution',
    'completion'
  ];

  readonly renderedManualTabs = signal<Record<ManualCodingTab, boolean>>({
    preparation: true,
    planning: false,
    training: false,
    execution: false,
    completion: false
  });

  private readonly loadedManualTabData: Record<ManualCodingTab, boolean> = {
    preparation: false,
    planning: false,
    training: false,
    execution: false,
    completion: false
  };

  private get hasLoadedPlanningDataBundle(): boolean { return this.planningData.hasLoadedPlanningDataBundle; }

  private pendingAutomaticManualTabLoad: ManualCodingTab | null = null;

  private readonly pendingCodingJobsReloadScopes =
    new Set<ConcreteCodingJobsReloadScope>();

  private pendingCodingJobsReloadTimer?: ReturnType<typeof setTimeout>;

  private readonly manualCodingTabsWithoutCompletion: ManualCodingTab[] = [
    'preparation',
    'planning',
    'training',
    'execution'
  ];

  // Granular loading states
  protected readonly isLoadingVariableCoverage = this.statistics.isLoadingVariableCoverage;
  protected readonly isLoadingCaseCoverage = this.statistics.isLoadingCaseCoverage;
  readonly isLoadingCodingProgress = this.statistics.isLoadingCodingProgress;
  readonly isLoadingManualCodeAvailability = this.statistics.isLoadingManualCodeAvailability;
  private get isLoadingManualCodingScopeSummary(): boolean { return this.statistics.isLoadingManualCodingScopeSummary(); }
  readonly isLoadingCodingIncompleteVariables = this.statistics.isLoadingCodingIncompleteVariables;
  readonly isLoadingAppliedResultsOverview = this.statistics.isLoadingAppliedResultsOverview;
  readonly isLoadingKappaSummary = this.statistics.isLoadingKappaSummary;

  // Response matching mode configuration
  readonly responseMatchingFlags = this.settings.responseMatchingFlags;
  private get persistedResponseMatchingFlags(): readonly ResponseMatchingFlag[] { return this.settings.persistedResponseMatchingFlags; }

  readonly isLoadingMatchingMode = this.settings.isLoadingMatchingMode;
  protected readonly isSavingMatchingMode = this.settings.isSavingMatchingMode;
  protected ResponseMatchingFlag = ResponseMatchingFlag; // Expose enum to template

  // Response analysis data
  readonly responseAnalysis = this.analysis.responseAnalysis;
  protected readonly responseAnalysisError = this.analysis.responseAnalysisError;

  readonly isLoadingResponseAnalysis = this.analysis.isLoadingResponseAnalysis;
  protected readonly showEmptyResponsesDetails = signal(false);
  protected readonly showDuplicateValuesDetails = signal(false);
  protected readonly isApplyingEmptyCoding = this.aggregation.isApplyingEmptyCoding;
  readonly showProgressInfo = signal(false);
  protected readonly showTotalDetails = signal(false);
  protected readonly showVariableCoverageInfo = signal(false);
  protected readonly showCaseCoverageInfo = signal(false);
  protected readonly showAppliedResultsInfo = signal(false);
  protected readonly showVariableBundlesInfo = signal(false);
  protected readonly showCoderTrainingsInfo = signal(false);
  protected readonly showCodingJobsInfo = signal(false);

  // Duplicate aggregation state
  readonly duplicateAggregationThreshold = this.settings.duplicateAggregationThreshold;
  readonly isApplyingDuplicateAggregation = this.aggregation.isApplyingDuplicateAggregation;

  private readonly windowFocusRefreshThrottleMs = 30000;

  private lastWindowFocusRefreshAt = 0;

  private get responseAnalysisGuardActive(): boolean { return this.analysis.responseAnalysisGuardActive; }
  private set responseAnalysisGuardActive(value: boolean) { this.analysis.responseAnalysisGuardActive = value; }

  private pendingManualStateRefreshAfterBackgroundJob = false;
  private pendingForcedManualStateRefreshAfterBackgroundJob = false;
  private pendingCodingFreshnessRefreshAfterBackgroundJob = false;
  private pendingForcedCodingFreshnessRefreshAfterBackgroundJob = false;
  private readonly handleWindowFocus = () => {
    if (!this.shouldRefreshManualStateOnFocus()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastWindowFocusRefreshAt < this.windowFocusRefreshThrottleMs) {
      return;
    }

    if (this.shouldSuppressCodingStatusChecks()) {
      this.pendingManualStateRefreshAfterBackgroundJob = true;
      return;
    }

    this.lastWindowFocusRefreshAt = now;
    this.refreshManualStateAfterExternalChange();
  };

  protected readonly emptyPageIndex = this.analysis.emptyPageIndex;
  protected readonly emptyPageSize = this.analysis.emptyPageSize;
  protected readonly duplicatePageIndex = this.analysis.duplicatePageIndex;
  protected readonly duplicatePageSize = this.analysis.duplicatePageSize;

  // Debouncing for job definition changes
  private jobDefinitionChangeSubject = new Subject<CodingJobsReloadScope>();

  readonly codingProgressOverview = this.statistics.codingProgressOverview;

  readonly variableCoverageOverview = this.statistics.variableCoverageOverview;

  readonly caseCoverageOverview = this.statistics.caseCoverageOverview;

  readonly workspaceKappaSummary = this.statistics.workspaceKappaSummary;

  readonly codingIncompleteVariables = this.statistics.codingIncompleteVariables;

  protected readonly manualCodingScopeSummary = this.statistics.manualCodingScopeSummary;
  readonly manualCodeAvailabilityWarnings = this.statistics.manualCodeAvailabilityWarnings;
  protected readonly showAllManualCodeAvailabilityWarnings = this.statistics.showAllManualCodeAvailabilityWarnings;
  readonly manualCodeAvailabilityPreviewLimit = 5;

  readonly statusDistribution = this.statistics.statusDistribution;

  readonly statusDistributionV2 = this.statistics.statusDistributionV2;

  readonly appliedResultsOverview = this.statistics.appliedResultsOverview;

  readonly completedJobsReadyForApply = this.statistics.completedJobsReadyForApply;
  readonly completedJobsBlockedForReview = this.statistics.completedJobsBlockedForReview;
  readonly codingFreshnessSummary = this.statistics.codingFreshnessSummary;
  private get manualFreshnessJobSummary(): ManualFreshnessJobSummary | null { return this.statistics.manualFreshnessJobSummary; }
  private get openDoubleCodingConflictCount(): number { return this.statistics.openDoubleCodingConflictCount; }

  protected readonly isLoadingCompletedJobsReadyForApply = this.statistics.isLoadingCompletedJobsReadyForApply;
  readonly isLoadingCodingFreshness = this.statistics.isLoadingCodingFreshness;
  readonly isLoadingManualFreshnessJobSummary = this.statistics.isLoadingManualFreshnessJobSummary;
  readonly isLoadingDoubleCodingConflictSummary = this.statistics.isLoadingDoubleCodingConflictSummary;

  protected readonly isApplyingCodingResults = signal(false);

  private applyingCodingResultJobIds = new Set<number>();
  protected readonly emptyResponseMissing = signal<{
    code: number;
    score: number | null;
  } | null>(null);

  protected readonly showCoderTraining = signal(false);
  protected readonly editTraining = signal<CoderTraining | null>(null);
  readonly coders = this.exportScope.coders;
  readonly isStartingManualExport = this.exports.isStarting;
  protected readonly isLoadingCodersForExport = this.exportScope.isLoadingCodersForExport;
  private readonly manualFreshnessFocusParam = 'manual-freshness';
  private pendingManualFreshnessFocus = false;
  private manualFreshnessPlanningRequested = false;

  expectedCombinations: ExpectedCombinationDto[] = [];

  private readonly planning = computed(() => new ManualCodingPlanning({
    hasVariableCoverageConflicts: this.hasVariableCoverageConflicts(),
    hasManualCodeAvailabilityWarnings: this.hasManualCodeAvailabilityWarnings(),
    activeManualTab: this.activeManualTab,
    hasLoadedPlanningDataBundle: this.hasLoadedPlanningDataBundle,
    isPlanningStatusLoading: this.isPlanningStatusLoading(),
    shouldRequirePlanningDataRefresh: this.shouldRequirePlanningDataRefresh(),
    hasPreparationRefreshTarget: this.hasPreparationRefreshTarget(),
    variableCoverageOverview: this.variableCoverageOverview(),
    caseCoverageOverview: this.caseCoverageOverview(),
    isPlanningReady: this.isPlanningReady(),
    hasActiveTrainingCodingJobs: this.hasActiveTrainingCodingJobs(),
    codingProgressOverview: this.codingProgressOverview(),
    hasExecutionOpenWorkForFreshness: this.hasExecutionOpenWorkForFreshness(),
    hasOpenDoubleCodingReviewConflicts: this.hasOpenDoubleCodingReviewConflicts(),
    hasStaleSourceManualJobs: this.hasStaleSourceManualJobs(),
    isCompletionComplete: this.isCompletionComplete(),
    appliedResultsOverview: this.appliedResultsOverview(),
    hasCompletionReadyWorkForFreshness: this.hasCompletionReadyWorkForFreshness(),
    canShowManualCompletionTab: this.canShowManualCompletionTab(),
    isResponseAnalysisOutdated: this.isResponseAnalysisOutdated(),
    manualCodeAvailabilityWarningCount: this.manualCodeAvailabilityWarningCount(),
    manualFreshnessJobSummary: this.manualFreshnessJobSummary,
    openDoubleCodingConflictCount: this.openDoubleCodingConflictCount,
    getAvailableCasesForNewJobs: this.getAvailableCasesForNewJobs(),
    getUnavailableCasesForNewJobs: this.getUnavailableCasesForNewJobs()
  }));

  ngOnInit(): void {
    this.aggregation.refreshRequested$.pipe(takeUntil(this.destroy$)).subscribe(request => {
      if (request.scope === 'all') this.refreshAllStatistics();
      else this.refreshAggregationDependentViews(request.includeResponseAnalysis);
    });
    this.planningData.freshnessRefreshRequested$.pipe(takeUntil(this.destroy$)).subscribe(options => this.loadCodingFreshness(options));
    this.planningData.analysisRequested$.pipe(takeUntil(this.destroy$)).subscribe(() => this.loadResponseAnalysisForPlanningIfNeeded());
    this.planningData.restored$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadedManualTabData.planning = true;
      this.focusManualFreshnessTargetIfReady();
    });
    this.analysis.isViewActive = () => this.isResponseAnalysisTab(this.activeManualTab);
    this.analysis.reloadRequested$.pipe(takeUntil(this.destroy$)).subscribe(() => this.loadResponseAnalysis());
    this.analysis.viewUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.focusManualFreshnessTargetIfReady();
    });
    this.statistics.settled$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.focusManualFreshnessTargetIfReady();
    });
    this.pendingManualFreshnessFocus =
      this.route.snapshot.queryParamMap.get('focus') === this.manualFreshnessFocusParam;

    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe((progress: ValidationProgress | null) => {
        this.validationProgress.set(progress);
        if (!progress) {
          this.validationIsLoading.set(false);
          return;
        }

        this.validationIsLoading.set(progress.status === 'loading' || progress.status === 'processing');

        if (progress.status === 'error') {
          this.showError(
            progress.error ||
            this.translateService.instant(
              'coding-management-manual.errors.validation-failed'
            )
          );
        }
      });

    const currentProgress = this.validationStateService.getValidationProgress();
    this.validationProgress.set(currentProgress);
    this.validationIsLoading.set(currentProgress.status === 'loading' ||
    currentProgress.status === 'processing');

    this.loadCodersForExport();

    // Set up debounced statistics refresh
    this.jobDefinitionChangeSubject
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe(reloadScope => {
        this.invalidateCodingStatusCache();
        this.loadJobDefinitionsForExport();
        this.loadManualTabData(this.activeManualTab);
        this.refreshCodingJobsAfterDataChange(reloadScope);
      });

    this.settings.initialSettingsLoaded$.pipe(takeUntil(this.destroy$)).subscribe(() => this.loadManualTabData(this.activeManualTab));
    this.settings.settled$.pipe(takeUntil(this.destroy$)).subscribe(() => this.focusManualFreshnessTargetIfReady());

    this.settings.thresholdSaved$.pipe(takeUntil(this.destroy$)).subscribe(() => this.refreshAggregationDependentViews());

    this.testPersonCodingService.autoCodingCompleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.resetPlanningDataBundleState();
        if (!this.hasLoadedManualCodingJobRefreshSetting ||
          !this.autoRefreshManualCodingJobs()) {
          return;
        }

        if (this.activeManualTab === 'planning') {
          this.refreshCodingJobsAfterDataChange('rendered');
          return;
        }

        this.refreshAllStatistics();
        this.loadCodingFreshness();
        this.loadResponseAnalysis();
        this.refreshCodingJobsAfterDataChange('rendered');
        this.loadJobDefinitionsForExport();
        const codingJobDefinitionsComponent = this.codingJobDefinitionsComponent();
        if (codingJobDefinitionsComponent) {
          codingJobDefinitionsComponent.refresh();
        }
      });

    this.codingBackgroundJobsService.statusGuardCleared$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.workspaceId === this.appService.selectedWorkspaceId) {
          this.refreshPendingManualStatusAfterBackgroundJob();
        }
      });

    this.sessionRecoveryService.restore$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.restoreCoderTrainingRecoveryOverlay());
    this.restoreCoderTrainingRecoveryOverlay();

    this.loadInitialManualCodingState();
    this.loadManualCodingJobRefreshSetting();
    this.loadManualCodingApplyPermission();
    this.document.defaultView?.addEventListener('focus', this.handleWindowFocus);
  }

  ngOnDestroy(): void {
    this.discardPendingPlanningDataBundle();
    this.cancelResponseAnalysisRequest();
    this.document.defaultView?.removeEventListener('focus', this.handleWindowFocus);
    if (this.pendingCodingJobsReloadTimer) {
      clearTimeout(this.pendingCodingJobsReloadTimer);
      this.pendingCodingJobsReloadTimer = undefined;
    }
    this.destroy$.next();
    this.destroy$.complete();

    this.jobDefinitionChangeSubject.complete();
  }

  get activeManualTab(): ManualCodingTab {
    return this.visibleManualCodingTabs[this.selectedManualTabIndex()] || 'preparation';
  }

  private isResponseAnalysisTab(tab: ManualCodingTab): boolean {
    return tab === 'preparation' || tab === 'planning';
  }

  private cancelResponseAnalysisRequest(
    options: { markNotLoading?: boolean } = {}
  ): void { return this.analysis.cancelResponseAnalysisRequest(options); }

  private handOffResponseAnalysisGuardUntilComplete(): void { return this.analysis.handOffResponseAnalysisGuardUntilComplete(); }

  private stopResponseAnalysisView(): void {
    this.discardPendingPlanningDataBundle();
    this.cancelResponseAnalysisRequest();
    this.handOffResponseAnalysisGuardUntilComplete();
  }

  protected get workspaceId(): number {
    return this.appService.selectedWorkspaceId;
  }

  get visibleManualCodingTabs(): ManualCodingTab[] {
    if (this.canShowManualCompletionTab()) {
      return this.manualCodingTabs;
    }

    return this.manualCodingTabsWithoutCompletion;
  }

  protected getManualTabLabel(tab: ManualCodingTab): string {
    switch (tab) {
      case 'preparation':
        return 'Vorbereitung';
      case 'planning':
        return 'Planung';
      case 'training':
        return 'Schulung';
      case 'execution':
        return 'Durchführung';
      case 'completion':
        return 'Abschluss';
      default:
        return '';
    }
  }

  protected isManualTab(tab: ManualCodingTab): boolean {
    return this.activeManualTab === tab;
  }

  protected shouldRenderManualTab(tab: ManualCodingTab): boolean {
    return this.renderedManualTabs()[tab] || this.isManualTab(tab);
  }

  shouldRenderManualTabData(tab: ManualCodingTab): boolean {
    return this.loadedManualTabData[tab] ||
      !this.appService.selectedWorkspaceId ||
      (this.hasLoadedManualCodingJobRefreshSetting &&
        this.autoRefreshManualCodingJobs());
  }

  shouldShowManualRefreshButton(): boolean {
    return !!this.appService.selectedWorkspaceId &&
      this.hasLoadedManualCodingJobRefreshSetting &&
      (this.activeManualTab === 'planning' ||
        !this.autoRefreshManualCodingJobs());
  }

  shouldShowManualTabLoadHint(tab: ManualCodingTab): boolean {
    const tabSupportsManualLoadHint =
      tab === 'preparation' || tab === 'training' || tab === 'execution';

    return tabSupportsManualLoadHint &&
      this.isManualTab(tab) &&
      this.shouldShowManualRefreshButton() &&
      !this.shouldRenderManualTabData(tab);
  }

  shouldShowPlanningOverview(): boolean {
    return this.isManualTab('planning') &&
      this.hasPlanningDataBundleSnapshot();
  }

  onManualTabChanged(index: number): void {
    if (this.selectedManualTabIndex() === index) {
      return;
    }

    const previousTab = this.activeManualTab;
    this.selectedManualTabIndex.set(index);
    if (this.isResponseAnalysisTab(previousTab) &&
      !this.isResponseAnalysisTab(this.activeManualTab)) {
      this.stopResponseAnalysisView();
    }
    this.loadManualTabData(this.activeManualTab);
  }

  goToManualTab(tab: ManualCodingTab, sectionId?: string): void {
    const tabIndex = this.visibleManualCodingTabs.indexOf(tab);
    if (tabIndex < 0) {
      return;
    }

    if (this.selectedManualTabIndex() !== tabIndex) {
      const previousTab = this.activeManualTab;
      this.selectedManualTabIndex.set(tabIndex);
      if (this.isResponseAnalysisTab(previousTab) &&
        !this.isResponseAnalysisTab(tab)) {
        this.stopResponseAnalysisView();
      }
      this.loadManualTabData(tab);
    }

    if (sectionId) {
      setTimeout(() => this.scrollToSection(sectionId), 0);
    }
  }

  protected onExternalCodingFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      this.showError(
        this.translateService.instant(
          'coding-management-manual.errors.no-file-selected'
        )
      );
      return;
    }

    const file = input.files[0];
    if (!this.isExcelOrCsvFile(file)) {
      this.showError(
        this.translateService.instant(
          'coding-management-manual.errors.invalid-file-type'
        )
      );
      return;
    }

    this.processExternalCodingFile(file).finally(() => {
      input.value = '';
    });
  }

  private isExcelOrCsvFile(file: File): boolean {
    return (
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls') ||
      file.name.endsWith('.csv')
    );
  }

  private processExternalCodingFile(file: File): Promise<void> {
    return this.importFacade.importFile(file);
  }

  // Note: Validation functionality has been moved to the export dialog and dedicated validation results dialog

  private showError(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['success-snackbar']
    });
  }

  protected openCoderTraining(): void {
    this.editTraining.set(null);
    this.showCoderTraining.set(true);
  }

  private restoreCoderTrainingRecoveryOverlay(): void {
    const draft = this.sessionRecoveryService.peekDraft<CoderTrainingRecoveryDraft>(
      CODER_TRAINING_RECOVERY_KEY
    );
    if (!draft || draft.workspaceId !== this.appService.selectedWorkspaceId) {
      return;
    }
    if (draft.mode === 'edit' && !draft.editTraining) {
      return;
    }

    this.editTraining.set(draft.mode === 'edit' ? draft.editTraining ?? null : null);
    this.showCoderTraining.set(true);
  }

  openTrainingComparison(): void {
    const coderTrainingsListComponent = this.coderTrainingsListComponent();
    if (coderTrainingsListComponent) {
      coderTrainingsListComponent.openResultsComparison(undefined, 'between-trainings');
      return;
    }

    this.showError('Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.');
  }

  openTrainingDiscussion(): void {
    this.openTrainingWithinComparison();
  }

  openTrainingReliability(): void {
    const coderTrainings = this.getCoderTrainingsForExport();

    if (coderTrainings.length === 0) {
      this.showError('Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.');
      return;
    }

    this.dialog.open(CohensKappaStatisticsComponent, {
      width: '95vw',
      maxWidth: '1200px',
      height: '90vh',
      data: {
        excludeTrainings: false,
        availableCoderTrainings: coderTrainings
      }
    });
  }

  private openTrainingWithinComparison(): void {
    const coderTrainingsListComponent = this.coderTrainingsListComponent();
    if (coderTrainingsListComponent) {
      coderTrainingsListComponent.openResultsComparison(undefined, 'within-training');
      return;
    }

    this.showError('Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.');
  }

  openExecutionTransferCases(): void {
    if (!this.canManageManualCodingJobs()) {
      this.showError('Keine Berechtigung zum Verwalten von Kodierjobs.');
      return;
    }

    const executionCodingJobsComponent = this.getExecutionCodingJobsComponent();
    if (executionCodingJobsComponent) {
      executionCodingJobsComponent.openTransferCodingCasesDialog();
      return;
    }

    this.showError('Die Kodierjobs werden noch geladen. Bitte versuchen Sie es gleich erneut.');
  }

  openExecutionReliability(): void {
    if (!this.ensureExecutionJobDefinitionScopeReady()) {
      return;
    }

    const jobDefinitionIds = this.getJobDefinitionIds();

    this.dialog.open(CohensKappaStatisticsComponent, {
      width: '95vw',
      maxWidth: '1200px',
      height: '90vh',
      data: {
        excludeTrainings: true,
        scope: jobDefinitionIds.length ? { jobDefinitionIds } : undefined
      }
    });
  }

  protected openExecutionDoubleCodedReview(): void {
    this.openDoubleCodedReviewDialog();
  }

  protected openTrainingExport(): void {
    const coderTrainingIds = this.getCoderTrainingIds();

    if (coderTrainingIds.length === 0) {
      this.showError('Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.');
      return;
    }

    if (!this.ensureCoderScopeReady()) {
      return;
    }

    this.openManualCodingExportDialog('training');
  }

  openExecutionExport(): void {
    if (!this.ensureExecutionJobDefinitionScopeReady()) {
      return;
    }

    if (!this.ensureCoderScopeReady()) {
      return;
    }

    this.openManualCodingExportDialog('execution');
  }

  private openManualCodingExportDialog(context: 'training' | 'execution'): void {
    this.dialog.open(ManualCodingExportDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      data: {
        context,
        coders: this.coders(),
        jobDefinitions: context === 'execution' ? this.getJobDefinitionExportOptions() : undefined,
        coderTrainings: context === 'training' ? this.getCoderTrainingsForExport() : undefined
      }
    }).afterClosed()
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe((result?: ManualCodingExportDialogResult) => {
        if (!result) {
          return;
        }

        this.startManualCodingExport(context, result);
      });
  }

  private startManualCodingExport(
    context: 'training' | 'execution',
    result: ManualCodingExportDialogResult
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError('Kein Arbeitsbereich ausgewählt.');
      return;
    }

    const config = createManualCodingExportConfig(context, result, this.appService.userId, context === 'training' ? this.getCoderTrainingIds() : this.getJobDefinitionIds());
    this.exports.start(workspaceId, config, warning => this.confirmLargeExport(warning))
      .subscribe(outcome => {
        if (outcome === 'started') this.showSuccess('Exportjob wurde gestartet.');
        if (outcome === 'estimate-failed') this.showError(this.translateService.instant('manual-coding-export.worksheet-estimate-failed'));
      });
  }

  private confirmLargeExport(warning: ManualExportWorksheetWarning): Observable<ManualExportDecision> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '560px',
      data: {
        title: this.translateService.instant('manual-coding-export.too-many-worksheets-title'),
        message: this.translateService.instant('manual-coding-export.too-many-worksheets-message', warning),
        confirmButtonText: this.translateService.instant('manual-coding-export.too-many-worksheets-continue'),
        alternativeButtonText: this.translateService.instant('manual-coding-export.too-many-worksheets-compact'),
        alternativeButtonValue: 'compact',
        cancelButtonText: this.translateService.instant('cancel')
      }
    });
    return dialogRef.afterClosed().pipe(finalize(() => dialogRef.close?.()));
  }

  private getCoderTrainingIds(): number[] {
    return this.getCoderTrainingsForExport()
      .map(training => training.id)
      .filter((id): id is number => Number.isFinite(id));
  }

  private getJobDefinitionIds(): number[] {
    return this.getJobDefinitionsForManualScope()
      .map(jobDefinition => jobDefinition.id)
      .filter((id): id is number => Number.isFinite(id));
  }

  private getCoderTrainingsForExport(): CoderTraining[] {
    const coderTrainingsListComponent = this.coderTrainingsListComponent();
    return coderTrainingsListComponent?.originalData().length ?
      coderTrainingsListComponent.originalData() :
      coderTrainingsListComponent?.coderTrainings() ?? [];
  }

  private getJobDefinitionExportOptions(): { id: number; label: string }[] {
    return this.getJobDefinitionsForManualScope()
      .filter(jobDefinition => Number.isFinite(jobDefinition.id))
      .map(jobDefinition => {
        const variableCount = jobDefinition.assignedVariables?.length ?? 0;
        const bundleCount = jobDefinition.assignedVariableBundles?.length ?? 0;
        const status = jobDefinition.status ? ` (${jobDefinition.status})` : '';
        return {
          id: jobDefinition.id as number,
          label: `${getJobDefinitionDisplayLabel(jobDefinition)}${status}: ${variableCount} Variablen, ${bundleCount} Bündel`
        };
      });
  }

  private getJobDefinitionsForManualScope(): JobDefinition[] {
    return this.exportScope.getDefinitions(this.codingJobDefinitionsComponent()?.jobDefinitions());
  }

  private ensureExecutionJobDefinitionScopeReady(): boolean {
    if (this.exportScope.ensureDefinitionsReady(!!this.codingJobDefinitionsComponent())) return true;
    this.showError('Die Jobdefinitionen werden noch geladen. Bitte versuchen Sie es gleich erneut.');
    return false;
  }

  private ensureCoderScopeReady(): boolean {
    if (this.exportScope.ensureCodersReady()) return true;
    this.showError('Die Kodierer werden noch geladen. Bitte versuchen Sie es gleich erneut.');
    return false;
  }

  protected closeCoderTraining(): void {
    this.showCoderTraining.set(false);
    this.editTraining.set(null);
  }

  protected openTrainingEdit(training: CoderTraining): void {
    this.editTraining.set(training);
    this.showCoderTraining.set(true);
  }

  /**
   * Event handler for job definition changes (create, update, delete)
   * Uses debouncing to prevent excessive API calls
   */
  protected onJobDefinitionChanged(reloadScope: CodingJobsReloadScope = 'active'): void {
    this.jobDefinitionChangeSubject.next(reloadScope);
  }

  /**
   * Refreshes all statistics with individual loading states
   */
  protected refreshAllStatistics(): void {
    if (this.shouldSuppressCodingStatusChecks()) {
      this.pendingManualStateRefreshAfterBackgroundJob = true;
      return;
    }

    this.invalidateCodingStatusCache();
    this.planningData.markPlanningDataAvailable();
    this.loadCodingProgressOverview();
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadWorkspaceKappaSummary();
    this.loadCodingIncompleteVariables();
    this.loadStatusDistribution();
    this.loadStatusDistributionV2();
    this.loadCompletedJobsReadyForApply();
    this.loadManualFreshnessDecisionData();
  }

  reloadCodingJobsList(reloadScope: CodingJobsReloadScope = 'active'): void {
    const concreteReloadScopes =
      this.getConcreteCodingJobsReloadScopes(reloadScope);
    concreteReloadScopes.forEach(scope => {
      const component = this.getCodingJobsComponentForScope(scope);
      if (component) {
        component.loadCodingJobs();
        this.pendingCodingJobsReloadScopes.delete(scope);
      } else {
        this.pendingCodingJobsReloadScopes.add(scope);
      }
    });
    const coderTrainingsListComponent = this.coderTrainingsListComponent();
    if (this.shouldReloadCoderTrainings(reloadScope) &&
      coderTrainingsListComponent) {
      coderTrainingsListComponent.loadCoderTrainings();
    }
  }

  refreshManualCodingPlanning(): void {
    const activeTab = this.activeManualTab;
    if (this.shouldSuppressCodingStatusChecks()) {
      this.pendingManualStateRefreshAfterBackgroundJob = true;
      this.pendingForcedManualStateRefreshAfterBackgroundJob = true;
      if (activeTab !== 'planning') {
        this.pendingCodingFreshnessRefreshAfterBackgroundJob = true;
        this.pendingForcedCodingFreshnessRefreshAfterBackgroundJob = true;
      }
      if (this.shouldLoadManualTabWhileStatusChecksAreSuppressed(activeTab)) {
        this.loadManualTabData(activeTab, {
          forceRefresh: true,
          reloadCodingJobs: true,
          codingJobsReloadScope: 'active',
          deferStatusChecks: true
        });
      }
      return;
    }

    this.invalidateCodingStatusCache();
    this.loadManualTabData(activeTab, {
      forceRefresh: true,
      reloadCodingJobs: true,
      codingJobsReloadScope: 'active'
    });
    this.loadJobDefinitionsForExport();
    if (activeTab !== 'planning') {
      this.loadCodingFreshness({ force: true });
    }
    if (this.shouldReloadCodingJobsAfterManualTabData(activeTab)) {
      this.reloadCodingJobsList('active');
    }

    const codingJobDefinitionsComponent = this.codingJobDefinitionsComponent();
    if (codingJobDefinitionsComponent) {
      codingJobDefinitionsComponent.refresh();
    }
  }

  private shouldRefreshManualStateOnFocus(): boolean {
    return this.hasLoadedManualCodingJobRefreshSetting &&
      this.autoRefreshManualCodingJobs() &&
      (this.activeManualTab === 'execution' ||
        this.activeManualTab === 'completion');
  }

  private refreshManualStateAfterExternalChange(
    options: {
      forceCodingFreshness?: boolean;
      forceManualTabData?: boolean;
    } = {}
  ): void {
    if (this.shouldSuppressCodingStatusChecks()) {
      this.pendingManualStateRefreshAfterBackgroundJob = true;
      if (options.forceManualTabData) {
        this.pendingForcedManualStateRefreshAfterBackgroundJob = true;
      }
      if (options.forceCodingFreshness) {
        this.pendingCodingFreshnessRefreshAfterBackgroundJob = true;
        this.pendingForcedCodingFreshnessRefreshAfterBackgroundJob = true;
      }
      return;
    }

    const activeTab = this.activeManualTab;
    const loadOptions: {
      reloadCodingJobs: boolean;
      forceRefresh?: boolean;
    } = { reloadCodingJobs: false };
    if (options.forceManualTabData) {
      loadOptions.forceRefresh = true;
    }
    this.loadManualTabData(activeTab, loadOptions);
    if (activeTab !== 'planning') {
      if (options.forceCodingFreshness) {
        this.loadCodingFreshness({ force: true });
      } else {
        this.loadCodingFreshness();
      }
    }
    if (this.shouldReloadCodingJobsAfterManualTabData(activeTab)) {
      this.reloadCodingJobsList('active');
    }
  }

  private shouldSuppressCodingStatusChecks(): boolean {
    return this.codingBackgroundJobsService.isStatusCheckGuardActive(
      this.appService.selectedWorkspaceId
    );
  }

  private refreshPendingManualStatusAfterBackgroundJob(): void {
    const shouldRefreshManualState = this.pendingManualStateRefreshAfterBackgroundJob;
    const forceManualTabData = this.pendingForcedManualStateRefreshAfterBackgroundJob;
    const shouldRefreshCodingFreshness = this.pendingCodingFreshnessRefreshAfterBackgroundJob ||
      this.pendingForcedCodingFreshnessRefreshAfterBackgroundJob;
    const forceCodingFreshness = this.pendingForcedCodingFreshnessRefreshAfterBackgroundJob;
    const activeTab = this.activeManualTab;

    this.pendingManualStateRefreshAfterBackgroundJob = false;
    this.pendingForcedManualStateRefreshAfterBackgroundJob = false;
    this.pendingCodingFreshnessRefreshAfterBackgroundJob = false;
    this.pendingForcedCodingFreshnessRefreshAfterBackgroundJob = false;

    if (shouldRefreshManualState) {
      this.refreshManualStateAfterExternalChange({
        forceCodingFreshness: shouldRefreshCodingFreshness && forceCodingFreshness,
        forceManualTabData
      });
    }

    if (shouldRefreshCodingFreshness &&
      (!shouldRefreshManualState || activeTab === 'planning')) {
      this.loadCodingFreshness({ force: forceCodingFreshness });
    }
  }

  private setResponseAnalysisGuardActive(isActive: boolean): void { return this.analysis.setResponseAnalysisGuardActive(isActive); }

  private shouldSkipAutomaticManualTabLoad(
    forceRefresh: boolean,
    tab: ManualCodingTab
  ): boolean {
    if (forceRefresh || !this.appService.selectedWorkspaceId) {
      return false;
    }

    if (!this.hasLoadedManualCodingJobRefreshSetting) {
      this.pendingAutomaticManualTabLoad = tab;
      return true;
    }

    return !this.autoRefreshManualCodingJobs();
  }

  private shouldReloadCodingJobsAfterManualTabData(tab: ManualCodingTab): boolean {
    return tab === 'preparation';
  }

  private schedulePendingCodingJobsReloadForTab(tab: ManualCodingTab): void {
    const hasPendingReloadForTab = this.getCodingJobsScopeForTab(tab)
      .some(scope => this.pendingCodingJobsReloadScopes.has(scope));
    if (!hasPendingReloadForTab) {
      return;
    }

    if (this.pendingCodingJobsReloadTimer) {
      clearTimeout(this.pendingCodingJobsReloadTimer);
    }

    this.pendingCodingJobsReloadTimer = setTimeout(() => {
      this.pendingCodingJobsReloadTimer = undefined;
      this.reloadPendingCodingJobsForTab(tab);
    }, 0);
  }

  private getProductiveCodingJobsComponent(): CodingJobsComponent | undefined {
    return this.productiveCodingJobsComponent() ??
      (this.activeManualTab === 'execution' ? this.codingJobsComponent() : undefined);
  }

  private getTrainingCodingJobsComponent(): CodingJobsComponent | undefined {
    return this.trainingCodingJobsComponent() ??
      (this.activeManualTab === 'training' ? this.codingJobsComponent() : undefined);
  }

  private getExecutionCodingJobsComponent(): CodingJobsComponent | undefined {
    return this.getProductiveCodingJobsComponent();
  }

  private getConcreteCodingJobsReloadScopes(
    reloadScope: CodingJobsReloadScope
  ): ConcreteCodingJobsReloadScope[] {
    switch (reloadScope) {
      case 'productive':
        return ['productive'];
      case 'training':
        return ['training'];
      case 'rendered':
        return ['productive', 'training'];
      case 'active':
      default:
        return this.getCodingJobsScopeForTab(this.activeManualTab);
    }
  }

  private getCodingJobsScopeForTab(
    tab: ManualCodingTab
  ): ConcreteCodingJobsReloadScope[] {
    switch (tab) {
      case 'execution':
        return ['productive'];
      case 'training':
        return ['training'];
      default:
        return [];
    }
  }

  private getCodingJobsComponentForScope(
    reloadScope: ConcreteCodingJobsReloadScope
  ): CodingJobsComponent | undefined {
    return reloadScope === 'productive' ?
      this.getProductiveCodingJobsComponent() :
      this.getTrainingCodingJobsComponent();
  }

  private refreshCodingJobsAfterDataChange(
    reloadScope: CodingJobsReloadScope
  ): void {
    this.getConcreteCodingJobsReloadScopes(reloadScope)
      .forEach(scope => {
        if (this.getCodingJobsScopeForTab(this.activeManualTab).includes(scope)) {
          this.reloadCodingJobsList(scope);
          return;
        }
        this.pendingCodingJobsReloadScopes.add(scope);
      });
  }

  private reloadPendingCodingJobsForTab(tab: ManualCodingTab): void {
    this.getCodingJobsScopeForTab(tab)
      .filter(scope => this.pendingCodingJobsReloadScopes.has(scope))
      .forEach(scope => this.reloadCodingJobsList(scope));
  }

  private shouldReloadCoderTrainings(reloadScope: CodingJobsReloadScope): boolean {
    return this.getConcreteCodingJobsReloadScopes(reloadScope)
      .includes('training');
  }

  private shouldLoadManualTabWhileStatusChecksAreSuppressed(
    tab: ManualCodingTab
  ): boolean {
    return tab === 'training' || tab === 'execution';
  }

  protected isAnyPlanningDataLoading(): boolean {
    return this.isLoadingResponseAnalysis() ||
      this.isLoadingCodingProgress() ||
      this.isLoadingVariableCoverage() ||
      this.isLoadingCaseCoverage() ||
      this.isLoadingManualCodeAvailability() ||
      this.isLoadingManualCodingScopeSummary ||
      this.isLoadingCodingIncompleteVariables() ||
      this.isLoadingAppliedResultsOverview() ||
      this.isLoadingManualFreshnessJobSummary() ||
      this.isLoadingDoubleCodingConflictSummary() ||
      this.isLoadingMatchingMode();
  }

  private isPlanningStatusLoading(): boolean {
    return this.isLoadingInitialResponseAnalysisForStatus() ||
      this.isLoadingCodingProgress() ||
      this.isLoadingVariableCoverage() ||
      this.isLoadingCaseCoverage() ||
      this.isLoadingManualCodeAvailability() ||
      this.isLoadingCodingIncompleteVariables() ||
      this.isLoadingAppliedResultsOverview() ||
      this.isLoadingManualFreshnessJobSummary() ||
      this.isLoadingDoubleCodingConflictSummary() ||
      this.isLoadingMatchingMode();
  }

  private isLoadingInitialResponseAnalysisForStatus(): boolean {
    return this.isLoadingResponseAnalysis() && !this.responseAnalysis();
  }

  private hasPlanningDataBundleSnapshot(): boolean {
    return this.hasLoadedPlanningDataBundle;
  }

  private shouldWaitForPlanningDataBundle(): boolean {
    return !!this.appService.selectedWorkspaceId &&
      !this.hasPlanningDataBundleSnapshot();
  }

  private shouldRequirePlanningDataRefresh(): boolean {
    return this.activeManualTab === 'planning' &&
      this.shouldWaitForPlanningDataBundle();
  }

  protected getOpenCodingCases(): number {
    const codingProgressOverviewValue = this.codingProgressOverview();

    if (codingProgressOverviewValue) {
      return Math.max(
        0,
        codingProgressOverviewValue.totalCasesToCode -
        codingProgressOverviewValue.completedCases
      );
    }

    return this.appliedResultsOverview()?.remainingResponses || 0;
  }

  getAvailableCasesForNewJobs(): number {
    const availableCases = this.codingIncompleteVariables().reduce(
      (sum, variable) => sum + (
        variable.availableCases ??
        variable.uniqueCasesAfterAggregation ??
        variable.responseCount ??
        0
      ),
      0
    );

    if (this.caseCoverageOverview()?.effectiveUnassignedCases === 0) {
      return 0;
    }

    return availableCases;
  }

  getUnavailableCasesForNewJobs(): number {
    const totalEffectiveCases = this.codingIncompleteVariables().reduce(
      (sum, variable) => sum + this.getVariableEffectiveCaseCount(variable),
      0
    );

    return Math.max(0, totalEffectiveCases - this.getAvailableCasesForNewJobs());
  }

  protected getVariableCoveragePercentage(): number {
    return this.variableCoverageOverview()?.coveragePercentage || 0;
  }

  protected getAppliedResultsPercentage(): number {
    return this.appliedResultsOverview()?.completionPercentage || 0;
  }

  getCurrentRawManualResponses(): number {
    return this.appliedResultsOverview()?.rawTotalIncompleteResponses ??
      this.codingProgressOverview()?.rawTotalCasesToCode ??
      this.caseCoverageOverview()?.totalCasesToCode ??
      0;
  }

  getResponseAnalysisReferenceRawCases(): number {
    return this.codingProgressOverview()?.responseAnalysisRawCases ??
      this.caseCoverageOverview()?.responseAnalysisRawCases ??
      this.appliedResultsOverview()?.responseAnalysisRawCases ??
      this.getManualStatusPoolCount();
  }

  getManualStatusPoolCount(): number {
    const manualCodingScopeSummaryValue = this.manualCodingScopeSummary();

    return this.codingProgressOverview()?.statusTotalCasesToCode ??
      this.caseCoverageOverview()?.statusTotalCasesToCode ??
      this.appliedResultsOverview()?.statusTotalIncompleteResponses ??
      (manualCodingScopeSummaryValue ?
        manualCodingScopeSummaryValue.manualResponseCount +
        manualCodingScopeSummaryValue.coveredSourceResponseCount :
        0);
  }

  getEffectiveManualCaseCount(): number {
    return this.codingProgressOverview()?.totalCasesToCode ??
      this.caseCoverageOverview()?.effectiveTotalCasesToCode ??
      this.appliedResultsOverview()?.totalIncompleteResponses ??
      0;
  }

  getManualCaseScopeSummaryText(): string {
    const statusPoolCount = this.getManualStatusPoolCount();
    const effectiveCaseCount = this.getEffectiveManualCaseCount();
    const openCaseCount = this.getOpenCodingCases();

    if (
      statusPoolCount <= 0 ||
      effectiveCaseCount <= 0 ||
      statusPoolCount === effectiveCaseCount
    ) {
      return '';
    }

    const difference = statusPoolCount - effectiveCaseCount;
    const reason = difference > 0 ?
      `${difference} Rohantworten werden durch abgeleitete Variablen, Vorverarbeitung oder Aggregation nicht separat verteilt.` :
      'Die effektive Fallzahl kann durch Mehrfachkodierung oder manuelle Nacharbeit abweichen.';
    const openCaseHint = openCaseCount !== effectiveCaseCount ?
      `, davon ${openCaseCount} offen` :
      '';

    return `${statusPoolCount} Rohantworten im Statuspool -> ${effectiveCaseCount} effektive Arbeitsfälle${openCaseHint}. ${reason}`;
  }

  isResponseAnalysisOutdated(): boolean {
    const responseAnalysisSnapshot = this.responseAnalysis();

    const analysisRawCases = responseAnalysisSnapshot?.aggregationSummary?.rawCases ?? 0;
    const referenceRawCases = this.getResponseAnalysisReferenceRawCases();
    return !!responseAnalysisSnapshot &&
      !responseAnalysisSnapshot.isCalculating &&
      referenceRawCases > 0 &&
      analysisRawCases !== referenceRawCases;
  }

  hasResponseAnalysisRestScopeDifference(): boolean {
    const responseAnalysisSnapshot = this.responseAnalysis();

    const analysisRawCases = responseAnalysisSnapshot?.aggregationSummary?.rawCases ?? 0;
    const currentRawManualResponses = this.getCurrentRawManualResponses();
    return !!responseAnalysisSnapshot &&
      !responseAnalysisSnapshot.isCalculating &&
      !this.isResponseAnalysisOutdated() &&
      currentRawManualResponses > 0 &&
      analysisRawCases !== currentRawManualResponses;
  }

  private shouldLoadResponseAnalysisForPlanning(): boolean {
    const responseAnalysisSnapshot = this.responseAnalysis();

    if (!responseAnalysisSnapshot) {
      return true;
    }

    if (responseAnalysisSnapshot.isCalculating) {
      return true;
    }

    if ((responseAnalysisSnapshot.aggregationSummary?.rawCases ?? 0) === 0) {
      return true;
    }

    return this.isResponseAnalysisOutdated();
  }

  private loadResponseAnalysisForPlanningIfNeeded(): void {
    if (!this.isLoadingResponseAnalysis() && this.shouldLoadResponseAnalysisForPlanning()) {
      this.loadResponseAnalysis();
    }
  }

  scrollToSection(sectionId: string): void {
    this.document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  hasPreparationWarnings(): boolean {
    return this.hasUncodedEmptyResponses() ||
      this.hasDuplicateFindingsWithoutAggregation();
  }

  isPreparationReady(): boolean {
    const responseAnalysisSnapshot = this.responseAnalysis();

    return !!responseAnalysisSnapshot &&
      !responseAnalysisSnapshot.isCalculating &&
      !this.hasPreparationWarnings();
  }

  hasPlanningWarnings(): boolean {
    return this.hasManualCodeAvailabilityWarnings() ||
      (this.variableCoverageOverview()?.conflictedVariables || 0) > 0 ||
      (this.variableCoverageOverview()?.missingVariables || 0) > 0 ||
      (this.caseCoverageOverview()?.effectiveUnassignedCases || 0) > 0;
  }

  hasVariableCoverageConflicts(): boolean {
    return (this.variableCoverageOverview()?.conflictedVariables || 0) > 0;
  }

  isPlanningReady(): boolean {
    return !!this.variableCoverageOverview() &&
      !!this.caseCoverageOverview() &&
      !this.hasPlanningWarnings();
  }

  hasExecutionOpenWork(): boolean {
    return this.getOpenCodingCases() > 0;
  }

  private hasPreparationRefreshTarget(): boolean {
    return this.hasPreparationWarnings() ||
      this.isResponseAnalysisOutdated();
  }

  private hasActiveTrainingCodingJobs(): boolean {
    return (this.manualFreshnessJobSummary?.activeTrainingJobs ?? 0) > 0;
  }

  private hasOpenProductiveManualJobs(): boolean {
    return (this.manualFreshnessJobSummary?.openProductiveJobs ?? 0) > 0;
  }

  private hasCompletedProductiveManualJobs(): boolean {
    return (this.manualFreshnessJobSummary?.completedProductiveJobs ?? 0) > 0;
  }

  private hasStaleSourceManualJobs(): boolean {
    return (this.manualFreshnessJobSummary?.staleSourceJobs ?? 0) > 0;
  }

  private hasOpenDoubleCodingReviewConflicts(): boolean {
    return this.openDoubleCodingConflictCount > 0;
  }

  private hasManualFreshnessJobSummary(): boolean {
    return this.manualFreshnessJobSummary !== null;
  }

  private hasExecutionOpenWorkForFreshness(): boolean {
    if (this.hasManualFreshnessJobSummary()) {
      return this.hasOpenProductiveManualJobs();
    }

    return this.hasExecutionOpenWork();
  }

  private hasCompletionReadyWorkForFreshness(): boolean {
    if (this.hasManualFreshnessJobSummary()) {
      return this.hasCompletedProductiveManualJobs();
    }

    return this.hasManualCodingProgressScope() &&
      !!this.codingProgressOverview() &&
      !!this.appliedResultsOverview() &&
      !this.hasExecutionOpenWork();
  }

  isCompletionComplete(): boolean {
    return this.hasManualCodingProgressScope() &&
      this.getAppliedResultsPercentage() >= 100 &&
      this.getOpenCodingCases() === 0;
  }

  hasManualCodingProgressScope(): boolean {
    return ((this.codingProgressOverview()?.totalCasesToCode ?? 0) > 0) ||
      ((this.codingProgressOverview()?.rawTotalCasesToCode ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.totalIncompleteResponses ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.rawTotalIncompleteResponses ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.appliedResponses ?? 0) > 0) ||
      ((this.appliedResultsOverview()?.remainingResponses ?? 0) > 0);
  }

  hasCompletedJobsReadyForApply(): boolean {
    return this.completedJobsReadyForApply().length > 0;
  }

  protected hasCompletedJobsBlockedForReview(): boolean {
    return this.completedJobsBlockedForReview().length > 0;
  }

  canApplyCompletedJobResults(): boolean {
    return this.getExecutionCodingJobsComponent()?.canApplyResults() ??
      this.canApplyManualCodingResults();
  }

  canShowCompletedJobApplyActions(): boolean {
    return this.hasCompletedJobsReadyForApply() &&
      this.canApplyCompletedJobResults();
  }

  getCompletionActionTitle(): string {
    if (this.isCompletionComplete()) {
      return 'Alle Ergebnisse sind übernommen';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (this.hasCompletedJobsBlockedForReview()) {
        return `${this.completedJobsReadyForApply().length} abgeschlossene Kodierjob(s) bereit zum Anwenden, ${this.completedJobsBlockedForReview().length} mit offenen Hinweisen`;
      }
      return `${this.completedJobsReadyForApply().length} abgeschlossene Kodierjob(s) bereit zum Anwenden`;
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return `${this.completedJobsBlockedForReview().length} abgeschlossene Kodierjob(s) benötigen Review`;
    }

    if (this.hasExecutionOpenWork()) {
      return 'Noch nicht alle Kodierfälle sind abgeschlossen';
    }

    return 'Keine übernahmebereiten Kodierjobs gefunden';
  }

  protected getCompletionActionDescription(): string {
    if (this.isCompletionComplete()) {
      return 'Die manuelle Kodierung ist abgeschlossen und die Ergebnisse sind final in den Datenbestand übernommen.';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (!this.canApplyCompletedJobResults()) {
        return 'Für das Anwenden der Job-Ergebnisse ist eine höhere Berechtigung erforderlich.';
      }

      return 'Übernehmen Sie die abgeschlossenen Job-Ergebnisse hier direkt in die Antwortdaten.';
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return 'Mindestens ein abgeschlossener Job enthält Markierungen wie "Code-Vergabe unsicher" oder "Neuer Code nötig". Prüfen Sie diese Jobs vor dem Anwenden.';
    }

    if (this.hasExecutionOpenWork()) {
      return 'Schließen Sie die offenen Kodierfälle ab. Danach können die Ergebnisse hier übernommen werden.';
    }

    return 'Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs, falls Sie gerade einen Job abgeschlossen haben.';
  }

  protected getCompletionActionIcon(): string {
    if (this.isCompletionComplete()) {
      return 'task_alt';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      return 'pending_actions';
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return 'rule';
    }

    return this.hasExecutionOpenWork() ? 'edit_note' : 'sync_problem';
  }

  getCodingJobResultSummary(job: CodingJob): string {
    const totalUnits = job.totalUnits ?? 0;
    const codedUnits = job.codedUnits ?? 0;

    if (totalUnits > 0) {
      return `${codedUnits}/${totalUnits} Ergebnisse kodiert`;
    }

    return 'Kodierergebnisse vorhanden';
  }

  protected isApplyingJobResults(jobId: number): boolean {
    return this.applyingCodingResultJobIds.has(jobId);
  }

  protected applyCompletedJobResults(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('Kein Workspace ausgewählt');
      return;
    }

    if (!this.canApplyCompletedJobResults()) {
      this.showError('Keine Berechtigung zum Anwenden von Job-Ergebnissen.');
      return;
    }

    const dialogRef = this.dialog.open(ApplyCodingResultsDialogComponent, {
      width: '600px',
      data: {
        jobName: job.name,
        totalResults: job.totalUnits,
        codedResults: job.codedUnits,
        hasReviewIssues: job.hasIssues
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
      if (!dialogResult) {
        return;
      }

      this.isApplyingCodingResults.set(true);
      this.applyingCodingResultJobIds.add(job.id);
      const loadingSnack = this.snackBar.open(
        `Wende Ergebnisse für Kodierjob "${job.name}" an...`,
        '',
        { duration: 3000 }
      );

      this.codingJobBackendService
        .applyCodingResults(workspaceId, job.id, {
          overwriteExisting: dialogResult.overwriteExisting
        })
        .pipe(
          finalize(() => {
            this.applyingCodingResultJobIds.delete(job.id);
            this.isApplyingCodingResults.set(this.applyingCodingResultJobIds.size > 0);
            loadingSnack.dismiss();
          }),
          takeUntilWorkspaceChanged(this.appService),
          takeUntil(this.destroy$)
        )
        .subscribe({
          next: result => {
            if (result.success) {
              this.showSuccess(this.formatApplyCodingResultsMessage(result));
              this.refreshAfterApplyingCodingResults();
              return;
            }

            this.showError(
              `Fehler beim Anwenden der Ergebnisse: ${this.translateService.instant(
                result.messageKey,
                result.messageParams || {}
              )}`
            );
          },
          error: error => {
            this.showError(
              `Fehler beim Anwenden der Ergebnisse: ${error.message || 'Unbekannter Fehler'}`
            );
          }
        });
    });
  }

  applyAllCompletedJobResults(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('Kein Workspace ausgewählt');
      return;
    }

    if (!this.canApplyCompletedJobResults()) {
      this.showError('Keine Berechtigung zum Anwenden von Job-Ergebnissen.');
      return;
    }

    if (!this.hasCompletedJobsReadyForApply()) {
      this.showError('Keine abgeschlossenen Kodierjobs zum Anwenden gefunden.');
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: 'Alle abgeschlossenen Ergebnisse anwenden',
        message: [
          `Möchten Sie die Ergebnisse für ${this.completedJobsReadyForApply().length} abgeschlossene Kodierjob(s) anwenden?`,
          'Bei Jobs mit offenen Kodierungshinweisen werden gültige Antworten angewendet;',
          'offene Hinweise bleiben zur manuellen Prüfung bestehen.'
        ].join(' '),
        confirmButtonText: 'Anwenden',
        cancelButtonText: 'Abbrechen'
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed) {
        this.performBulkApplyCompletedJobResults(workspaceId);
      }
    });
  }

  getPlanningStatusClass(): string { return this.planning().getPlanningStatusClass(); }

  private getPlanningStatusState(): PlanningStatusState { return this.planning().getPlanningStatusState(); }

  getPlanningStatusIcon(): string { return this.planning().getPlanningStatusIcon(); }

  getPlanningStatusTitle(): string { return this.planning().getPlanningStatusTitle(); }

  getPlanningStatusDescription(): string { return this.planning().getPlanningStatusDescription(); }

  getPlanningNextStepTitle(): string { return this.planning().getPlanningNextStepTitle(); }

  getPlanningNextStepDescription(): string { return this.planning().getPlanningNextStepDescription(); }

  getPlanningNextStepActionLabel(): string { return this.planning().getPlanningNextStepActionLabel(); }

  getPlanningNextStepTargetSection(): string { return this.planning().getPlanningNextStepTargetSection(); }

  getPlanningNextStepTargetTab(): ManualCodingTab { return this.planning().getPlanningNextStepTargetTab(); }

  private getPlanningNextStepTarget(): ManualFreshnessTarget { return this.planning().getPlanningNextStepTarget(); }

  performPlanningNextStep(): void {
    const planningStatusState = this.getPlanningStatusState();
    if (planningStatusState === 'loading' ||
        planningStatusState === 'planning-data-required' ||
        planningStatusState === 'progress-unavailable') {
      this.refreshManualCodingPlanning();
      return;
    }

    this.followManualFreshnessTarget();
  }

  protected getPlanningNextStepIcon(): string { return this.planning().getPlanningNextStepIcon(); }

  get codingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    const warnings = this.allCodingFreshnessWarnings();
    if (this.isCompletionComplete()) {
      return warnings;
    }

    return warnings.filter(item => item.version !== 'v3');
  }

  private readonly allCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => (this.codingFreshnessSummary()?.items || [])
    .filter(isCodingFreshnessOpenWarning)
    .sort((a, b) => (
      a.version.localeCompare(b.version) ||
        a.state.localeCompare(b.state)
    )));

  get hasCodingFreshnessWarnings(): boolean {
    return this.codingFreshnessWarnings.length > 0;
  }

  readonly manualCodeAvailabilityWarningCount = computed<number>(() => this.manualCodeAvailabilityWarnings().length);

  readonly hasManualCodeAvailabilityWarnings = computed<boolean>(() => this.manualCodeAvailabilityWarningCount() > 0);

  protected readonly hiddenManualCodeAvailabilityWarningCount = computed<number>(() => Math.max(
    0,
    this.manualCodeAvailabilityWarningCount() -
        this.manualCodeAvailabilityPreviewLimit
  ));

  protected readonly hasHiddenManualCodeAvailabilityWarnings = computed<boolean>(() => this.hiddenManualCodeAvailabilityWarningCount() > 0);

  getManualCodeAvailabilityPreview(): ManualCodeAvailabilityWarningDto[] {
    return this.manualCodeAvailabilityWarnings().slice(
      0,
      this.manualCodeAvailabilityPreviewLimit
    );
  }

  protected getVisibleManualCodeAvailabilityWarnings(): ManualCodeAvailabilityWarningDto[] {
    return this.showAllManualCodeAvailabilityWarnings() ?
      this.manualCodeAvailabilityWarnings() :
      this.getManualCodeAvailabilityPreview();
  }

  protected toggleManualCodeAvailabilityWarnings(): void {
    this.statistics.toggleManualCodeAvailabilityWarnings();
  }

  get autoCodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return getCodingFreshnessAutoCodingWarnings(this.codingFreshnessWarnings);
  }

  get manualCodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return getCodingFreshnessManualReviewWarnings(this.codingFreshnessWarnings);
  }

  get manualCodingFreshnessPanelTitle(): string {
    if (this.hasOnlySecondAutocodingWarnings) {
      return this.translateService.instant(
        'coding-management-manual.freshness.second-autocoding-ready-title'
      );
    }

    return getCodingFreshnessAttentionTitle(this.codingFreshnessWarnings);
  }

  get manualCodingFreshnessSummaryText(): string {
    if (this.hasOnlySecondAutocodingWarnings) {
      const taskResults = formatCodingFreshnessTaskResultCount(
        getCodingFreshnessAffectedTaskResultCount(this.codingFreshnessWarnings)
      );
      const responses = formatCodingFreshnessResponseCount(
        getCodingFreshnessAffectedResponseCount(this.codingFreshnessWarnings)
      );

      return this.translateService.instant(
        'coding-management-manual.freshness.second-autocoding-ready-summary',
        {
          taskResults,
          responses
        }
      );
    }

    return getCodingFreshnessSummaryText(this.codingFreshnessWarnings);
  }

  get manualCodingFreshnessExplanationText(): string {
    if (this.hasOnlySecondAutocodingWarnings) {
      return this.translateService.instant(
        'coding-management-manual.freshness.second-autocoding-ready-help',
        {
          taskResultHelp: CODING_FRESHNESS_TASK_RESULT_HELP
        }
      );
    }

    const guidanceText = getCodingFreshnessManualReviewGuidanceText(
      this.codingFreshnessWarnings
    );
    if (guidanceText) {
      return `${guidanceText} ${CODING_FRESHNESS_TASK_RESULT_HELP}`;
    }

    return CODING_FRESHNESS_TASK_RESULT_HELP;
  }

  getManualFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
    return getCodingFreshnessChipLabel(item);
  }

  private get hasOnlySecondAutocodingWarnings(): boolean {
    return this.codingFreshnessWarnings.length > 0 &&
      this.codingFreshnessWarnings.every(item => item.version === 'v3');
  }

  private refreshAggregationDependentViews(includeResponseAnalysis = true): void {
    this.invalidateCodingStatusCache();
    this.planningData.markPlanningDataAvailable();
    if (includeResponseAnalysis) {
      this.loadResponseAnalysis();
    }
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadCodingProgressOverview();
    this.loadCodingIncompleteVariables();
    this.loadStatusDistributionV2();
    this.refreshCodingJobsAfterDataChange('rendered');
    this.loadJobDefinitionsForExport();

    const codingJobDefinitionsComponent = this.codingJobDefinitionsComponent();
    if (codingJobDefinitionsComponent) {
      codingJobDefinitionsComponent.refresh();
    }
  }

  private loadInitialManualCodingState(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) this.loadDefaultEmptyResponseMissing(workspaceId);
    this.settings.loadInitialSettings();
  }

  private loadManualTabData(
    tab: ManualCodingTab,
    options: {
      reloadCodingJobs?: boolean;
      codingJobsReloadScope?: CodingJobsReloadScope;
      forceRefresh?: boolean;
      deferStatusChecks?: boolean;
    } = {}
  ): void {
    if (!this.isManualTabAvailable(tab)) {
      return;
    }

    this.renderedManualTabs.update(value => ({ ...value, [tab]: true }));
    const reloadCodingJobs = options.reloadCodingJobs ?? false;
    const codingJobsReloadScope = options.codingJobsReloadScope ?? 'active';
    const forceRefresh = options.forceRefresh ?? false;
    const deferStatusChecks = options.deferStatusChecks ?? false;
    const hasPlanningDataSnapshot = !forceRefresh &&
      this.restorePlanningDataBundleSnapshot();
    const canUsePlanningDataSnapshot =
      tab === 'preparation' || tab === 'planning';
    if (this.shouldSkipAutomaticManualTabLoad(forceRefresh, tab) &&
      !(hasPlanningDataSnapshot && canUsePlanningDataSnapshot)) {
      return;
    }

    this.loadedManualTabData[tab] = true;

    switch (tab) {
      case 'preparation':
        if (!hasPlanningDataSnapshot) {
          this.loadResponseAnalysis();
        }
        return;
      case 'planning':
        if (!hasPlanningDataSnapshot && !deferStatusChecks &&
          (forceRefresh || this.autoRefreshManualCodingJobs())) {
          this.loadPlanningDataBundle(forceRefresh);
        }
        return;
      case 'training':
        if (reloadCodingJobs) {
          this.reloadCodingJobsList(codingJobsReloadScope);
          this.schedulePendingCodingJobsReloadForTab(tab);
        } else {
          this.reloadPendingCodingJobsForTab(tab);
        }
        return;
      case 'execution':
        if (!deferStatusChecks) {
          this.loadCodingProgressOverview();
          this.loadCaseCoverageOverview();
          this.loadWorkspaceKappaSummary();
        }
        if (reloadCodingJobs) {
          this.reloadCodingJobsList(codingJobsReloadScope);
          this.schedulePendingCodingJobsReloadForTab(tab);
        } else {
          this.reloadPendingCodingJobsForTab(tab);
        }
        return;
      case 'completion':
        this.loadCodingIncompleteVariables();
        this.loadCompletedJobsReadyForApply();
        return;
      default:
        this.refreshAllStatistics();
    }
  }

  private loadPlanningDataBundle(forceRefresh: boolean): void { return this.planningData.loadPlanningDataBundle(forceRefresh); }

  private restorePlanningDataBundleSnapshot(): boolean { return this.planningData.restorePlanningDataBundleSnapshot(); }

  private trySavePlanningDataBundleSnapshot(): void { return this.planningData.trySavePlanningDataBundleSnapshot(); }

  private discardPendingPlanningDataBundle(): void { return this.planningData.discardPendingPlanningDataBundle(); }

  private loadManualCodingJobRefreshSetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.hasLoadedManualCodingJobRefreshSetting = true;
      this.autoRefreshManualCodingJobs.set(true);
      return;
    }

    this.workspaceSettingsService
      .getAutoRefreshManualCodingJobs(workspaceId)
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe({
        next: enabled => {
          this.hasLoadedManualCodingJobRefreshSetting = true;
          this.autoRefreshManualCodingJobs.set(enabled);

          if (enabled) {
            const pendingTab = this.pendingAutomaticManualTabLoad;
            this.pendingAutomaticManualTabLoad = null;
            if (pendingTab) {
              this.loadManualTabData(pendingTab);
            } else if (this.activeManualTab !== 'planning') {
              this.loadCodingFreshness();
            }
          } else {
            this.pendingAutomaticManualTabLoad = null;
          }
        },
        error: () => {
          this.hasLoadedManualCodingJobRefreshSetting = true;
          this.autoRefreshManualCodingJobs.set(true);

          const pendingTab = this.pendingAutomaticManualTabLoad;
          this.pendingAutomaticManualTabLoad = null;
          if (pendingTab) {
            this.loadManualTabData(pendingTab);
          } else if (this.activeManualTab !== 'planning') {
            this.loadCodingFreshness();
          }
        }
      });
  }

  private loadManualCodingApplyPermission(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const userId = this.appService.authData.userId;

    if (this.appService.authData.isAdmin || !workspaceId || userId <= 0) {
      const activeTab = this.activeManualTab;
      this.canApplyManualCodingResults.set(this.appService.authData.isAdmin === true);
      this.canManageManualCodingJobs.set(this.appService.authData.isAdmin === true);
      this.keepAvailableManualTabSelected(activeTab);
      this.requestManualFreshnessFocusIfNeeded();
      return;
    }

    this.userBackendService
      .getUsers(workspaceId)
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe({
        next: users => {
          const activeTab = this.activeManualTab;
          const currentUser = users.find(user => user.id === userId);
          const accessLevel = currentUser?.accessLevel ?? 0;
          this.canManageManualCodingJobs.set(accessLevel >= 2);
          this.canApplyManualCodingResults.set(accessLevel >= 3);
          this.keepAvailableManualTabSelected(activeTab);
          this.requestManualFreshnessFocusIfNeeded();
        },
        error: () => {
          const activeTab = this.activeManualTab;
          this.canManageManualCodingJobs.set(false);
          this.canApplyManualCodingResults.set(false);
          this.keepAvailableManualTabSelected(activeTab);
          this.requestManualFreshnessFocusIfNeeded();
        }
      });
  }

  private canShowManualCompletionTab(): boolean {
    return this.canApplyManualCodingResults();
  }

  private isManualTabAvailable(tab: ManualCodingTab): boolean {
    return this.visibleManualCodingTabs.includes(tab);
  }

  private keepAvailableManualTabSelected(previousActiveTab: ManualCodingTab): void {
    if (this.isManualTabAvailable(previousActiveTab)) {
      this.selectedManualTabIndex.set(this.visibleManualCodingTabs.indexOf(previousActiveTab));
      return;
    }

    const executionTabIndex = this.visibleManualCodingTabs.indexOf('execution');
    this.selectedManualTabIndex.set(executionTabIndex >= 0 ? executionTabIndex : 0);
    this.loadManualTabData(this.activeManualTab);
  }

  private requestManualFreshnessFocusIfNeeded(): void {
    if (!this.pendingManualFreshnessFocus || this.manualFreshnessPlanningRequested) {
      return;
    }

    this.manualFreshnessPlanningRequested = true;
    this.goToManualTab('planning');
    this.focusManualFreshnessTargetIfReady();
  }

  private focusManualFreshnessTargetIfReady(): void {
    if (!this.pendingManualFreshnessFocus ||
        !this.manualFreshnessPlanningRequested ||
        this.isAnyPlanningDataLoading() ||
        this.shouldWaitForPlanningDataBundle()) {
      return;
    }

    this.pendingManualFreshnessFocus = false;
    this.followManualFreshnessTarget();
  }

  private followManualFreshnessTarget(): void {
    const target = this.getPlanningNextStepTarget();
    this.goToManualTab(target.tab, target.sectionId);

    if (target.action === 'double-coding-review') {
      const workspaceId = this.appService.selectedWorkspaceId;
      setTimeout(() => {
        if (!this.destroyRef.destroyed && workspaceId === this.appService.selectedWorkspaceId) this.openDoubleCodedReviewDialog();
      }, 0);
    }
  }

  private openDoubleCodedReviewDialog(): void {
    const dialogRef = this.dialog.open(DoubleCodedReviewComponent, {
      width: '98vw',
      maxWidth: '100vw',
      height: '95vh',
      maxHeight: '100vh',
      data: { canApplyResults: this.canApplyManualCodingResults() }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result?.resultsApplied) {
        this.refreshAllStatistics();
        this.refreshCodingJobsAfterDataChange('productive');
      }
    });
  }

  private loadJobDefinitionsForExport(): void {
    this.exportScope.loadJobDefinitionsForExport();
  }

  private loadCodersForExport(): void {
    this.exportScope.loadCodersForExport();
  }

  private loadDefaultEmptyResponseMissing(workspaceId: number): void {
    this.emptyResponseMissing.set(null);
    this.missingsProfileService
      .getMissingsProfileDetails(workspaceId, 'IQB-Standard')
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe({
        next: profile => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          const missing = this.toMissingProfileDto(profile)?.parseMissings()
            .find(entry => entry.id === 'mir');
          if (!missing || !Number.isInteger(Number(missing.code)) || !this.hasExplicitScoreProperty(missing) || !this.hasExplicitValidScore(missing.score)) {
            this.emptyResponseMissing.set(null);
            return;
          }

          this.emptyResponseMissing.set({
            code: Number(missing.code),
            score: this.normalizeScore(missing.score)
          });
        },
        error: () => {
          this.emptyResponseMissing.set(null);
        }
      });
  }

  private toMissingProfileDto(profile: MissingsProfilesDto | null): MissingsProfilesDto | null {
    return profile ? Object.assign(new MissingsProfilesDto(), profile) : null;
  }

  private hasExplicitScoreProperty(missing: MissingDto): boolean {
    return Object.prototype.hasOwnProperty.call(missing, 'score');
  }

  private hasExplicitValidScore(score: unknown): boolean {
    if (score === null) {
      return true;
    }

    if (typeof score === 'number') {
      return Number.isFinite(score);
    }

    if (typeof score === 'string') {
      const trimmedScore = score.trim();
      return trimmedScore !== '' && Number.isFinite(Number(trimmedScore));
    }

    return false;
  }

  private normalizeScore(score: unknown): number | null {
    if (score === null) {
      return null;
    }

    return Number(score);
  }

  protected getApplyEmptyResponseCodingTooltip(): string {
    const emptyResponseMissingSnapshot = this.emptyResponseMissing();

    if (!emptyResponseMissingSnapshot) {
      return this.translateService.instant(
        'coding-management-manual.response-analysis.apply-empty-coding-tooltip-loading'
      );
    }

    return this.translateService.instant(
      'coding-management-manual.response-analysis.apply-empty-coding-tooltip',
      {
        ...emptyResponseMissingSnapshot,
        score: this.getScoreDisplay(emptyResponseMissingSnapshot.score)
      }
    );
  }

  getScoreDisplay(score: number | null): string | number {
    return score === null ? 'NA' : score;
  }

  private loadCodingFreshness(
    options: { force?: boolean; invalidateCache?: boolean } = {}
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.statistics.cancelFreshness(true);
      return;
    }

    if (!options.force && !this.hasLoadedManualCodingJobRefreshSetting) {
      this.statistics.cancelFreshness();
      return;
    }

    if (!options.force && !this.autoRefreshManualCodingJobs()) {
      this.statistics.cancelFreshness();
      return;
    }

    if (this.shouldSuppressCodingStatusChecks()) {
      this.pendingCodingFreshnessRefreshAfterBackgroundJob = true;
      if (options.force) {
        this.pendingForcedCodingFreshnessRefreshAfterBackgroundJob = true;
      }
      this.statistics.cancelFreshness();
      return;
    }

    if (options.force && options.invalidateCache !== false) {
      this.testPersonCodingService.invalidateCodingStatusCache(workspaceId);
    }

    this.statistics.loadCodingFreshness(options.force);
  }

  navigateToCodingManagementOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.router.navigate([`/workspace-admin/${workspaceId}/coding/management`]);
  }

  private loadCodingProgressOverview(): void { return this.statistics.loadCodingProgressOverview(); }

  private loadManualFreshnessDecisionData(): void { return this.statistics.loadManualFreshnessDecisionData(); }

  private buildManualFreshnessJobSummary(jobs: CodingJob[]): ManualFreshnessJobSummary { return buildManualFreshnessJobSummary(jobs); }

  private isTrainingCodingJob(job: CodingJob): boolean { return isTrainingCodingJob(job); }

  private isActiveCodingJob(job: CodingJob): boolean { return isActiveCodingJob(job); }

  private isCompletedManualCodingJob(job: CodingJob): boolean { return isCompletedManualCodingJob(job); }

  private loadVariableCoverageOverview(): void { return this.statistics.loadVariableCoverageOverview(); }

  private loadCaseCoverageOverview(): void { return this.statistics.loadCaseCoverageOverview(); }

  private loadWorkspaceKappaSummary(): void { return this.statistics.loadWorkspaceKappaSummary(); }

  private loadCodingIncompleteVariables(): void { return this.statistics.loadCodingIncompleteVariables(); }

  private loadStatusDistribution(): void { return this.statistics.loadStatusDistribution(); }

  private loadStatusDistributionV2(): void { return this.statistics.loadStatusDistributionV2(); }

  private loadCompletedJobsReadyForApply(): void { return this.statistics.loadCompletedJobsReadyForApply(); }

  private hasBlockingCodingIssues(progress?: Record<string, unknown>): boolean { return hasBlockingCodingIssues(progress); }

  private hasCodingIssuesForCompletedJob(
    job: CodingJob,
    progress?: Record<string, unknown>
  ): boolean { return hasCodingIssuesForCompletedJob(job, progress); }

  private isCodingJobReadyForApply(job: CodingJob): boolean { return isCodingJobReadyForApply(job); }

  private performBulkApplyCompletedJobResults(workspaceId: number): void {
    this.isApplyingCodingResults.set(true);
    const loadingSnack = this.snackBar.open(
      'Wende Ergebnisse für alle abgeschlossenen Kodierjobs an...',
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService
      .bulkApplyCodingResults(workspaceId)
      .pipe(
        finalize(() => {
          this.isApplyingCodingResults.set(false);
          loadingSnack.dismiss();
        }),
        takeUntilWorkspaceChanged(this.appService),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: result => {
          if (result.success) {
            this.showSuccess(this.formatBulkApplyCodingResultsMessage(result));
            this.refreshAfterApplyingCodingResults();
            return;
          }

          this.showError(`Fehler bei der Massenanwendung: ${result.message}`);
        },
        error: error => {
          this.showError(
            `Fehler bei der Massenanwendung: ${error.message || 'Unbekannter Fehler'}`
          );
        }
      });
  }

  private refreshAfterApplyingCodingResults(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.testPersonCodingService.notifyTestResultsChanged({
        workspaceId,
        statisticsVersion: 'v2'
      });
    }
    this.refreshAllStatistics();
    this.loadResponseAnalysis();
    this.loadCodingFreshness({ force: true });
    this.refreshCodingJobsAfterDataChange('productive');
  }

  private invalidateCodingStatusCache(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.testPersonCodingService.invalidateCodingStatusCache(workspaceId);
    }
    this.resetPlanningDataBundleState();
  }

  private resetPlanningDataBundleState(): void { return this.planningData.resetPlanningDataBundleState(); }

  private formatApplyCodingResultsMessage(
    result: ApplyCodingResultsResponse
  ): string {
    const parts = [
      `Ergebnisse erfolgreich angewendet: ${result.updatedResponsesCount} Antworten aktualisiert`
    ];

    if (result.skippedAlreadyCodedCount > 0) {
      parts.push(
        `Bereits vorhandene Kodierungen nicht überschrieben: ${result.skippedAlreadyCodedCount} Antworten`
      );
    }

    if (result.overwrittenExistingCount > 0) {
      parts.push(
        `Vorhandene Kodierungen überschrieben: ${result.overwrittenExistingCount} Antworten`
      );
    }

    if (result.skippedReviewCount > 0) {
      parts.push(
        `Übersprungen (manuelle Prüfung benötigt): ${result.skippedReviewCount} Antworten`
      );
    }

    return parts.join('\n');
  }

  private formatBulkApplyCodingResultsMessage(
    result: BulkApplyCodingResultsResponse
  ): string {
    const skippedCount = result.results.filter(item => item.skipped).length;
    const failedCount = result.results.filter(
      item => item.result && !item.result.success
    ).length;
    const parts = [
      `Massenanwendung abgeschlossen: ${result.jobsProcessed} Jobs verarbeitet`,
      `${result.totalUpdatedResponses} Antworten aktualisiert`
    ];

    if (result.totalSkippedAlreadyCoded > 0) {
      parts.push(
        `${result.totalSkippedAlreadyCoded} vorhandene Kodierungen beibehalten`
      );
    }

    if (result.totalOverwrittenExisting > 0) {
      parts.push(
        `${result.totalOverwrittenExisting} vorhandene Kodierungen überschrieben`
      );
    }

    if (result.totalSkippedReview > 0) {
      parts.push(
        `${result.totalSkippedReview} Ergebnisse zur manuellen Prüfung übersprungen`
      );
    }

    if (skippedCount > 0) {
      parts.push(`${skippedCount} Jobs übersprungen`);
    }

    if (failedCount > 0) {
      parts.push(`${failedCount} Jobs mit Konflikten/Fehlern nicht angewendet`);
    }

    return parts.join(', ');
  }

  protected onTrainingStart(data: {
    selectedCoders: Coder[];
    variableConfigs: VariableConfig[];
  }): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.testPersonCodingService
      .generateCoderTrainingPackages(
        workspaceId,
        data.selectedCoders,
        data.variableConfigs
      )
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe({
        next: packages => {
          const totalResponses = packages.reduce(
            (total: number, pkg: { responses: unknown[] }) => total + pkg.responses.length,
            0
          );

          this.showSuccess(
            `Schulung erfolgreich generiert: ${packages.length} Kodierer-Pakete mit insgesamt ${totalResponses} Antworten erstellt`
          );
          this.closeCoderTraining();
          this.refreshAllStatistics();
          this.refreshCodingJobsAfterDataChange('training');
        },
        error: () => {
          this.showError('Fehler beim Generieren der Kodierer-Schulungspakete');
        }
      });
  }

  /**
   * Returns the effective number of coding cases needed, accounting for aggregated groups.
   * When aggregation is applied, each group only needs one coding case (the rest are auto-applied),
   * so the effective count is: totalIncompleteResponses - (totalResponsesInGroups - numberOfGroups)
   */
  protected readonly effectiveCodingCases = computed<number>(() => this.appliedResultsOverview()?.totalIncompleteResponses ?? 0);

  protected readonly aggregationSavings = computed<number>(() => this.appliedResultsOverview()?.aggregatedDuplicateCases ?? 0);

  readonly hasDeriveErrorManualCases = computed<boolean>(() => (this.appliedResultsOverview()?.deriveErrorRawTotalResponses ?? 0) > 0 ||
      (this.appliedResultsOverview()?.deriveErrorTotalResponses ?? 0) > 0);

  readonly deriveErrorManualCases = computed<number>(() => this.appliedResultsOverview()?.deriveErrorTotalResponses ?? 0);

  readonly deriveErrorAppliedCases = computed<number>(() => this.appliedResultsOverview()?.deriveErrorAppliedResponses ?? 0);

  readonly deriveErrorRemainingCases = computed<number>(() => this.appliedResultsOverview()?.deriveErrorRemainingResponses ?? 0);

  protected get isDuplicateAggregationActive(): boolean {
    return !this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION);
  }

  protected readonly responseAnalysisAggregationSavings = computed<number>(() => this.responseAnalysis()?.aggregationSummary?.collapsedCases ?? 0);

  readonly hasDuplicateFindingsWithoutAggregation = computed<boolean>(() => {
    const responseAnalysisValue = this.responseAnalysis();

    return !!responseAnalysisValue &&
      !responseAnalysisValue.aggregationSummary.aggregationActive &&
      responseAnalysisValue.duplicateValues.total > 0;
  });

  protected getVariableEffectiveCaseCount(variable: {
    responseCount: number;
    uniqueCasesAfterAggregation?: number;
  }): number {
    return variable.uniqueCasesAfterAggregation ?? variable.responseCount;
  }

  protected readonly effectiveSingleCodedCases = computed<number>(() => {
    const caseCoverageOverviewValue = this.caseCoverageOverview();

    if (!caseCoverageOverviewValue) {
      return 0;
    }

    return Math.max(
      0,
      caseCoverageOverviewValue.effectiveCasesInJobs -
      caseCoverageOverviewValue.doubleCodedCases
    );
  });

  protected getStatusLabel(status: string): string {
    switch (status) {
      case 'draft':
        return 'Entwurf';
      case 'pending_review':
        return 'Warten auf Genehmigung';
      case 'approved':
        return 'Genehmigt';
      default:
        return status;
    }
  }

  protected getJobDefinitionIdentityLabel(definition: { id: number; name?: string }): string {
    return getJobDefinitionDisplayLabel(definition);
  }

  protected hasMatchingFlag(flag: ResponseMatchingFlag): boolean { return this.aggregation.hasMatchingFlag(flag); }

  protected hasUnsavedResponseMatchingChanges(): boolean { return this.aggregation.hasUnsavedResponseMatchingChanges(); }

  hasPendingAggregationOptionsWithoutAggregation(): boolean { return this.aggregation.hasPendingAggregationOptionsWithoutAggregation(); }

  onAggregationModeChanged(aggregateResponses: boolean): void { return this.aggregation.onAggregationModeChanged(aggregateResponses); }

  toggleMatchingFlag(flag: ResponseMatchingFlag): void { return this.aggregation.toggleMatchingFlag(flag); }

  loadResponseAnalysis(): void { return this.analysis.loadResponseAnalysis(); }

  protected restartAnalysis(rollbackResponseMatchingFlags?: ResponseMatchingFlag[]): void { return this.aggregation.restartAnalysis(rollbackResponseMatchingFlags); }

  refreshResponseAnalysis(): void {
    this.loadResponseAnalysis();
  }

  protected toggleEmptyResponsesDetails(): void {
    this.showEmptyResponsesDetails.set(!this.showEmptyResponsesDetails());
  }

  protected toggleDuplicateValuesDetails(): void {
    this.showDuplicateValuesDetails.set(!this.showDuplicateValuesDetails());
  }

  protected onApplyEmptyResponseCoding(): void { return this.aggregation.onApplyEmptyResponseCoding(this.canApplyCompletedJobResults(), this.emptyResponseMissing()); }

  onApplyDuplicateAggregation(): void { return this.aggregation.onApplyDuplicateAggregation(); }

  onDeactivateDuplicateAggregation(): void { return this.aggregation.onDeactivateDuplicateAggregation(); }

  onThresholdChanged(newValue: number | string | null): void { return this.aggregation.onThresholdChanged(newValue); }

  protected onEmptyPageChange(event: PageEvent): void {
    this.analysis.changeEmptyPage(event.pageIndex, event.pageSize);
    this.loadResponseAnalysis();
  }

  protected onDuplicatePageChange(event: PageEvent): void {
    this.analysis.changeDuplicatePage(event.pageIndex, event.pageSize);
    this.loadResponseAnalysis();
  }

  protected hasUncodedEmptyResponses(): boolean {
    return (this.responseAnalysis()?.emptyResponses?.totalUncoded || 0) > 0;
  }

  protected getUncodedCount(): number {
    return this.responseAnalysis()?.emptyResponses?.totalUncoded || 0;
  }
}
