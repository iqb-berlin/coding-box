import {
  Component, OnDestroy, OnInit, inject, ViewChild
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  Subject,
  takeUntil,
  debounceTime,
  finalize,
  Observable,
  of,
  tap,
  distinctUntilChanged,
  firstValueFrom,
  map,
  switchMap
} from 'rxjs';
import * as ExcelJS from 'exceljs';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent, MatPaginatorModule } from '@angular/material/paginator';
import { MatTabsModule } from '@angular/material/tabs';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { CodingJobDefinitionsComponent } from '../coding-job-definitions/coding-job-definitions.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';
import {
  CoderTrainingComponent,
  VariableConfig
} from '../coder-training/coder-training.component';
import { CoderTrainingsListComponent } from '../coder-trainings-list/coder-trainings-list.component';
import { CoderTraining } from '../../models/coder-training.model';
import {
  ImportComparisonDialogComponent,
  ImportComparisonData
} from '../import-comparison-dialog/import-comparison-dialog.component';
import {
  CodingImportDetectedFormat,
  CodingImportFormatDialogComponent,
  CodingImportFormatDialogData,
  CodingImportFormatDialogResult
} from './coding-import-format-dialog.component';
import { ApplyEmptyCodingDialogComponent } from './apply-empty-coding-dialog.component';
import {
  ApplyDuplicateAggregationDialogComponent,
  ApplyDuplicateAggregationDialogData
} from './apply-duplicate-aggregation-dialog.component';
import {
  ApplyCodingResultsDialogComponent,
  ApplyCodingResultsDialogResult
} from '../coding-jobs/apply-coding-results-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { Coder } from '../../models/coder.model';
import { CodingJob } from '../../models/coding-job.model';
import {
  AppliedResultsOverview,
  CaseCoverageOverview,
  CodingProgressOverview,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';
import { AppService } from '../../../core/services/app.service';
import {
  ApplyCodingResultsResponse,
  BulkApplyCodingResultsResponse,
  CodingJobBackendService,
  JobDefinition,
  ManualCodingScopeSummary
} from '../../services/coding-job-backend.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';
import {
  ResponseMatchingFlag,
  WorkspaceSettingsService
} from '../../../ws-admin/services/workspace-settings.service';
import { CodingStatistics } from '../../../../../../../api-dto/coding/coding-statistics';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';
import {
  CodingFreshnessSummaryDto,
  CodingFreshnessSummaryItemDto
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import type { ManualCodeAvailabilityWarningDto } from '../../../../../../../api-dto/coding/manual-code-availability.dto';
import {
  MissingDto,
  MissingsProfilesDto
} from '../../../../../../../api-dto/coding/missings-profiles.dto';
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
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import {
  ExportJobConfig,
  ExportJobService,
  isReplayAuthTokenError
} from '../../../shared/services/file/export-job.service';
import { CoderService } from '../../services/coder.service';
import {
  ManualCodingExportDialogComponent,
  ManualCodingExportDialogResult
} from '../manual-coding-export-dialog/manual-coding-export-dialog.component';
import { CohensKappaStatisticsComponent } from '../cohens-kappa-statistics/cohens-kappa-statistics.component';
import { DoubleCodedReviewComponent } from '../double-coded-review/double-coded-review.component';

interface SavedCodeProgress {
  id?: number;
  codingIssueOption?: number;
  [key: string]: unknown;
}

type PlanningStatusState =
  | 'loading'
  | 'preparation-required'
  | 'warning'
  | 'planning-incomplete'
  | 'planning-ready'
  | 'training-ready'
  | 'execution-ready'
  | 'double-coding-review-ready'
  | 'stale-source-review'
  | 'completion-ready'
  | 'progress-unavailable'
  | 'complete';

type ManualCodingTab =
  'preparation' | 'planning' | 'training' | 'execution' | 'completion';

interface ResponseAnalysisLoadOptions {
  force?: boolean;
}

interface ManualFreshnessJobSummary {
  activeTrainingJobs: number;
  openProductiveJobs: number;
  completedProductiveJobs: number;
  staleSourceJobs: number;
}

interface ManualFreshnessTarget {
  tab: ManualCodingTab;
  sectionId: string;
  action: 'navigate' | 'double-coding-review';
}

@Component({
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  standalone: true,
  imports: [
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
  @ViewChild('productiveCodingJobs')
    productiveCodingJobsComponent?: CodingJobsComponent;

  @ViewChild('trainingCodingJobs')
    trainingCodingJobsComponent?: CodingJobsComponent;

  @ViewChild(CodingJobDefinitionsComponent)
    codingJobDefinitionsComponent?: CodingJobDefinitionsComponent;

  @ViewChild(CoderTrainingsListComponent)
    coderTrainingsListComponent?: CoderTrainingsListComponent;

  private testPersonCodingService = inject(TestPersonCodingService);
  private codingJobBackendService = inject(CodingJobBackendService);
  private missingsProfileService = inject(MissingsProfileService);
  private statisticsService = inject(CodingStatisticsService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private validationStateService = inject(ValidationStateService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private userBackendService = inject(UserBackendService);
  private coderService = inject(CoderService);
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private document = inject(DOCUMENT);
  private destroy$ = new Subject<void>();

  validationProgress: ValidationProgress | null = null;
  isLoading = false;
  autoRefreshManualCodingJobs = true;
  canApplyManualCodingResults = false;
  canManageManualCodingJobs = false;
  selectedManualTabIndex = 0;
  readonly manualCodingTabs: ManualCodingTab[] = [
    'preparation',
    'planning',
    'training',
    'execution',
    'completion'
  ];

  private readonly manualCodingTabsWithoutCompletion: ManualCodingTab[] = [
    'preparation',
    'planning',
    'training',
    'execution'
  ];

  // Granular loading states
  isLoadingVariableCoverage = false;
  isLoadingCaseCoverage = false;
  isLoadingCodingProgress = false;
  isLoadingManualCodeAvailability = false;
  isLoadingCodingIncompleteVariables = false;
  isLoadingAppliedResultsOverview = false;
  isLoadingKappaSummary = false;

  // Response matching mode configuration
  responseMatchingFlags: ResponseMatchingFlag[] = [];
  private persistedResponseMatchingFlags: ResponseMatchingFlag[] = [];
  private readonly aggregationOptionFlags = [
    ResponseMatchingFlag.IGNORE_CASE,
    ResponseMatchingFlag.IGNORE_WHITESPACE
  ];

  isLoadingMatchingMode = false;
  isSavingMatchingMode = false;
  ResponseMatchingFlag = ResponseMatchingFlag; // Expose enum to template

  // Response analysis data
  responseAnalysis: ResponseAnalysisDto | null = null;
  responseAnalysisError: string | null = null;

  isLoadingResponseAnalysis = false;
  showEmptyResponsesDetails = false;
  showDuplicateValuesDetails = false;
  isApplyingEmptyCoding = false;
  showProgressInfo = false;
  showTotalDetails = false;
  showVariableCoverageInfo = false;
  showCaseCoverageInfo = false;
  showAppliedResultsInfo = false;
  showVariableBundlesInfo = false;
  showCoderTrainingsInfo = false;
  showCodingJobsInfo = false;

  // Duplicate aggregation state
  duplicateAggregationThreshold = 2;
  isApplyingDuplicateAggregation = false;
  private analysisPollingTimer?: ReturnType<typeof setTimeout>;
  private responseAnalysisRequestKey?: string;
  private responseAnalysisRequestGeneration = 0;
  private readonly responseAnalysisPollingDelayMs = 1500;
  private appliedResultsOverviewRequestKey?: string;
  private appliedResultsOverviewRequestGeneration = 0;
  private readonly windowFocusRefreshThrottleMs = 30000;
  private readonly codingFreshnessRefreshThrottleMs = 30000;
  private lastWindowFocusRefreshAt = 0;
  private lastCodingFreshnessRefreshAt = 0;
  private codingFreshnessRequestGeneration = 0;
  private readonly loadedManualTabs = new Set<ManualCodingTab>();
  private readonly handleWindowFocus = () => {
    if (!this.shouldRefreshManualStateOnFocus()) {
      return;
    }

    const now = Date.now();
    if (
      now - this.lastWindowFocusRefreshAt <
      this.windowFocusRefreshThrottleMs
    ) {
      return;
    }

    this.lastWindowFocusRefreshAt = now;
    this.refreshManualStateAfterExternalChange();
  };

  emptyPageIndex = 0;
  emptyPageSize = 5;
  duplicatePageIndex = 0;
  duplicatePageSize = 50;

  // Debouncing for job definition changes
  private jobDefinitionChangeSubject = new Subject<void>();

  private thresholdChangeSubject = new Subject<number>();

  private statisticsRefreshSubject = new Subject<void>();

  codingProgressOverview: CodingProgressOverview | null = null;

  variableCoverageOverview: {
    totalVariables: number;
    coveredVariables: number;
    coveredByDraft: number;
    coveredByPendingReview: number;
    coveredByApproved: number;
    conflictedVariables: number;
    missingVariables: number;
    partiallyAbgedeckteVariablen?: number;
    fullyAbgedeckteVariablen?: number;
    coveragePercentage: number;
    variableCaseCounts: {
      unitName: string;
      variableId: string;
      caseCount: number;
    }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{
        variableKey: string;
        conflictingDefinitions: Array<{
          id: number;
          status: string;
        }>;
      }>;
    };
    statusTotalVariables?: number;
    coveredSourceVariableCount?: number;
    coveredSourceResponseCount?: number;
  } | null = null;

  caseCoverageOverview: CaseCoverageOverview | null = null;

  workspaceKappaSummary: {
    coderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      kappa: number | null;
      agreement: number;
      totalSharedResponses: number;
      validPairs: number;
      interpretation: string;
    }>;
    workspaceSummary: {
      totalDoubleCodedResponses: number;
      totalCoderPairs: number;
      averageKappa: number | null;
      variablesIncluded: number;
      codersIncluded: number;
    };
  } | null = null;

  codingIncompleteVariables: {
    unitName: string;
    variableId: string;
    responseCount: number;
    availableCases?: number;
    uniqueCasesAfterAggregation?: number;
  }[] = [];

  manualCodingScopeSummary: ManualCodingScopeSummary | null = null;
  manualCodeAvailabilityWarnings: ManualCodeAvailabilityWarningDto[] = [];
  showAllManualCodeAvailabilityWarnings = false;
  readonly manualCodeAvailabilityPreviewLimit = 5;

  statusDistribution: { [status: string]: number } = {};
  statusDistributionV2: { [status: string]: number } = {};
  appliedResultsOverview:
  | (AppliedResultsOverview & {
    totalIncompleteVariables: number;
    finalStatusBreakdown: {
      codingComplete: number;
      invalid: number;
      codingError: number;
      other: number;
    };
  })
  | null = null;

  completedJobsReadyForApply: CodingJob[] = [];
  completedJobsBlockedForReview: CodingJob[] = [];
  codingFreshnessSummary: CodingFreshnessSummaryDto | null = null;
  private manualFreshnessJobSummary: ManualFreshnessJobSummary | null = null;
  private openDoubleCodingConflictCount = 0;

  isLoadingCompletedJobsReadyForApply = false;
  isLoadingCodingFreshness = false;
  isLoadingManualFreshnessJobSummary = false;
  isLoadingDoubleCodingConflictSummary = false;

  isApplyingCodingResults = false;

  private applyingCodingResultJobIds = new Set<number>();
  emptyResponseMissing: { code: number; score: number | null } | null = null;

  showCoderTraining = false;
  editTraining: CoderTraining | null = null;
  coders: Coder[] = [];
  isStartingManualExport = false;
  isLoadingCodersForExport = false;
  private codersForExportWorkspaceId?: number;
  private hasLoadedCodersForExport = false;
  private jobDefinitionsForExport: JobDefinition[] = [];
  private jobDefinitionsForExportWorkspaceId?: number;
  private hasLoadedJobDefinitionsForExport = false;
  private isLoadingJobDefinitionsForExport = false;
  private readonly manualFreshnessFocusParam = 'manual-freshness';
  private pendingManualFreshnessFocus = false;
  private manualFreshnessPlanningRequested = false;

  expectedCombinations: ExpectedCombinationDto[] = [];

  ngOnInit(): void {
    this.pendingManualFreshnessFocus =
      this.route.snapshot.queryParamMap.get('focus') ===
      this.manualFreshnessFocusParam;

    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe((progress: ValidationProgress | null) => {
        this.validationProgress = progress;
        if (!progress) {
          this.isLoading = false;
          return;
        }

        this.isLoading =
          progress.status === 'loading' || progress.status === 'processing';

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
    this.validationProgress = currentProgress;
    this.isLoading =
      currentProgress.status === 'loading' ||
      currentProgress.status === 'processing';

    this.loadCodersForExport();
    this.loadJobDefinitionsForExport();

    // Set up debounced statistics refresh
    this.jobDefinitionChangeSubject
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadJobDefinitionsForExport({ force: true });
        this.loadManualTabData(this.activeManualTab, { forceRefresh: true });
        if (this.coderTrainingsListComponent) {
          this.coderTrainingsListComponent.loadCoderTrainings();
        }
      });

    // Reload aggregation-dependent data when threshold changes.
    this.thresholdChangeSubject
      .pipe(
        debounceTime(1000), // Wait for user to stop typing
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe((threshold: number) => {
        const workspaceId = this.appService.selectedWorkspaceId;
        if (workspaceId) {
          const localFlagsAfterSave = [...this.responseMatchingFlags];
          const flagsToPersist =
            this.getPersistableResponseMatchingFlags(localFlagsAfterSave);
          this.isApplyingDuplicateAggregation = true;
          this.testPersonCodingService
            .saveAggregationSettings(workspaceId, threshold, flagsToPersist)
            .pipe(
              finalize(() => {
                this.isApplyingDuplicateAggregation = false;
              }),
              takeUntil(this.destroy$)
            )
            .subscribe({
              next: result => {
                if (!result.success) {
                  this.showError(result.message);
                  return;
                }
                this.persistedResponseMatchingFlags = [...result.flags];
                this.responseMatchingFlags =
                  this.buildResponseMatchingFlagsAfterSettingsSave(
                    result.flags,
                    localFlagsAfterSave
                  );
                this.duplicateAggregationThreshold =
                  this.normalizeAggregationThreshold(result.threshold);
                this.refreshAggregationDependentViews();
              },
              error: () => {
                this.showError(
                  'Fehler beim Speichern der Aggregationseinstellungen'
                );
              }
            });
        }
      });

    this.testPersonCodingService.autoCodingCompleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (!this.autoRefreshManualCodingJobs) {
          return;
        }

        this.loadedManualTabs.clear();
        this.refreshAllStatistics();
        this.loadCodingFreshness({ force: true });
        this.loadResponseAnalysis({ force: true });
        this.reloadCodingJobsList();
        this.loadJobDefinitionsForExport({ force: true });
        if (this.codingJobDefinitionsComponent) {
          this.codingJobDefinitionsComponent.refresh();
        }
      });

    this.loadManualCodingJobRefreshSetting(() => {
      this.loadManualCodingApplyPermission();
      this.loadInitialManualCodingState();
      if (
        this.autoRefreshManualCodingJobs &&
        this.activeManualTab !== 'planning'
      ) {
        this.loadCodingFreshness();
      }
    });
    this.document.defaultView?.addEventListener(
      'focus',
      this.handleWindowFocus
    );
  }

  ngOnDestroy(): void {
    if (this.analysisPollingTimer) {
      clearTimeout(this.analysisPollingTimer);
    }
    this.document.defaultView?.removeEventListener(
      'focus',
      this.handleWindowFocus
    );
    this.destroy$.next();
    this.destroy$.complete();

    this.jobDefinitionChangeSubject.complete();
    this.statisticsRefreshSubject.complete();
  }

  get activeManualTab(): ManualCodingTab {
    return (
      this.visibleManualCodingTabs[this.selectedManualTabIndex] || 'preparation'
    );
  }

  get workspaceId(): number {
    return this.appService.selectedWorkspaceId;
  }

  get visibleManualCodingTabs(): ManualCodingTab[] {
    if (this.canShowManualCompletionTab()) {
      return this.manualCodingTabs;
    }

    return this.manualCodingTabsWithoutCompletion;
  }

  getManualTabLabel(tab: ManualCodingTab): string {
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

  isManualTab(tab: ManualCodingTab): boolean {
    return this.activeManualTab === tab;
  }

  shouldRenderManualTabContent(tab: ManualCodingTab): boolean {
    return (
      this.isManualTab(tab) ||
      (!this.autoRefreshManualCodingJobs && this.loadedManualTabs.has(tab))
    );
  }

  onManualTabChanged(index: number): void {
    if (this.selectedManualTabIndex === index) {
      return;
    }

    this.selectedManualTabIndex = index;
    this.loadManualTabData(this.activeManualTab);
  }

  goToManualTab(tab: ManualCodingTab, sectionId?: string): void {
    const tabIndex = this.visibleManualCodingTabs.indexOf(tab);
    if (tabIndex < 0) {
      return;
    }

    if (this.selectedManualTabIndex !== tabIndex) {
      this.selectedManualTabIndex = tabIndex;
      this.loadManualTabData(tab);
    }

    if (sectionId) {
      setTimeout(() => this.scrollToSection(sectionId), 0);
    }
  }

  onExternalCodingFileSelected(event: Event): void {
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

  private async processExternalCodingFile(file: File): Promise<void> {
    this.isLoading = true;

    try {
      const workspaceId = this.appService.selectedWorkspaceId;

      if (!workspaceId) {
        const errorMsg = this.translateService.instant(
          'coding-management-manual.errors.no-workspace-selected'
        );
        this.showError(errorMsg);
        this.isLoading = false;
        return;
      }

      const detection = await this.detectCodingImportFormat(file);
      const dialogResult = await firstValueFrom(
        this.dialog
          .open<
        CodingImportFormatDialogComponent,
        CodingImportFormatDialogData,
        CodingImportFormatDialogResult | undefined
        >(CodingImportFormatDialogComponent, {
          width: '720px',
          maxWidth: '95vw',
          data: detection
        })
          .afterClosed()
      );

      if (!dialogResult) {
        this.isLoading = false;
        return;
      }

      this.validationStateService.startValidation();
      this.validationStateService.updateProgress(
        10,
        this.translateService.instant(
          'coding-management-manual.progress.file-processing'
        )
      );
      const fileData = await this.fileToBase64(file);

      await this.testPersonCodingService.importExternalCodingWithProgress(
        workspaceId,
        {
          file: fileData,
          fileName: file.name,
          previewOnly: true,
          sourceFormat: dialogResult.sourceFormat,
          sourceVersion: dialogResult.sourceVersion,
          scoreMode: dialogResult.scoreMode,
          existingCodingMode: dialogResult.existingCodingMode
        },
        (progress: number, message: string) => {
          this.validationStateService.updateProgress(progress, message);
        },
        // onComplete callback
        (result: ExternalCodingImportResultDto) => {
          this.validationStateService.resetValidation();

          // Open the preview dialog with confirmation options
          this.dialog.open(ImportComparisonDialogComponent, {
            width: '95vw',
            maxWidth: '95vw',
            height: '90vh',
            data: {
              message: result.message,
              processedRows: result.processedRows,
              updatedRows: result.updatedRows,
              errors: result.errors,
              affectedRows: result.affectedRows,
              isPreview: true,
              workspaceId: workspaceId,
              fileData: fileData,
              fileName: file.name,
              sourceFormat: dialogResult.sourceFormat,
              sourceVersion: dialogResult.sourceVersion,
              scoreMode: dialogResult.scoreMode,
              existingCodingMode: dialogResult.existingCodingMode
            } as ImportComparisonData
          });

          this.showSuccess(
            this.translateService.instant(
              'coding-management-manual.success.preview-completed',
              {
                updatedRows: result.updatedRows,
                processedRows: result.processedRows
              }
            )
          );

          if (result.errors && result.errors.length > 0) {
            this.showError(
              this.translateService.instant('error.general', {
                error: `${result.errors.length} Warnungen aufgetreten. Details in der Konsole.`
              })
            );
          }

          this.isLoading = false;
        },
        // onError callback
        (error: string) => {
          this.validationStateService.setValidationError(
            `Import fehlgeschlagen: ${error}`
          );
          this.showError(
            this.translateService.instant(
              'coding-management-manual.errors.import-failed'
            )
          );
          this.isLoading = false;
        }
      );
    } catch (error) {
      this.validationStateService.setValidationError(
        this.translateService.instant(
          'coding-management-manual.errors.import-failed'
        )
      );
      this.showError(
        this.translateService.instant(
          'coding-management-manual.errors.import-failed'
        )
      );
      this.isLoading = false;
    }
  }

  private async detectCodingImportFormat(
    file: File
  ): Promise<CodingImportFormatDialogData> {
    let headers: string[] = [];
    const fileName = file.name;

    try {
      headers = await this.readImportHeaders(file);
    } catch {
      return this.buildFormatDialogData(
        fileName,
        'unknown',
        [],
        [
          'Die Datei konnte nicht gelesen werden. Bitte prüfen Sie, ob die Datei beschädigt ist oder von einem anderen Programm gesperrt wird.',
          'Unterstützt werden CSV-Dateien sowie Excel-Dateien im Format .xlsx oder .xls.'
        ]
      );
    }

    const detectedFormat = this.detectFormatFromHeaders(headers);
    return this.buildFormatDialogData(fileName, detectedFormat, headers);
  }

  private async readImportHeaders(file: File): Promise<string[]> {
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);
      if (!worksheet) {
        return [];
      }

      const headers: string[] = [];
      worksheet.getRow(1).eachCell(cell => {
        headers.push(
          this.normalizeImportHeader(cell.text || cell.value?.toString() || '')
        );
      });
      return headers.filter(Boolean);
    }

    const sample = await file.slice(0, 65536).text();
    const firstLine =
      sample.split(/\r?\n/).find(line => line.trim().length > 0) || '';
    const delimiter = this.detectCsvDelimiter(firstLine);
    return this.splitCsvHeaderLine(firstLine, delimiter)
      .map(header => this.normalizeImportHeader(header))
      .filter(Boolean);
  }

  private detectFormatFromHeaders(
    headers: string[]
  ): CodingImportDetectedFormat {
    const has = (header: string): boolean => headers.includes(header);
    const hasAny = (candidates: string[]): boolean => candidates.some(candidate => has(candidate));

    if (
      has('groupname') &&
      has('loginname') &&
      has('code') &&
      has('bookletname') &&
      has('unitname') &&
      has('timestamp') &&
      has('logentry')
    ) {
      return 'test-logs';
    }

    if (
      has('groupname') &&
      has('loginname') &&
      has('code') &&
      has('bookletname') &&
      has('unitname') &&
      has('responses')
    ) {
      return 'test-results';
    }

    if (
      has('variable_id') &&
      hasAny([
        'status_v1',
        'code_v1',
        'score_v1',
        'status_v2',
        'code_v2',
        'score_v2',
        'status_v3',
        'code_v3',
        'score_v3'
      ])
    ) {
      return 'coding-results';
    }

    if (has('variable_id') && (has('unit_key') || has('unit_alias'))) {
      if (
        hasAny(['status', 'code', 'score', 'variable_page', 'variable_anchor'])
      ) {
        return hasAny(['variable_page', 'variable_anchor']) ?
          'coding-list' :
          'external-coding';
      }
    }

    return 'unknown';
  }

  private buildFormatDialogData(
    fileName: string,
    detectedFormat: CodingImportDetectedFormat,
    headers: string[],
    fallbackHelpItems?: string[]
  ): CodingImportFormatDialogData {
    const availableVersions = this.getAvailableCodingVersions(headers);
    const sharedDescription =
      'Für Testfälle, die außerhalb der Kodierbox bereits mit Code und Score kodiert wurden.';

    if (detectedFormat === 'external-coding') {
      return {
        fileName,
        detectedFormat,
        title: 'Kodierungen aus Datei importieren',
        description: sharedDescription,
        canImport: true,
        headers,
        helpItems: [
          'Erwartet werden unit_key oder unit_alias, variable_id und mindestens eine Spalte code, score oder status.',
          'Optionale Zuordnungsspalten wie person_code, person_login, person_group und booklet_name machen den Import eindeutiger.'
        ]
      };
    }

    if (detectedFormat === 'coding-list') {
      const hasCodingValues = ['status', 'code', 'score'].some(header => headers.includes(header)
      );
      return {
        fileName,
        detectedFormat,
        title: 'Kodierungen aus Datei importieren',
        description: sharedDescription,
        canImport: hasCodingValues,
        headers,
        helpItems: hasCodingValues ?
          [
            'Die Datei sieht nach einer Kodierliste aus dem Coding Management aus.',
            'Die ergänzten Spalten code, score und status werden als manuelle Kodierung importiert.'
          ] :
          [
            'Die Datei sieht nach einer Kodierliste aus, enthält aber noch keine Kodierungsspalten.',
            'Bitte ergänzen Sie mindestens code und score, optional auch status, und wählen Sie die Datei erneut aus.'
          ]
      };
    }

    if (detectedFormat === 'coding-results') {
      return {
        fileName,
        detectedFormat,
        title: 'Kodierungen aus Datei importieren',
        description:
          'Die Datei sieht nach einem Kodierergebnis-Export aus dem Coding Management aus.',
        canImport: availableVersions.length > 0,
        headers,
        availableVersions,
        selectedVersion: availableVersions.includes('v2') ?
          'v2' :
          availableVersions[0],
        helpItems: [
          'Wählen Sie aus, welche Version aus der Datei übernommen werden soll.',
          'Die ausgewählten Werte werden als manuelle Kodierung (v2) importiert.'
        ]
      };
    }

    if (detectedFormat === 'test-results') {
      return {
        fileName,
        detectedFormat,
        title: 'Testergebnisse-Export erkannt',
        description:
          'Diese Datei enthält vollständige Testergebnisse mit Antworten und Zuständen, nicht nur Code-/Score-Kodierungen.',
        canImport: false,
        headers,
        helpItems: [
          'Bitte wechseln Sie zu Testergebnisse > Import > Antworten hochladen.',
          'Für den Kodierungsimport wird eine flache Datei mit unit_key oder unit_alias, variable_id, code und score benötigt.'
        ]
      };
    }

    if (detectedFormat === 'test-logs') {
      return {
        fileName,
        detectedFormat,
        title: 'Testlogs-Export erkannt',
        description:
          'Diese Datei enthält Testlogs und kann nicht als Code-/Score-Kodierung übernommen werden.',
        canImport: false,
        headers,
        helpItems: [
          'Bitte wechseln Sie zu Testergebnisse > Import > Logs hochladen.',
          'Für den Kodierungsimport wird eine flache Datei mit unit_key oder unit_alias, variable_id, code und score benötigt.'
        ]
      };
    }

    return {
      fileName,
      detectedFormat,
      title: 'Datei konnte nicht erkannt werden',
      description: 'Die Datei passt zu keinem unterstützten Kodierungsimport.',
      canImport: false,
      headers,
      helpItems: fallbackHelpItems || [
        'Prüfen Sie, ob die erste Zeile Spaltenüberschriften enthält.',
        'Für Kodierungen aus anderer Quelle werden unit_key oder unit_alias, variable_id, code und score erwartet.',
        'Kodierergebnis-Exporte müssen Spalten wie status_v2, code_v2 und score_v2 enthalten.',
        'Testergebnisse- und Log-Exporte bitte über den Bereich Testergebnisse importieren.'
      ]
    };
  }

  private getAvailableCodingVersions(
    headers: string[]
  ): Array<'v1' | 'v2' | 'v3'> {
    return (['v1', 'v2', 'v3'] as Array<'v1' | 'v2' | 'v3'>).filter(
      version => headers.includes(`status_${version}`) ||
        headers.includes(`code_${version}`) ||
        headers.includes(`score_${version}`)
    );
  }

  private normalizeImportHeader(header: string): string {
    return header
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  private detectCsvDelimiter(line: string): ';' | ',' | '\t' {
    const candidates: Array<';' | ',' | '\t'> = [';', ',', '\t'];
    let selected: ';' | ',' | '\t' = ',';
    let bestCount = -1;

    candidates.forEach(candidate => {
      const count = this.countDelimiterOutsideQuotes(line, candidate);
      if (count > bestCount) {
        bestCount = count;
        selected = candidate;
      }
    });

    return selected;
  }

  private countDelimiterOutsideQuotes(line: string, delimiter: string): number {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }

    return count;
  }

  private splitCsvHeaderLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && char === delimiter) {
        values.push(current.replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current.replace(/^"|"$/g, ''));
    return values;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = error => reject(error);
    });
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

  openCoderTraining(): void {
    this.showCoderTraining = true;
  }

  openTrainingComparison(): void {
    if (this.coderTrainingsListComponent) {
      this.coderTrainingsListComponent.openResultsComparison(
        undefined,
        'between-trainings'
      );
      return;
    }

    this.showError(
      'Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.'
    );
  }

  openTrainingDiscussion(): void {
    this.openTrainingWithinComparison();
  }

  openTrainingReliability(): void {
    const coderTrainings = this.getCoderTrainingsForExport();

    if (coderTrainings.length === 0) {
      this.showError(
        'Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.'
      );
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
    if (this.coderTrainingsListComponent) {
      this.coderTrainingsListComponent.openResultsComparison(
        undefined,
        'within-training'
      );
      return;
    }

    this.showError(
      'Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.'
    );
  }

  openExecutionTransferCases(): void {
    if (!this.canManageManualCodingJobs) {
      this.showError('Keine Berechtigung zum Verwalten von Kodierjobs.');
      return;
    }

    if (this.productiveCodingJobsComponent) {
      this.productiveCodingJobsComponent.openTransferCodingCasesDialog();
      return;
    }

    this.showError(
      'Die Kodierjobs werden noch geladen. Bitte versuchen Sie es gleich erneut.'
    );
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

  openExecutionDoubleCodedReview(): void {
    this.openDoubleCodedReviewDialog();
  }

  openTrainingExport(): void {
    const coderTrainingIds = this.getCoderTrainingIds();

    if (coderTrainingIds.length === 0) {
      this.showError(
        'Die Schulungen werden noch geladen. Bitte versuchen Sie es gleich erneut.'
      );
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

  private openManualCodingExportDialog(
    context: 'training' | 'execution'
  ): void {
    this.dialog
      .open(ManualCodingExportDialogComponent, {
        width: '680px',
        maxWidth: '95vw',
        data: {
          context,
          coders: this.coders,
          jobDefinitions:
            context === 'execution' ?
              this.getJobDefinitionExportOptions() :
              undefined,
          coderTrainings:
            context === 'training' ?
              this.getCoderTrainingsForExport() :
              undefined,
          defaultJobDefinitionIds:
            context === 'execution' ? this.getJobDefinitionIds() : undefined,
          defaultCoderTrainingIds:
            context === 'training' ? this.getCoderTrainingIds() : undefined
        }
      })
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
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

    const exportConfig: ExportJobConfig = {
      exportType: result.exportType,
      userId: this.appService.userId,
      ...this.getManualCodingExportDisplayMetadata(result),
      includeReplayUrl: result.includeReplayUrl ?? false,
      outputCommentsInsteadOfCodes: result.outputCommentsInsteadOfCodes,
      anonymizeCoders: result.anonymizeCoders,
      usePseudoCoders: result.usePseudoCoders,
      doubleCodingMethod: result.doubleCodingMethod,
      includeComments: result.includeComments,
      includeModalValue: result.includeModalValue,
      excludeAutoCoded: true,
      coderIds: result.coderIds,
      coderTrainingIds:
        context === 'training' ?
          (result.coderTrainingIds ?? this.getCoderTrainingIds()) :
          undefined,
      jobDefinitionIds:
        context === 'execution' ?
          (result.jobDefinitionIds ?? this.getJobDefinitionIds()) :
          undefined
    };

    if (this.requiresByVariableWorksheetEstimate(result)) {
      this.estimateManualByVariableExport(workspaceId, exportConfig);
      return;
    }

    this.startManualCodingExportJob(workspaceId, exportConfig);
  }

  private startManualCodingExportJob(
    workspaceId: number,
    exportConfig: ExportJobConfig
  ): void {
    this.isStartingManualExport = true;
    this.exportJobService
      .startJob(workspaceId, exportConfig)
      .pipe(
        finalize(() => {
          this.isStartingManualExport = false;
        })
      )
      .subscribe({
        next: () => {
          this.showSuccess('Exportjob wurde gestartet.');
        },
        error: error => {
          if (isReplayAuthTokenError(error)) {
            this.showError(
              this.translateService.instant(
                'coding-management-manual.errors.replay-auth-token-failed'
              )
            );
            return;
          }
          this.showError('Exportjob konnte nicht gestartet werden.');
        }
      });
  }

  private requiresByVariableWorksheetEstimate(
    result: ManualCodingExportDialogResult
  ): boolean {
    return (
      result.exportType === 'aggregated' &&
      result.doubleCodingMethod === 'new-row-per-variable'
    );
  }

  private estimateManualByVariableExport(
    workspaceId: number,
    exportConfig: ExportJobConfig
  ): void {
    const estimateConfig: ExportJobConfig = {
      ...exportConfig,
      exportType: 'by-variable',
      doubleCodingMethod: undefined
    };

    this.isStartingManualExport = true;
    this.exportJobService
      .estimateJob(workspaceId, estimateConfig)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: estimate => {
          this.isStartingManualExport = false;
          if (!estimate.exceedsWorksheetLimit || !estimate.worksheetLimit) {
            this.startManualCodingExportJob(workspaceId, exportConfig);
            return;
          }

          this.openLargeByVariableExportDialog(
            workspaceId,
            exportConfig,
            estimate.unitVariableCount,
            estimate.worksheetLimit
          );
        },
        error: () => {
          this.isStartingManualExport = false;
          this.showError(
            this.translateService.instant(
              'manual-coding-export.worksheet-estimate-failed'
            )
          );
        }
      });
  }

  private openLargeByVariableExportDialog(
    workspaceId: number,
    exportConfig: ExportJobConfig,
    actualWorksheetCount: number,
    worksheetLimit: number
  ): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '560px',
      data: {
        title: this.translateService.instant(
          'manual-coding-export.too-many-worksheets-title'
        ),
        message: this.translateService.instant(
          'manual-coding-export.too-many-worksheets-message',
          { actual: actualWorksheetCount, max: worksheetLimit }
        ),
        confirmButtonText: this.translateService.instant(
          'manual-coding-export.too-many-worksheets-continue'
        ),
        alternativeButtonText: this.translateService.instant(
          'manual-coding-export.too-many-worksheets-compact'
        ),
        alternativeButtonValue: 'compact',
        cancelButtonText: this.translateService.instant('cancel')
      }
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe(decision => {
        if (decision === true) {
          this.startManualCodingExportJob(workspaceId, exportConfig);
          return;
        }

        if (decision === 'compact') {
          this.startManualCodingExportJob(
            workspaceId,
            this.createCompactByVariableExportConfig(exportConfig)
          );
        }
      });
  }

  private createCompactByVariableExportConfig(
    exportConfig: ExportJobConfig
  ): ExportJobConfig {
    return {
      ...exportConfig,
      exportType: 'by-variable-compact',
      doubleCodingMethod: undefined,
      displayLabelKey: 'export-toast.types.by-variable-compact',
      downloadFilePrefix: 'manual-review-by-variable-compact'
    };
  }

  private getManualCodingExportDisplayMetadata(
    result: ManualCodingExportDialogResult
  ): Pick<ExportJobConfig, 'displayLabelKey' | 'downloadFilePrefix'> {
    if (result.exportType !== 'aggregated') {
      return {};
    }

    switch (result.doubleCodingMethod || 'most-frequent') {
      case 'new-column-per-coder':
        return {
          displayLabelKey:
            'export-toast.types.manual-review-new-column-per-coder',
          downloadFilePrefix: 'manual-review-new-column-per-coder'
        };
      case 'new-row-per-variable':
        return {
          displayLabelKey:
            'export-toast.types.manual-review-new-row-per-variable',
          downloadFilePrefix: 'manual-review-new-row-per-variable'
        };
      case 'most-frequent':
      default:
        return {
          displayLabelKey: 'export-toast.types.manual-review-most-frequent',
          downloadFilePrefix: 'manual-review-most-frequent'
        };
    }
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
    return this.coderTrainingsListComponent?.originalData.length ?
      this.coderTrainingsListComponent.originalData :
      (this.coderTrainingsListComponent?.coderTrainings ?? []);
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
          label: `Definition #${jobDefinition.id}${status}: ${variableCount} Variablen, ${bundleCount} Bündel`
        };
      });
  }

  private getJobDefinitionsForManualScope(): JobDefinition[] {
    const renderedDefinitions =
      this.codingJobDefinitionsComponent?.jobDefinitions;
    if (renderedDefinitions?.length) {
      return renderedDefinitions;
    }

    return this.jobDefinitionsForExportWorkspaceId ===
      this.appService.selectedWorkspaceId ?
      this.jobDefinitionsForExport :
      [];
  }

  private ensureExecutionJobDefinitionScopeReady(): boolean {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      return true;
    }

    if (
      (this.hasLoadedJobDefinitionsForExport &&
        this.jobDefinitionsForExportWorkspaceId === workspaceId) ||
      this.codingJobDefinitionsComponent
    ) {
      return true;
    }

    if (!this.isLoadingJobDefinitionsForExport) {
      this.loadJobDefinitionsForExport();
    }

    this.showError(
      'Die Jobdefinitionen werden noch geladen. Bitte versuchen Sie es gleich erneut.'
    );
    return false;
  }

  private ensureCoderScopeReady(): boolean {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      return true;
    }

    if (
      this.hasLoadedCodersForExport &&
      this.codersForExportWorkspaceId === workspaceId
    ) {
      return true;
    }

    if (!this.isLoadingCodersForExport) {
      this.loadCodersForExport();
    }

    this.showError(
      'Die Kodierer werden noch geladen. Bitte versuchen Sie es gleich erneut.'
    );
    return false;
  }

  closeCoderTraining(): void {
    this.showCoderTraining = false;
    this.editTraining = null;
  }

  openTrainingEdit(training: CoderTraining): void {
    this.editTraining = training;
    this.showCoderTraining = true;
  }

  /**
   * Event handler for job definition changes (create, update, delete)
   * Uses debouncing to prevent excessive API calls
   */
  onJobDefinitionChanged(): void {
    this.jobDefinitionChangeSubject.next();
  }

  /**
   * Refreshes all statistics with individual loading states
   */
  refreshAllStatistics(): void {
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

  reloadCodingJobsList(): void {
    [
      this.productiveCodingJobsComponent,
      this.trainingCodingJobsComponent
    ].forEach(component => component?.loadCodingJobs());
    if (this.coderTrainingsListComponent) {
      this.coderTrainingsListComponent.loadCoderTrainings();
    }
  }

  refreshManualCodingPlanning(): void {
    const activeTab = this.activeManualTab;
    this.loadManualTabData(activeTab, { forceRefresh: true });
    if (!this.codingJobDefinitionsComponent) {
      this.loadJobDefinitionsForExport({ force: true });
    }
    if (activeTab !== 'planning') {
      this.loadCodingFreshness({ force: true });
    }
    if (this.shouldReloadCodingJobsAfterManualTabData(activeTab)) {
      this.reloadCodingJobsList();
    }

    if (this.codingJobDefinitionsComponent) {
      this.codingJobDefinitionsComponent.refresh();
    }
  }

  private shouldRefreshManualStateOnFocus(): boolean {
    return (
      this.autoRefreshManualCodingJobs &&
      (this.activeManualTab === 'planning' ||
        this.activeManualTab === 'execution' ||
        this.activeManualTab === 'completion')
    );
  }

  private refreshManualStateAfterExternalChange(): void {
    const activeTab = this.activeManualTab;
    this.loadManualTabData(activeTab, { reloadCodingJobs: false });
    if (activeTab !== 'planning') {
      this.loadCodingFreshness();
    }
    if (this.shouldReloadCodingJobsAfterManualTabData(activeTab)) {
      this.reloadCodingJobsList();
    }
  }

  private shouldReloadCodingJobsAfterManualTabData(
    tab: ManualCodingTab
  ): boolean {
    return tab === 'preparation';
  }

  isAnyPlanningDataLoading(): boolean {
    return (
      this.isLoadingResponseAnalysis ||
      this.isLoadingCodingProgress ||
      this.isLoadingVariableCoverage ||
      this.isLoadingCaseCoverage ||
      this.isLoadingManualCodeAvailability ||
      this.isLoadingCodingIncompleteVariables ||
      this.isLoadingAppliedResultsOverview ||
      this.isLoadingManualFreshnessJobSummary ||
      this.isLoadingDoubleCodingConflictSummary ||
      this.isLoadingMatchingMode
    );
  }

  shouldShowManualRefreshControls(): boolean {
    return !this.autoRefreshManualCodingJobs;
  }

  getOpenCodingCases(): number {
    if (this.codingProgressOverview) {
      return Math.max(
        0,
        this.codingProgressOverview.totalCasesToCode -
          this.codingProgressOverview.completedCases
      );
    }

    return this.appliedResultsOverview?.remainingResponses || 0;
  }

  getAvailableCasesForNewJobs(): number {
    const availableCases = this.codingIncompleteVariables.reduce(
      (sum, variable) => sum +
        (variable.availableCases ??
          variable.uniqueCasesAfterAggregation ??
          variable.responseCount ??
          0),
      0
    );

    if (this.caseCoverageOverview?.effectiveUnassignedCases === 0) {
      return 0;
    }

    return availableCases;
  }

  getUnavailableCasesForNewJobs(): number {
    const totalEffectiveCases = this.codingIncompleteVariables.reduce(
      (sum, variable) => sum + this.getVariableEffectiveCaseCount(variable),
      0
    );

    return Math.max(
      0,
      totalEffectiveCases - this.getAvailableCasesForNewJobs()
    );
  }

  getVariableCoveragePercentage(): number {
    return this.variableCoverageOverview?.coveragePercentage || 0;
  }

  getAppliedResultsPercentage(): number {
    return this.appliedResultsOverview?.completionPercentage || 0;
  }

  getCurrentRawManualResponses(): number {
    return (
      this.appliedResultsOverview?.rawTotalIncompleteResponses ??
      this.codingProgressOverview?.rawTotalCasesToCode ??
      this.caseCoverageOverview?.totalCasesToCode ??
      0
    );
  }

  getResponseAnalysisReferenceRawCases(): number {
    return this.getManualStatusPoolCount();
  }

  getManualStatusPoolCount(): number {
    return (
      this.codingProgressOverview?.statusTotalCasesToCode ??
      this.caseCoverageOverview?.statusTotalCasesToCode ??
      this.appliedResultsOverview?.statusTotalIncompleteResponses ??
      (this.manualCodingScopeSummary ?
        this.manualCodingScopeSummary.manualResponseCount +
          this.manualCodingScopeSummary.coveredSourceResponseCount :
        0)
    );
  }

  getEffectiveManualCaseCount(): number {
    return (
      this.codingProgressOverview?.totalCasesToCode ??
      this.caseCoverageOverview?.effectiveTotalCasesToCode ??
      this.appliedResultsOverview?.totalIncompleteResponses ??
      0
    );
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
    const reason =
      difference > 0 ?
        `${difference} Rohantworten werden durch abgeleitete Variablen, Vorverarbeitung oder Aggregation nicht separat verteilt.` :
        'Die effektive Fallzahl kann durch Mehrfachkodierung oder manuelle Nacharbeit abweichen.';
    const openCaseHint =
      openCaseCount !== effectiveCaseCount ?
        `, davon ${openCaseCount} offen` :
        '';

    return `${statusPoolCount} Rohantworten im Statuspool -> ${effectiveCaseCount} effektive Arbeitsfälle${openCaseHint}. ${reason}`;
  }

  isResponseAnalysisOutdated(): boolean {
    return (
      !!this.responseAnalysis &&
      !this.responseAnalysis.isCalculating &&
      this.responseAnalysis.sourceRevision !== undefined &&
      this.responseAnalysis.currentSourceRevision !== undefined &&
      this.responseAnalysis.sourceRevision !==
        this.responseAnalysis.currentSourceRevision
    );
  }

  hasResponseAnalysisRestScopeDifference(): boolean {
    const analysisRawCases =
      this.responseAnalysis?.aggregationSummary?.rawCases ?? 0;
    const currentRawManualResponses = this.getCurrentRawManualResponses();
    return (
      !!this.responseAnalysis &&
      !this.responseAnalysis.isCalculating &&
      !this.isResponseAnalysisOutdated() &&
      currentRawManualResponses > 0 &&
      analysisRawCases !== currentRawManualResponses
    );
  }

  private shouldLoadResponseAnalysisForPlanning(): boolean {
    if (!this.responseAnalysis) {
      return true;
    }

    if (this.responseAnalysis.isCalculating) {
      return true;
    }

    if ((this.responseAnalysis.aggregationSummary?.rawCases ?? 0) === 0) {
      return true;
    }

    return this.isResponseAnalysisOutdated();
  }

  private loadResponseAnalysisForPlanningIfNeeded(): void {
    if (
      !this.isLoadingResponseAnalysis &&
      this.shouldLoadResponseAnalysisForPlanning()
    ) {
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
    return (
      this.hasUncodedEmptyResponses() ||
      this.hasDuplicateFindingsWithoutAggregation
    );
  }

  isPreparationReady(): boolean {
    return (
      !!this.responseAnalysis &&
      !this.responseAnalysis.isCalculating &&
      !this.hasPreparationWarnings()
    );
  }

  hasPlanningWarnings(): boolean {
    return (
      this.hasManualCodeAvailabilityWarnings ||
      (this.variableCoverageOverview?.conflictedVariables || 0) > 0 ||
      (this.variableCoverageOverview?.missingVariables || 0) > 0 ||
      (this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0
    );
  }

  hasVariableCoverageConflicts(): boolean {
    return (this.variableCoverageOverview?.conflictedVariables || 0) > 0;
  }

  isPlanningReady(): boolean {
    return (
      !!this.variableCoverageOverview &&
      !!this.caseCoverageOverview &&
      !this.hasPlanningWarnings()
    );
  }

  hasExecutionOpenWork(): boolean {
    return this.getOpenCodingCases() > 0;
  }

  private hasPreparationRefreshTarget(): boolean {
    return this.hasPreparationWarnings() || this.isResponseAnalysisOutdated();
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

    return (
      this.hasManualCodingProgressScope() &&
      !!this.codingProgressOverview &&
      !!this.appliedResultsOverview &&
      !this.hasExecutionOpenWork()
    );
  }

  isCompletionComplete(): boolean {
    return (
      this.hasManualCodingProgressScope() &&
      this.getAppliedResultsPercentage() >= 100 &&
      this.getOpenCodingCases() === 0
    );
  }

  hasManualCodingProgressScope(): boolean {
    return (
      (this.codingProgressOverview?.totalCasesToCode ?? 0) > 0 ||
      (this.codingProgressOverview?.rawTotalCasesToCode ?? 0) > 0 ||
      (this.appliedResultsOverview?.totalIncompleteResponses ?? 0) > 0 ||
      (this.appliedResultsOverview?.rawTotalIncompleteResponses ?? 0) > 0 ||
      (this.appliedResultsOverview?.appliedResponses ?? 0) > 0 ||
      (this.appliedResultsOverview?.remainingResponses ?? 0) > 0
    );
  }

  hasCompletedJobsReadyForApply(): boolean {
    return this.completedJobsReadyForApply.length > 0;
  }

  hasCompletedJobsBlockedForReview(): boolean {
    return this.completedJobsBlockedForReview.length > 0;
  }

  canApplyCompletedJobResults(): boolean {
    return (
      this.productiveCodingJobsComponent?.canApplyResults ??
      this.canApplyManualCodingResults
    );
  }

  canShowCompletedJobApplyActions(): boolean {
    return (
      this.hasCompletedJobsReadyForApply() && this.canApplyCompletedJobResults()
    );
  }

  getCompletionActionTitle(): string {
    if (this.isCompletionComplete()) {
      return 'Alle Ergebnisse sind übernommen';
    }

    if (this.hasCompletedJobsReadyForApply()) {
      if (this.hasCompletedJobsBlockedForReview()) {
        return `${this.completedJobsReadyForApply.length} abgeschlossene Kodierjob(s) bereit zum Anwenden, ${this.completedJobsBlockedForReview.length} mit offenen Hinweisen`;
      }
      return `${this.completedJobsReadyForApply.length} abgeschlossene Kodierjob(s) bereit zum Anwenden`;
    }

    if (this.hasCompletedJobsBlockedForReview()) {
      return `${this.completedJobsBlockedForReview.length} abgeschlossene Kodierjob(s) benötigen Review`;
    }

    if (this.hasExecutionOpenWork()) {
      return 'Noch nicht alle Kodierfälle sind abgeschlossen';
    }

    return 'Keine übernahmebereiten Kodierjobs gefunden';
  }

  getCompletionActionDescription(): string {
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

  getCompletionActionIcon(): string {
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

  isApplyingJobResults(jobId: number): boolean {
    return this.applyingCodingResultJobIds.has(jobId);
  }

  applyCompletedJobResults(job: CodingJob): void {
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

    dialogRef
      .afterClosed()
      .subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
        if (!dialogResult) {
          return;
        }

        this.isApplyingCodingResults = true;
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
              this.isApplyingCodingResults =
                this.applyingCodingResultJobIds.size > 0;
              loadingSnack.dismiss();
            }),
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
          `Möchten Sie die Ergebnisse für ${this.completedJobsReadyForApply.length} abgeschlossene Kodierjob(s) anwenden?`,
          'Bei Jobs mit offenen Kodierungshinweisen werden gültige Antworten angewendet;',
          'offene Hinweise bleiben zur manuellen Prüfung bestehen.'
        ].join(' '),
        confirmButtonText: 'Anwenden',
        cancelButtonText: 'Abbrechen'
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.performBulkApplyCompletedJobResults(workspaceId);
      }
    });
  }

  getPlanningStatusClass(): string {
    switch (this.getPlanningStatusState()) {
      case 'warning':
        if (this.hasVariableCoverageConflicts()) {
          return 'status-warning';
        }
        if (this.hasManualCodeAvailabilityWarnings) {
          return 'status-attention';
        }
        return 'status-warning';
      case 'planning-incomplete':
      case 'preparation-required':
      case 'double-coding-review-ready':
      case 'stale-source-review':
      case 'completion-ready':
      case 'progress-unavailable':
        return 'status-attention';
      case 'complete':
        return 'status-complete';
      case 'loading':
      case 'planning-ready':
      case 'training-ready':
      case 'execution-ready':
      default:
        return 'status-ready';
    }
  }

  private getPlanningStatusState(): PlanningStatusState {
    if (this.isAnyPlanningDataLoading()) {
      return 'loading';
    }

    if (this.hasPreparationRefreshTarget()) {
      return 'preparation-required';
    }

    if (this.hasManualCodeAvailabilityWarnings) {
      return 'warning';
    }

    if (this.hasVariableCoverageConflicts()) {
      return 'warning';
    }

    if (
      (this.variableCoverageOverview?.missingVariables || 0) > 0 ||
      (this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0
    ) {
      return 'planning-incomplete';
    }

    if (this.isPlanningReady() && this.hasActiveTrainingCodingJobs()) {
      return 'training-ready';
    }

    if (
      this.isPlanningReady() &&
      !!this.codingProgressOverview &&
      this.hasExecutionOpenWorkForFreshness()
    ) {
      return 'execution-ready';
    }

    if (this.isPlanningReady() && this.hasOpenDoubleCodingReviewConflicts()) {
      return 'double-coding-review-ready';
    }

    if (this.isPlanningReady() && this.hasStaleSourceManualJobs()) {
      return 'stale-source-review';
    }

    if (this.isCompletionComplete()) {
      return 'complete';
    }

    if (
      this.isPlanningReady() &&
      !!this.codingProgressOverview &&
      !!this.appliedResultsOverview &&
      this.hasCompletionReadyWorkForFreshness()
    ) {
      return 'completion-ready';
    }

    if (this.isPlanningReady() && !this.codingProgressOverview) {
      return 'progress-unavailable';
    }

    return 'planning-ready';
  }

  getPlanningStatusIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'loading':
        return 'sync';
      case 'warning':
        return 'warning';
      case 'preparation-required':
        return 'tune';
      case 'planning-incomplete':
        return 'assignment_late';
      case 'training-ready':
        return 'school';
      case 'execution-ready':
        return 'play_circle';
      case 'double-coding-review-ready':
        return 'compare';
      case 'stale-source-review':
        return 'sync_problem';
      case 'completion-ready':
        return 'published_with_changes';
      case 'progress-unavailable':
        return 'sync_problem';
      case 'complete':
        return 'check_circle';
      default:
        return 'route';
    }
  }

  getPlanningStatusTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'loading':
        return 'Status wird aktualisiert';
      case 'warning':
        return this.hasVariableCoverageConflicts() ?
          'Konflikte prüfen' :
          'Reguläre Codes für manuelle Kodierung prüfen';
      case 'preparation-required':
        return 'Vorbereitung aktualisieren';
      case 'planning-incomplete':
        return 'Planung noch unvollständig';
      case 'training-ready':
        return 'Schulungskodierjobs aktiv';
      case 'execution-ready':
        return 'Bereit für die Durchführung';
      case 'double-coding-review-ready':
        return 'Doppelkodierungsreview offen';
      case 'stale-source-review':
        return 'Veraltete Kodierjobs prüfen';
      case 'completion-ready':
        return this.canShowManualCompletionTab() ?
          'Bereit für den Abschluss' :
          'Kodierfälle abgeschlossen';
      case 'progress-unavailable':
        return 'Kodierfortschritt nicht verfügbar';
      case 'complete':
        return 'Manuelle Kodierung abgeschlossen';
      default:
        return 'Bereit für die Planung';
    }
  }

  getPlanningStatusDescription(): string {
    const planningStatusState = this.getPlanningStatusState();

    if (planningStatusState === 'loading') {
      return 'Die Planungs- und Kodierfortschritte werden geladen.';
    }

    if (planningStatusState === 'progress-unavailable') {
      return 'Die Planung ist vollständig, der aktuelle Kodierfortschritt konnte aber nicht ermittelt werden. Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs.';
    }

    if (planningStatusState === 'preparation-required') {
      if (this.isResponseAnalysisOutdated()) {
        return 'Die Antwortanalyse oder Aggregationsgrundlage ist nicht mehr aktuell. Aktualisieren Sie zuerst die Vorbereitung.';
      }
      return 'In der Vorbereitung gibt es offene Punkte, die vor der weiteren manuellen Kodierung geklärt werden sollten.';
    }

    if (this.hasVariableCoverageConflicts()) {
      return `${this.variableCoverageOverview?.conflictedVariables || 0} Variablenkonflikte müssen vor der verlässlichen Jobplanung geklärt werden.`;
    }

    if (this.hasManualCodeAvailabilityWarnings) {
      return `${this.manualCodeAvailabilityWarningCount} Variablen haben keine regulären Codes mit manueller Instruktion. Kodierer können dort nur Sonderoptionen wie "Code-Vergabe unsicher" oder "Neuer Code nötig" auswählen.`;
    }

    if ((this.variableCoverageOverview?.missingVariables || 0) > 0) {
      return `${this.variableCoverageOverview?.missingVariables || 0} Variablen sind noch keiner Jobdefinition zugeordnet.`;
    }

    if ((this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return `${this.caseCoverageOverview?.effectiveUnassignedCases || 0} Fälle sind noch nicht in Kodierjobs verteilt.`;
    }

    if (this.isCompletionComplete()) {
      return 'Alle manuellen Kodierungen sind abgeschlossen und final übernommen.';
    }

    if (this.isPlanningReady() && this.hasActiveTrainingCodingJobs()) {
      return `${this.manualFreshnessJobSummary?.activeTrainingJobs || 0} aktive Schulungskodierjob(s) sollten vor der produktiven Durchführung geprüft werden.`;
    }

    if (
      this.isPlanningReady() &&
      !!this.codingProgressOverview &&
      this.hasExecutionOpenWorkForFreshness()
    ) {
      return 'Die Planung ist vollständig. Bearbeiten Sie nun die offenen Kodierfälle im Abschnitt Durchführung.';
    }

    if (this.isPlanningReady() && this.hasOpenDoubleCodingReviewConflicts()) {
      return `${this.openDoubleCodingConflictCount} offene Doppelkodierungs-Konflikt(e) müssen im Review aufgelöst werden.`;
    }

    if (this.isPlanningReady() && this.hasStaleSourceManualJobs()) {
      return `${this.manualFreshnessJobSummary?.staleSourceJobs || 0} Kodierjob(s) enthalten veraltete Quellfälle. Prüfen Sie diese Jobs in der Durchführung, bevor Ergebnisse angewendet oder weitergeführt werden.`;
    }

    if (
      this.isPlanningReady() &&
      !!this.codingProgressOverview &&
      !!this.appliedResultsOverview &&
      this.hasCompletionReadyWorkForFreshness()
    ) {
      return this.canShowManualCompletionTab() ?
        'Alle Kodierfälle sind abgeschlossen. Übernehmen Sie nun die Kodierergebnisse in den Datenbestand.' :
        'Alle Kodierfälle sind abgeschlossen. Die Übernahme der Ergebnisse in den Datenbestand bleibt Studienmanager:innen vorbehalten.';
    }

    return 'Prüfen Sie die Antwortanalyse und erstellen Sie danach passende Kodierjob-Definitionen.';
  }

  getPlanningNextStepTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'loading':
        return 'Planungsstand wird geladen';
      case 'warning':
        return this.hasVariableCoverageConflicts() ?
          'Konflikte zuerst klären' :
          'Reguläre Codes ergänzen';
      case 'preparation-required':
        return 'Vorbereitung aktualisieren';
      case 'planning-incomplete':
        return 'Kodierfälle in Jobs verteilen';
      case 'training-ready':
        return 'Schulung prüfen';
      case 'execution-ready':
        return 'Kodierjobs bearbeiten lassen';
      case 'double-coding-review-ready':
        return 'Doppelkodierungen auflösen';
      case 'stale-source-review':
        return 'Veraltete Jobs prüfen';
      case 'completion-ready':
        return this.canShowManualCompletionTab() ?
          'Ergebnisse übernehmen' :
          'Kodierjobs prüfen';
      case 'complete':
        return 'Workflow abgeschlossen';
      case 'progress-unavailable':
        return 'Kodierfortschritt prüfen';
      default:
        return 'Jobdefinition erstellen';
    }
  }

  getPlanningNextStepDescription(): string {
    const availableCases = this.getAvailableCasesForNewJobs();
    const unavailableCases = this.getUnavailableCasesForNewJobs();

    switch (this.getPlanningStatusState()) {
      case 'loading':
        return 'Warten Sie kurz, bis die Planungsdaten aktualisiert sind.';
      case 'warning':
        if (this.hasVariableCoverageConflicts()) {
          return 'Prüfen Sie Variablen, die von mehreren Definitionen mit überlappenden Fällen verwendet werden.';
        }
        return 'Ergänzen Sie bei mindestens einem regulären Code eine manuelle Instruktion oder nehmen Sie die betroffenen Variablen aus der manuellen Auswahl.';
      case 'preparation-required':
        return this.isResponseAnalysisOutdated() ?
          'Aktualisieren Sie Antwortanalyse und Aggregationsgrundlage, bevor die manuelle Zielnavigation fortgesetzt wird.' :
          'Klären Sie offene Vorbereitungsbefunde wie leere Antworten oder Duplikate ohne aktive Aggregation.';
      case 'planning-incomplete':
        if ((this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
          const unavailableHint =
            unavailableCases > 0 ?
              ` ${unavailableCases} Fälle sind bereits in Jobs verteilt oder durch andere Definitionen reserviert.` :
              '';
          return `${this.caseCoverageOverview?.effectiveUnassignedCases || 0} Fälle sind noch nicht in Kodierjobs. Für neue Jobdefinitionen sind aktuell ${availableCases} Fälle verfügbar.${unavailableHint} Danach Definition freigeben und Jobs erstellen.`;
        }
        return 'Ordnen Sie die fehlenden Variablen einer Jobdefinition zu. Danach Definition freigeben und Jobs erstellen.';
      case 'training-ready':
        return 'Es gibt aktive Schulungskodierjobs. Prüfen Sie den Schulungsstand, bevor produktive Kodierjobs im Fokus stehen.';
      case 'execution-ready':
        return 'Die Fälle sind verteilt. Kodierer können nun ihre zugewiesenen Kodierjobs bearbeiten.';
      case 'double-coding-review-ready':
        return 'Es gibt abgeschlossene produktive Kodierjobs mit offenen Doppelkodierungs-Konflikten. Öffnen Sie den Review und lösen Sie die Abweichungen auf.';
      case 'stale-source-review':
        return 'Veraltete Quellfälle werden nicht angewendet. Prüfen Sie die betroffenen Jobs in der Durchführung und aktualisieren Sie sie fachlich passend.';
      case 'completion-ready':
        return this.canShowManualCompletionTab() ?
          'Alle Kodierfälle sind bearbeitet. Übernehmen Sie jetzt die abgeschlossenen Ergebnisse in den Datenbestand.' :
          'Alle Kodierfälle sind bearbeitet. Sie können die abgeschlossenen Kodierjobs in der Durchführung einsehen.';
      case 'complete':
        return 'Alle manuellen Kodierungen wurden abgeschlossen und übernommen.';
      case 'progress-unavailable':
        return 'Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs, bevor Sie fortfahren.';
      default:
        return 'Wählen Sie Variablen oder Bündel sowie Kodierer aus. Eine Definition verteilt noch keine Fälle; erst "Jobs erstellen" legt die Kodierjobs an.';
    }
  }

  getPlanningNextStepActionLabel(): string {
    switch (this.getPlanningStatusState()) {
      case 'warning':
        return this.hasVariableCoverageConflicts() ?
          'Zu den Jobdefinitionen' :
          'Betroffene Variablen ansehen';
      case 'preparation-required':
        return 'Zur Vorbereitung';
      case 'training-ready':
        return 'Zur Schulung';
      case 'execution-ready':
        return 'Zu den Kodierjobs';
      case 'double-coding-review-ready':
        return 'Doppelkodierungsreview öffnen';
      case 'stale-source-review':
        return 'Veraltete Jobs prüfen';
      case 'completion-ready':
        return this.canShowManualCompletionTab() ?
          'Zum Abschluss' :
          'Zu den Kodierjobs';
      case 'complete':
        return this.canShowManualCompletionTab() ?
          'Abschluss ansehen' :
          'Zu den Kodierjobs';
      case 'loading':
      case 'progress-unavailable':
        return 'Aktualisieren';
      default:
        return 'Zu den Jobdefinitionen';
    }
  }

  getPlanningNextStepTargetSection(): string {
    return this.getPlanningNextStepTarget().sectionId;
  }

  getPlanningNextStepTargetTab(): ManualCodingTab {
    return this.getPlanningNextStepTarget().tab;
  }

  private getPlanningNextStepTarget(): ManualFreshnessTarget {
    switch (this.getPlanningStatusState()) {
      case 'preparation-required':
        return {
          tab: 'preparation',
          sectionId: 'manual-preparation',
          action: 'navigate'
        };
      case 'warning':
        return {
          tab: 'planning',
          sectionId: this.hasVariableCoverageConflicts() ?
            'manual-planning' :
            'manual-variable-coverage',
          action: 'navigate'
        };
      case 'training-ready':
        return {
          tab: 'training',
          sectionId: 'manual-support',
          action: 'navigate'
        };
      case 'execution-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'navigate'
        };
      case 'double-coding-review-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'double-coding-review'
        };
      case 'stale-source-review':
        // stale_source jobs are intentionally routed to Durchführung: users inspect
        // the outdated source jobs there before any refresh or apply action.
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'navigate'
        };
      case 'completion-ready':
      case 'complete':
        return {
          tab: this.canShowManualCompletionTab() ? 'completion' : 'execution',
          sectionId: this.canShowManualCompletionTab() ?
            'manual-completion' :
            'manual-execution',
          action: 'navigate'
        };
      default:
        return {
          tab: 'planning',
          sectionId: 'manual-planning',
          action: 'navigate'
        };
    }
  }

  performPlanningNextStep(): void {
    const planningStatusState = this.getPlanningStatusState();
    if (
      planningStatusState === 'loading' ||
      planningStatusState === 'progress-unavailable'
    ) {
      this.refreshManualCodingPlanning();
      return;
    }

    this.followManualFreshnessTarget();
  }

  getPlanningNextStepIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'warning':
        return 'warning';
      case 'preparation-required':
        return 'tune';
      case 'training-ready':
        return 'school';
      case 'execution-ready':
        return 'play_circle';
      case 'double-coding-review-ready':
        return 'compare';
      case 'stale-source-review':
        return 'sync_problem';
      case 'completion-ready':
      case 'complete':
        return 'published_with_changes';
      case 'loading':
      case 'progress-unavailable':
        return 'sync';
      default:
        return 'route';
    }
  }

  get codingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    const warnings = this.allCodingFreshnessWarnings;
    if (this.isCompletionComplete()) {
      return warnings;
    }

    return warnings.filter(item => item.version !== 'v3');
  }

  private get allCodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return (this.codingFreshnessSummary?.items || [])
      .filter(isCodingFreshnessOpenWarning)
      .sort(
        (a, b) => a.version.localeCompare(b.version) || a.state.localeCompare(b.state)
      );
  }

  get hasCodingFreshnessWarnings(): boolean {
    return this.codingFreshnessWarnings.length > 0;
  }

  get manualCodeAvailabilityWarningCount(): number {
    return this.manualCodeAvailabilityWarnings.length;
  }

  get hasManualCodeAvailabilityWarnings(): boolean {
    return this.manualCodeAvailabilityWarningCount > 0;
  }

  get hiddenManualCodeAvailabilityWarningCount(): number {
    return Math.max(
      0,
      this.manualCodeAvailabilityWarningCount -
        this.manualCodeAvailabilityPreviewLimit
    );
  }

  get hasHiddenManualCodeAvailabilityWarnings(): boolean {
    return this.hiddenManualCodeAvailabilityWarningCount > 0;
  }

  getManualCodeAvailabilityPreview(): ManualCodeAvailabilityWarningDto[] {
    return this.manualCodeAvailabilityWarnings.slice(
      0,
      this.manualCodeAvailabilityPreviewLimit
    );
  }

  getVisibleManualCodeAvailabilityWarnings(): ManualCodeAvailabilityWarningDto[] {
    return this.showAllManualCodeAvailabilityWarnings ?
      this.manualCodeAvailabilityWarnings :
      this.getManualCodeAvailabilityPreview();
  }

  toggleManualCodeAvailabilityWarnings(): void {
    this.showAllManualCodeAvailabilityWarnings =
      !this.showAllManualCodeAvailabilityWarnings;
  }

  private setManualCodeAvailabilityWarnings(
    warnings: ManualCodeAvailabilityWarningDto[]
  ): void {
    this.manualCodeAvailabilityWarnings = warnings;
    this.showAllManualCodeAvailabilityWarnings = false;
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
    return (
      this.codingFreshnessWarnings.length > 0 &&
      this.codingFreshnessWarnings.every(item => item.version === 'v3')
    );
  }

  private refreshAggregationDependentViews(
    includeResponseAnalysis = true
  ): void {
    this.loadedManualTabs.clear();
    if (includeResponseAnalysis) {
      this.loadResponseAnalysis({ force: true });
    }
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadCodingProgressOverview();
    this.loadCodingIncompleteVariables();
    this.loadStatusDistributionV2();
    this.reloadCodingJobsList();
    this.loadJobDefinitionsForExport({ force: true });

    if (this.codingJobDefinitionsComponent) {
      this.codingJobDefinitionsComponent.refresh();
    }
  }

  private loadInitialManualCodingState(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.loadManualTabData(this.activeManualTab);
      return;
    }

    this.loadDefaultEmptyResponseMissing(workspaceId);
    this.isLoadingMatchingMode = true;

    this.testPersonCodingService
      .getAggregationSettings(workspaceId)
      .pipe(
        finalize(() => {
          this.isLoadingMatchingMode = false;
          this.focusManualFreshnessTargetIfReady();
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: settings => {
          this.responseMatchingFlags = settings.flags;
          this.persistedResponseMatchingFlags = [...settings.flags];
          this.duplicateAggregationThreshold =
            this.normalizeAggregationThreshold(settings.threshold);
          this.loadManualTabData(this.activeManualTab);
        },
        error: () => {
          this.responseMatchingFlags = [];
          this.persistedResponseMatchingFlags = [];
          this.duplicateAggregationThreshold = 2;
          this.loadManualTabData(this.activeManualTab);
        }
      });
  }

  private loadManualTabData(
    tab: ManualCodingTab,
    options: { reloadCodingJobs?: boolean; forceRefresh?: boolean } = {}
  ): void {
    if (!this.isManualTabAvailable(tab)) {
      return;
    }

    const forceRefresh = options.forceRefresh ?? false;
    if (
      !forceRefresh &&
      !this.autoRefreshManualCodingJobs &&
      this.loadedManualTabs.has(tab)
    ) {
      return;
    }

    this.loadedManualTabs.add(tab);
    const reloadCodingJobs = options.reloadCodingJobs ?? true;
    switch (tab) {
      case 'preparation':
        this.loadResponseAnalysis();
        return;
      case 'planning':
        this.loadVariableCoverageOverview();
        this.loadCaseCoverageOverview();
        this.loadCodingProgressOverview();
        this.loadCodingIncompleteVariables();
        this.loadManualFreshnessDecisionData();
        if (this.autoRefreshManualCodingJobs || forceRefresh) {
          this.loadCodingFreshness({ force: forceRefresh });
        }
        this.loadResponseAnalysisForPlanningIfNeeded();
        return;
      case 'training':
        if (reloadCodingJobs) {
          this.reloadCodingJobsList();
        }
        return;
      case 'execution':
        this.loadCodingProgressOverview();
        this.loadCaseCoverageOverview();
        this.loadWorkspaceKappaSummary();
        if (reloadCodingJobs) {
          this.reloadCodingJobsList();
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

  private loadManualCodingJobRefreshSetting(
    afterSettingLoaded?: () => void
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.autoRefreshManualCodingJobs = true;
      afterSettingLoaded?.();
      return;
    }

    this.workspaceSettingsService
      .getAutoRefreshManualCodingJobs(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.autoRefreshManualCodingJobs = enabled;
        if (!enabled) {
          this.codingFreshnessRequestGeneration += 1;
          this.isLoadingCodingFreshness = false;
        }
        afterSettingLoaded?.();
      });
  }

  private loadManualCodingApplyPermission(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const userId = this.appService.authData.userId;

    if (this.appService.authData.isAdmin || !workspaceId || userId <= 0) {
      const activeTab = this.activeManualTab;
      this.canApplyManualCodingResults =
        this.appService.authData.isAdmin === true;
      this.canManageManualCodingJobs =
        this.appService.authData.isAdmin === true;
      this.keepAvailableManualTabSelected(activeTab);
      this.requestManualFreshnessFocusIfNeeded();
      return;
    }

    this.userBackendService
      .getUsers(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: users => {
          const activeTab = this.activeManualTab;
          const currentUser = users.find(user => user.id === userId);
          const accessLevel = currentUser?.accessLevel ?? 0;
          this.canManageManualCodingJobs = accessLevel >= 2;
          this.canApplyManualCodingResults = accessLevel >= 3;
          this.keepAvailableManualTabSelected(activeTab);
          this.requestManualFreshnessFocusIfNeeded();
        },
        error: () => {
          const activeTab = this.activeManualTab;
          this.canManageManualCodingJobs = false;
          this.canApplyManualCodingResults = false;
          this.keepAvailableManualTabSelected(activeTab);
          this.requestManualFreshnessFocusIfNeeded();
        }
      });
  }

  private canShowManualCompletionTab(): boolean {
    return this.canApplyManualCodingResults;
  }

  private isManualTabAvailable(tab: ManualCodingTab): boolean {
    return this.visibleManualCodingTabs.includes(tab);
  }

  private keepAvailableManualTabSelected(
    previousActiveTab: ManualCodingTab
  ): void {
    if (this.isManualTabAvailable(previousActiveTab)) {
      this.selectedManualTabIndex =
        this.visibleManualCodingTabs.indexOf(previousActiveTab);
      return;
    }

    const executionTabIndex = this.visibleManualCodingTabs.indexOf('execution');
    this.selectedManualTabIndex =
      executionTabIndex >= 0 ? executionTabIndex : 0;
    this.loadManualTabData(this.activeManualTab);
  }

  private requestManualFreshnessFocusIfNeeded(): void {
    if (
      !this.pendingManualFreshnessFocus ||
      this.manualFreshnessPlanningRequested
    ) {
      return;
    }

    this.manualFreshnessPlanningRequested = true;
    this.goToManualTab('planning');
    this.focusManualFreshnessTargetIfReady();
  }

  private focusManualFreshnessTargetIfReady(): void {
    if (
      !this.pendingManualFreshnessFocus ||
      !this.manualFreshnessPlanningRequested ||
      this.isAnyPlanningDataLoading()
    ) {
      return;
    }

    this.pendingManualFreshnessFocus = false;
    this.followManualFreshnessTarget();
  }

  private followManualFreshnessTarget(): void {
    const target = this.getPlanningNextStepTarget();
    this.goToManualTab(target.tab, target.sectionId);

    if (target.action === 'double-coding-review') {
      setTimeout(() => this.openDoubleCodedReviewDialog(), 0);
    }
  }

  private openDoubleCodedReviewDialog(): void {
    const dialogRef = this.dialog.open(DoubleCodedReviewComponent, {
      width: '98vw',
      maxWidth: '100vw',
      height: '95vh',
      maxHeight: '100vh',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.resultsApplied) {
        this.refreshAllStatistics();
        this.reloadCodingJobsList();
      }
    });
  }

  private loadJobDefinitionsForExport(options: { force?: boolean } = {}): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.jobDefinitionsForExport = [];
      this.jobDefinitionsForExportWorkspaceId = undefined;
      this.hasLoadedJobDefinitionsForExport = false;
      this.isLoadingJobDefinitionsForExport = false;
      return;
    }

    if (this.jobDefinitionsForExportWorkspaceId !== workspaceId) {
      this.jobDefinitionsForExport = [];
      this.hasLoadedJobDefinitionsForExport = false;
      this.jobDefinitionsForExportWorkspaceId = workspaceId;
    }

    if (
      !options.force &&
      (this.isLoadingJobDefinitionsForExport ||
        this.hasLoadedJobDefinitionsForExport)
    ) {
      return;
    }

    this.isLoadingJobDefinitionsForExport = true;
    this.codingJobBackendService
      .getJobDefinitions(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          if (this.jobDefinitionsForExportWorkspaceId === workspaceId) {
            this.isLoadingJobDefinitionsForExport = false;
          }
        })
      )
      .subscribe({
        next: definitions => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.jobDefinitionsForExport = definitions;
          this.jobDefinitionsForExportWorkspaceId = workspaceId;
          this.hasLoadedJobDefinitionsForExport = true;
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.jobDefinitionsForExport = [];
          this.jobDefinitionsForExportWorkspaceId = workspaceId;
          this.hasLoadedJobDefinitionsForExport = false;
        }
      });
  }

  private loadCodersForExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.coders = [];
      this.codersForExportWorkspaceId = undefined;
      this.hasLoadedCodersForExport = false;
      this.isLoadingCodersForExport = false;
      return;
    }

    if (this.codersForExportWorkspaceId !== workspaceId) {
      this.coders = [];
      this.hasLoadedCodersForExport = false;
      this.codersForExportWorkspaceId = workspaceId;
    }

    this.isLoadingCodersForExport = true;
    this.coderService
      .getCodersForExport()
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          if (this.codersForExportWorkspaceId === workspaceId) {
            this.isLoadingCodersForExport = false;
          }
        })
      )
      .subscribe({
        next: coders => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.coders = coders;
          this.codersForExportWorkspaceId = workspaceId;
          this.hasLoadedCodersForExport = true;
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          this.coders = [];
          this.codersForExportWorkspaceId = workspaceId;
          this.hasLoadedCodersForExport = false;
        }
      });
  }

  private loadDefaultEmptyResponseMissing(workspaceId: number): void {
    this.emptyResponseMissing = null;
    this.missingsProfileService
      .getMissingsProfileDetails(workspaceId, 'IQB-Standard')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: profile => {
          if (this.appService.selectedWorkspaceId !== workspaceId) {
            return;
          }

          const missing = this.toMissingProfileDto(profile)
            ?.parseMissings()
            .find(entry => entry.id === 'mir');
          if (
            !missing ||
            !Number.isInteger(Number(missing.code)) ||
            !this.hasExplicitScoreProperty(missing) ||
            !this.hasExplicitValidScore(missing.score)
          ) {
            this.emptyResponseMissing = null;
            return;
          }

          this.emptyResponseMissing = {
            code: Number(missing.code),
            score: this.normalizeScore(missing.score)
          };
        },
        error: () => {
          this.emptyResponseMissing = null;
        }
      });
  }

  private toMissingProfileDto(
    profile: MissingsProfilesDto | null
  ): MissingsProfilesDto | null {
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

  getApplyEmptyResponseCodingTooltip(): string {
    if (!this.emptyResponseMissing) {
      return this.translateService.instant(
        'coding-management-manual.response-analysis.apply-empty-coding-tooltip-loading'
      );
    }

    return this.translateService.instant(
      'coding-management-manual.response-analysis.apply-empty-coding-tooltip',
      {
        ...this.emptyResponseMissing,
        score: this.getScoreDisplay(this.emptyResponseMissing.score)
      }
    );
  }

  getScoreDisplay(score: number | null): string | number {
    return score === null ? 'NA' : score;
  }

  private loadCodingFreshness(options: { force?: boolean } = {}): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.codingFreshnessRequestGeneration += 1;
      this.codingFreshnessSummary = null;
      this.isLoadingCodingFreshness = false;
      return;
    }

    if (!options.force && !this.autoRefreshManualCodingJobs) {
      this.codingFreshnessRequestGeneration += 1;
      this.isLoadingCodingFreshness = false;
      return;
    }

    const now = Date.now();
    if (
      !options.force &&
      (this.isLoadingCodingFreshness ||
        (this.codingFreshnessSummary &&
          now - this.lastCodingFreshnessRefreshAt <
            this.codingFreshnessRefreshThrottleMs))
    ) {
      return;
    }

    const requestGeneration = this.codingFreshnessRequestGeneration + 1;
    this.codingFreshnessRequestGeneration = requestGeneration;
    this.isLoadingCodingFreshness = true;
    this.testPersonCodingService
      .getCodingFreshness(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          if (
            this.codingFreshnessRequestGeneration === requestGeneration &&
            this.appService.selectedWorkspaceId === workspaceId
          ) {
            this.isLoadingCodingFreshness = false;
          }
        })
      )
      .subscribe(summary => {
        if (
          this.codingFreshnessRequestGeneration !== requestGeneration ||
          this.appService.selectedWorkspaceId !== workspaceId ||
          (!options.force && !this.autoRefreshManualCodingJobs)
        ) {
          return;
        }

        this.codingFreshnessSummary = summary;
        this.lastCodingFreshnessRefreshAt = Date.now();
      });
  }

  navigateToCodingManagementOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.router.navigate([`/workspace-admin/${workspaceId}/coding/management`]);
  }

  private loadCodingProgressOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingCodingProgress = true;
    this.testPersonCodingService
      .getCodingProgressOverview(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingCodingProgress = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: (overview: CodingProgressOverview | null) => {
          this.codingProgressOverview = overview;
        },
        error: () => {
          this.codingProgressOverview = null;
        }
      });
  }

  private loadManualFreshnessDecisionData(): void {
    this.loadManualFreshnessJobSummary();
  }

  private loadManualFreshnessJobSummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.manualFreshnessJobSummary = null;
      this.openDoubleCodingConflictCount = 0;
      this.isLoadingManualFreshnessJobSummary = false;
      this.isLoadingDoubleCodingConflictSummary = false;
      return;
    }

    this.isLoadingManualFreshnessJobSummary = true;
    this.codingJobBackendService
      .getCodingJobs(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingManualFreshnessJobSummary = false;
          if (this.shouldLoadOpenDoubleCodingConflictSummary()) {
            this.loadOpenDoubleCodingConflictSummary();
            return;
          }

          this.openDoubleCodingConflictCount = 0;
          this.isLoadingDoubleCodingConflictSummary = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: response => {
          this.manualFreshnessJobSummary = this.buildManualFreshnessJobSummary(
            response.data || []
          );
        },
        error: () => {
          this.manualFreshnessJobSummary = null;
        }
      });
  }

  private shouldLoadOpenDoubleCodingConflictSummary(): boolean {
    if (!this.manualFreshnessJobSummary) {
      return false;
    }

    return (
      !this.hasActiveTrainingCodingJobs() && !this.hasOpenProductiveManualJobs()
    );
  }

  private loadOpenDoubleCodingConflictSummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.openDoubleCodingConflictCount = 0;
      this.isLoadingDoubleCodingConflictSummary = false;
      return;
    }

    this.isLoadingDoubleCodingConflictSummary = true;
    this.testPersonCodingService
      .getDoubleCodedVariablesForReview(
        workspaceId,
        1,
        1,
        true,
        true,
        undefined,
        undefined,
        undefined,
        'unresolved',
        'differ'
      )
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingDoubleCodingConflictSummary = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: response => {
          this.openDoubleCodingConflictCount = response.total || 0;
        },
        error: () => {
          this.openDoubleCodingConflictCount = 0;
        }
      });
  }

  private buildManualFreshnessJobSummary(
    jobs: CodingJob[]
  ): ManualFreshnessJobSummary {
    return jobs.reduce<ManualFreshnessJobSummary>(
      (summary, job) => {
        if (job.freshnessStatus === 'stale_source') {
          summary.staleSourceJobs += 1;
        }

        if (this.isTrainingCodingJob(job)) {
          if (this.isActiveCodingJob(job)) {
            summary.activeTrainingJobs += 1;
          }
          return summary;
        }

        if (this.isActiveCodingJob(job)) {
          summary.openProductiveJobs += 1;
          return summary;
        }

        if (
          this.isCompletedManualCodingJob(job) &&
          job.freshnessStatus !== 'stale_source'
        ) {
          summary.completedProductiveJobs += 1;
        }

        return summary;
      },
      {
        activeTrainingJobs: 0,
        openProductiveJobs: 0,
        completedProductiveJobs: 0,
        staleSourceJobs: 0
      }
    );
  }

  private isTrainingCodingJob(job: CodingJob): boolean {
    return !!job.training?.id || !!job.training_id;
  }

  private isActiveCodingJob(job: CodingJob): boolean {
    if (['completed', 'review', 'results_applied'].includes(job.status)) {
      return false;
    }

    return (
      job.status === 'open' ||
      (job.openUnits ?? 0) > 0 ||
      (job.totalUnits ?? 0) > 0
    );
  }

  private isCompletedManualCodingJob(job: CodingJob): boolean {
    if (job.status === 'results_applied') {
      return false;
    }

    if (['completed', 'review'].includes(job.status)) {
      return true;
    }

    const totalUnits = job.totalUnits ?? 0;
    return (
      totalUnits > 0 &&
      (job.openUnits ?? 0) === 0 &&
      (job.codedUnits ?? 0) >= totalUnits
    );
  }

  private loadVariableCoverageOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingVariableCoverage = true;
    this.testPersonCodingService
      .getVariableCoverageOverview(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingVariableCoverage = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: (
          overview: {
            totalVariables: number;
            coveredVariables: number;
            coveredByDraft: number;
            coveredByPendingReview: number;
            coveredByApproved: number;
            conflictedVariables: number;
            missingVariables: number;
            partiallyAbgedeckteVariablen?: number;
            fullyAbgedeckteVariablen?: number;
            coveragePercentage: number;
            variableCaseCounts: {
              unitName: string;
              variableId: string;
              caseCount: number;
            }[];
            coverageByStatus: {
              draft: string[];
              pending_review: string[];
              approved: string[];
              conflicted: Array<{
                variableKey: string;
                conflictingDefinitions: Array<{
                  id: number;
                  status: string;
                }>;
              }>;
            };
            statusTotalVariables?: number;
            coveredSourceVariableCount?: number;
            coveredSourceResponseCount?: number;
          } | null
        ) => {
          this.variableCoverageOverview = overview;
        },
        error: () => {
          this.variableCoverageOverview = null;
        }
      });
  }

  private loadCaseCoverageOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingCaseCoverage = true;
    this.testPersonCodingService
      .getCaseCoverageOverview(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingCaseCoverage = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: (overview: CaseCoverageOverview | null) => {
          this.caseCoverageOverview = overview;
        },
        error: () => {
          this.caseCoverageOverview = null;
        }
      });
  }

  private loadWorkspaceKappaSummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingKappaSummary = true;
    this.testPersonCodingService
      .getWorkspaceCohensKappaSummary(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingKappaSummary = false;
        })
      )
      .subscribe({
        next: (
          summary: {
            coderPairs: Array<{
              coder1Id: number;
              coder1Name: string;
              coder2Id: number;
              coder2Name: string;
              kappa: number | null;
              agreement: number;
              totalSharedResponses: number;
              validPairs: number;
              interpretation: string;
            }>;
            workspaceSummary: {
              totalDoubleCodedResponses: number;
              totalCoderPairs: number;
              averageKappa: number | null;
              variablesIncluded: number;
              codersIncluded: number;
            };
          } | null
        ) => {
          this.workspaceKappaSummary = summary;
        },
        error: () => {
          this.workspaceKappaSummary = null;
        }
      });
  }

  private loadCodingIncompleteVariables(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.codingIncompleteVariables = [];
      this.manualCodingScopeSummary = null;
      this.setManualCodeAvailabilityWarnings([]);
      this.isLoadingCodingIncompleteVariables = false;
      this.isLoadingManualCodeAvailability = false;
      return;
    }

    this.isLoadingCodingIncompleteVariables = true;
    this.codingJobBackendService
      .getCodingIncompleteVariables(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingCodingIncompleteVariables = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: (
          variables: {
            unitName: string;
            variableId: string;
            responseCount: number;
            availableCases?: number;
            uniqueCasesAfterAggregation?: number;
          }[]
        ) => {
          this.codingIncompleteVariables = variables;
          this.loadAppliedResultsOverview();
        },
        error: () => {
          this.codingIncompleteVariables = [];
          this.loadAppliedResultsOverview();
        }
      });

    this.codingJobBackendService
      .getManualCodingScopeSummary(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: summary => {
          this.manualCodingScopeSummary = summary;
        },
        error: () => {
          this.manualCodingScopeSummary = null;
        }
      });

    this.isLoadingManualCodeAvailability = true;
    this.codingJobBackendService
      .getManualCodeAvailabilityWarnings(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingManualCodeAvailability = false;
          this.focusManualFreshnessTargetIfReady();
        })
      )
      .subscribe({
        next: result => {
          this.setManualCodeAvailabilityWarnings(result.warnings || []);
        },
        error: () => {
          this.setManualCodeAvailabilityWarnings([]);
        }
      });
  }

  private loadStatusDistribution(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.statisticsService
      .getCodingStatistics(workspaceId, 'v1')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (statistics: { statusCounts: { [key: string]: number } }) => {
          this.statusDistribution = {
            CODING_INCOMPLETE: statistics.statusCounts['8'] || 0,
            CODING_COMPLETE: statistics.statusCounts['5'] || 0,
            INVALID: statistics.statusCounts['7'] || 0,
            CODING_ERROR: statistics.statusCounts['9'] || 0,
            INTENDED_INCOMPLETE: statistics.statusCounts['12'] || 0
          };
          // Don't call loadAppliedResultsOverview here anymore, waiting for both
        },
        error: () => {
          this.statusDistribution = {
            CODING_INCOMPLETE: 0,
            CODING_COMPLETE: 0,
            INVALID: 0,
            CODING_ERROR: 0
          };
        }
      });
  }

  private loadStatusDistributionV2(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.statisticsService
      .getCodingStatistics(workspaceId, 'v2')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (statistics: CodingStatistics) => {
          this.statusDistributionV2 = {
            CODING_INCOMPLETE: statistics.statusCounts['8'] || 0,
            CODING_COMPLETE: statistics.statusCounts['5'] || 0,
            INVALID: statistics.statusCounts['7'] || 0,
            CODING_ERROR: statistics.statusCounts['9'] || 0,
            INTENDED_INCOMPLETE: statistics.statusCounts['12'] || 0
          };
          this.loadAppliedResultsOverview();
        },
        error: () => {
          this.statusDistributionV2 = {
            CODING_INCOMPLETE: 0,
            CODING_COMPLETE: 0,
            INVALID: 0,
            CODING_ERROR: 0
          };
          this.loadAppliedResultsOverview();
        }
      });
  }

  private loadAppliedResultsOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.appliedResultsOverviewRequestGeneration += 1;
      this.appliedResultsOverviewRequestKey = undefined;
      this.isLoadingAppliedResultsOverview = false;
      return;
    }

    const requestKey = `${workspaceId}`;
    if (
      this.isLoadingAppliedResultsOverview &&
      this.appliedResultsOverviewRequestKey === requestKey
    ) {
      return;
    }

    const requestGeneration = this.appliedResultsOverviewRequestGeneration + 1;
    this.appliedResultsOverviewRequestGeneration = requestGeneration;
    this.appliedResultsOverviewRequestKey = requestKey;
    this.isLoadingAppliedResultsOverview = true;
    this.testPersonCodingService
      .getAppliedResultsOverview(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          if (
            this.isCurrentAppliedResultsOverviewRequest(
              requestKey,
              requestGeneration,
              workspaceId
            )
          ) {
            this.isLoadingAppliedResultsOverview = false;
            this.appliedResultsOverviewRequestKey = undefined;
            this.focusManualFreshnessTargetIfReady();
          }
        })
      )
      .subscribe({
        next: overview => {
          if (
            !this.isCurrentAppliedResultsOverviewRequest(
              requestKey,
              requestGeneration,
              workspaceId
            )
          ) {
            return;
          }

          if (!overview) {
            this.appliedResultsOverview = null;
            return;
          }

          this.appliedResultsOverview = {
            ...overview,
            totalIncompleteVariables: this.codingIncompleteVariables.length,
            finalStatusBreakdown: {
              codingComplete: this.statusDistributionV2.CODING_COMPLETE || 0,
              invalid: this.statusDistributionV2.INVALID || 0,
              codingError: this.statusDistributionV2.CODING_ERROR || 0,
              other: 0
            }
          };
        },
        error: () => {
          if (
            !this.isCurrentAppliedResultsOverviewRequest(
              requestKey,
              requestGeneration,
              workspaceId
            )
          ) {
            return;
          }

          this.appliedResultsOverview = null;
        }
      });
  }

  private isCurrentAppliedResultsOverviewRequest(
    requestKey: string,
    requestGeneration: number,
    workspaceId: number
  ): boolean {
    return (
      this.appliedResultsOverviewRequestKey === requestKey &&
      this.appliedResultsOverviewRequestGeneration === requestGeneration &&
      this.appService.selectedWorkspaceId === workspaceId
    );
  }

  private loadCompletedJobsReadyForApply(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.completedJobsReadyForApply = [];
      this.completedJobsBlockedForReview = [];
      return;
    }

    this.isLoadingCompletedJobsReadyForApply = true;
    this.codingJobBackendService
      .getCodingJobs(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const completedJobs = (response.data || []).filter(job => this.isCodingJobReadyForApply(job)
          );

          if (completedJobs.length === 0) {
            this.completedJobsReadyForApply = [];
            this.completedJobsBlockedForReview = [];
            this.isLoadingCompletedJobsReadyForApply = false;
            return;
          }

          this.codingJobBackendService
            .getBulkCodingProgress(
              workspaceId,
              completedJobs.map(job => job.id)
            )
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: progressByJobId => {
                this.completedJobsReadyForApply = completedJobs.map(job => ({
                  ...job,
                  hasIssues: this.hasCodingIssuesForCompletedJob(
                    job,
                    progressByJobId[job.id]
                  )
                }));
                this.completedJobsBlockedForReview =
                  this.completedJobsReadyForApply.filter(
                    job => job.hasIssues === true
                  );
                this.isLoadingCompletedJobsReadyForApply = false;
              },
              error: () => {
                this.completedJobsReadyForApply = completedJobs;
                this.completedJobsBlockedForReview = completedJobs.filter(
                  job => job.hasIssues === true
                );
                this.isLoadingCompletedJobsReadyForApply = false;
              }
            });
        },
        error: () => {
          this.completedJobsReadyForApply = [];
          this.completedJobsBlockedForReview = [];
          this.isLoadingCompletedJobsReadyForApply = false;
        }
      });
  }

  private hasBlockingCodingIssues(progress?: Record<string, unknown>): boolean {
    if (!progress) {
      return false;
    }

    return Object.values(progress).some(value => {
      if (!value || typeof value !== 'object') {
        return false;
      }

      const savedCode = value as SavedCodeProgress;
      return (
        savedCode.id === -1 ||
        savedCode.id === -2 ||
        savedCode.codingIssueOption === -1 ||
        savedCode.codingIssueOption === -2
      );
    });
  }

  private hasCodingIssuesForCompletedJob(
    job: CodingJob,
    progress?: Record<string, unknown>
  ): boolean {
    if (progress === undefined) {
      return job.hasIssues === true;
    }

    return this.hasBlockingCodingIssues(progress);
  }

  private isCodingJobReadyForApply(job: CodingJob): boolean {
    return (
      ['completed', 'review'].includes(job.status) &&
      job.freshnessStatus !== 'stale_source' &&
      !job.training?.id &&
      !job.training_id
    );
  }

  private performBulkApplyCompletedJobResults(workspaceId: number): void {
    this.isApplyingCodingResults = true;
    const loadingSnack = this.snackBar.open(
      'Wende Ergebnisse für alle abgeschlossenen Kodierjobs an...',
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService
      .bulkApplyCodingResults(workspaceId)
      .pipe(
        finalize(() => {
          this.isApplyingCodingResults = false;
          loadingSnack.dismiss();
        }),
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
    this.loadedManualTabs.clear();
    this.refreshAllStatistics();
    this.loadResponseAnalysis({ force: true });
    this.loadCodingFreshness({ force: true });
    this.reloadCodingJobsList();
  }

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

  onTrainingStart(data: {
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
      .pipe(takeUntil(this.destroy$))
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
          this.loadedManualTabs.clear();
          this.refreshAllStatistics();
          this.reloadCodingJobsList();
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
  get effectiveCodingCases(): number {
    return this.appliedResultsOverview?.totalIncompleteResponses ?? 0;
  }

  get aggregationSavings(): number {
    return this.appliedResultsOverview?.aggregatedDuplicateCases ?? 0;
  }

  get hasDeriveErrorManualCases(): boolean {
    return (
      (this.appliedResultsOverview?.deriveErrorRawTotalResponses ?? 0) > 0 ||
      (this.appliedResultsOverview?.deriveErrorTotalResponses ?? 0) > 0
    );
  }

  get deriveErrorManualCases(): number {
    return this.appliedResultsOverview?.deriveErrorTotalResponses ?? 0;
  }

  get deriveErrorAppliedCases(): number {
    return this.appliedResultsOverview?.deriveErrorAppliedResponses ?? 0;
  }

  get deriveErrorRemainingCases(): number {
    return this.appliedResultsOverview?.deriveErrorRemainingResponses ?? 0;
  }

  get isDuplicateAggregationActive(): boolean {
    return !this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION);
  }

  get responseAnalysisAggregationSavings(): number {
    return this.responseAnalysis?.aggregationSummary?.collapsedCases ?? 0;
  }

  get hasDuplicateFindingsWithoutAggregation(): boolean {
    return (
      !!this.responseAnalysis &&
      !this.responseAnalysis.aggregationSummary.aggregationActive &&
      this.responseAnalysis.duplicateValues.total > 0
    );
  }

  getVariableEffectiveCaseCount(variable: {
    responseCount: number;
    uniqueCasesAfterAggregation?: number;
  }): number {
    return variable.uniqueCasesAfterAggregation ?? variable.responseCount;
  }

  get effectiveSingleCodedCases(): number {
    if (!this.caseCoverageOverview) {
      return 0;
    }

    return Math.max(
      0,
      this.caseCoverageOverview.effectiveCasesInJobs -
        this.caseCoverageOverview.doubleCodedCases
    );
  }

  getStatusLabel(status: string): string {
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

  private loadResponseMatchingMode(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingMatchingMode = true;
    this.testPersonCodingService
      .getAggregationSettings(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: settings => {
          this.responseMatchingFlags = settings.flags;
          this.persistedResponseMatchingFlags = [...settings.flags];
          this.duplicateAggregationThreshold =
            this.normalizeAggregationThreshold(settings.threshold);
          this.isLoadingMatchingMode = false;
        },
        error: () => {
          this.responseMatchingFlags = [];
          this.persistedResponseMatchingFlags = [];
          this.isLoadingMatchingMode = false;
        }
      });
  }

  private loadAggregationThreshold(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      // Fall back to loading analysis with the default threshold
      this.loadResponseAnalysis();
      return;
    }

    this.testPersonCodingService
      .getAggregationSettings(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: settings => {
          this.responseMatchingFlags = settings.flags;
          this.persistedResponseMatchingFlags = [...settings.flags];
          this.duplicateAggregationThreshold =
            this.normalizeAggregationThreshold(settings.threshold);
          this.loadResponseAnalysis();
        },
        error: () => {
          // Use the default threshold and still load the analysis
          this.loadResponseAnalysis();
        }
      });
  }

  hasMatchingFlag(flag: ResponseMatchingFlag): boolean {
    return this.responseMatchingFlags.includes(flag);
  }

  hasUnsavedResponseMatchingChanges(): boolean {
    return !this.areMatchingFlagsEqual(
      this.getPersistableResponseMatchingFlags(),
      this.persistedResponseMatchingFlags
    );
  }

  hasPendingAggregationOptionsWithoutAggregation(): boolean {
    return (
      this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION) &&
      this.getSelectedAggregationOptionFlags().length > 0
    );
  }

  onAggregationModeChanged(aggregateResponses: boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.isLoadingMatchingMode ||
      this.isSavingMatchingMode ||
      this.isApplyingDuplicateAggregation ||
      this.isLoadingResponseAnalysis ||
      this.responseAnalysis?.isCalculating ||
      aggregateResponses === this.isDuplicateAggregationActive
    ) {
      return;
    }

    const rollbackFlags = [...this.responseMatchingFlags];
    const optionFlags = this.getSelectedAggregationOptionFlags();
    this.responseMatchingFlags = this.buildLocalResponseMatchingFlags(
      aggregateResponses,
      optionFlags
    );
    this.emptyPageIndex = 0;
    this.duplicatePageIndex = 0;
    this.restartAnalysis(rollbackFlags);
  }

  toggleMatchingFlag(flag: ResponseMatchingFlag): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.isLoadingMatchingMode ||
      this.isSavingMatchingMode ||
      this.isApplyingDuplicateAggregation
    ) {
      return;
    }

    if (flag === ResponseMatchingFlag.NO_AGGREGATION) {
      this.onAggregationModeChanged(this.hasMatchingFlag(flag));
      return;
    }

    const selectedOptionFlags = this.getSelectedAggregationOptionFlags();
    const nextOptionFlags = selectedOptionFlags.includes(flag) ?
      selectedOptionFlags.filter(f => f !== flag) :
      [...selectedOptionFlags, flag];

    this.responseMatchingFlags = this.buildLocalResponseMatchingFlags(
      this.isDuplicateAggregationActive,
      nextOptionFlags
    );
    this.emptyPageIndex = 0;
    this.duplicatePageIndex = 0;
  }

  private getSelectedAggregationOptionFlags(
    flags: ResponseMatchingFlag[] = this.responseMatchingFlags
  ): ResponseMatchingFlag[] {
    return this.aggregationOptionFlags.filter(flag => flags.includes(flag));
  }

  private buildLocalResponseMatchingFlags(
    aggregateResponses: boolean,
    optionFlags: ResponseMatchingFlag[]
  ): ResponseMatchingFlag[] {
    const selectedOptionFlags =
      this.getSelectedAggregationOptionFlags(optionFlags);
    return aggregateResponses ?
      selectedOptionFlags :
      [ResponseMatchingFlag.NO_AGGREGATION, ...selectedOptionFlags];
  }

  private getPersistableResponseMatchingFlags(
    flags: ResponseMatchingFlag[] = this.responseMatchingFlags
  ): ResponseMatchingFlag[] {
    const selectedOptionFlags = this.getSelectedAggregationOptionFlags(flags);
    return flags.includes(ResponseMatchingFlag.NO_AGGREGATION) ?
      [ResponseMatchingFlag.NO_AGGREGATION] :
      selectedOptionFlags;
  }

  private buildResponseMatchingFlagsAfterSettingsSave(
    savedFlags: ResponseMatchingFlag[],
    localFlagsAfterSave: ResponseMatchingFlag[]
  ): ResponseMatchingFlag[] {
    return this.buildLocalResponseMatchingFlags(
      !savedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
      this.getSelectedAggregationOptionFlags(localFlagsAfterSave)
    );
  }

  private saveResponseMatchingMode(
    flags: ResponseMatchingFlag[],
    options: {
      localFlagsAfterSave?: ResponseMatchingFlag[];
      rollbackFlags?: ResponseMatchingFlag[];
      showSuccessMessage?: boolean;
    } = {}
  ): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const rollbackFlags = options.rollbackFlags ?
      [...options.rollbackFlags] :
      [...this.persistedResponseMatchingFlags];
    const localFlagsAfterSave = options.localFlagsAfterSave ?
      [...options.localFlagsAfterSave] :
      undefined;
    const showSuccessMessage = options.showSuccessMessage ?? true;

    this.isSavingMatchingMode = true;
    return this.testPersonCodingService
      .saveAggregationSettings(
        workspaceId,
        this.normalizeAggregationThreshold(this.duplicateAggregationThreshold),
        flags
      )
      .pipe(
        map(result => {
          if (!result.success) {
            throw new Error(result.message);
          }
          return result;
        }),
        tap({
          next: result => {
            this.persistedResponseMatchingFlags = [...result.flags];
            this.responseMatchingFlags = localFlagsAfterSave ?? result.flags;
            this.duplicateAggregationThreshold =
              this.normalizeAggregationThreshold(result.threshold);
            if (showSuccessMessage) {
              this.showSuccess(
                this.translateService.instant(
                  'coding-management-manual.response-matching.save-success'
                )
              );
            }
          },
          error: () => {
            this.responseMatchingFlags = rollbackFlags;
            this.isSavingMatchingMode = false;
            this.showError(
              this.translateService.instant(
                'coding-management-manual.response-matching.save-error'
              )
            );
          }
        }),
        finalize(() => {
          this.isSavingMatchingMode = false;
        }),
        map(() => undefined)
      );
  }

  private onResponseMatchingModeChanged(): void {
    this.restartAnalysis();
    this.refreshAggregationDependentViews(false);
  }

  private areMatchingFlagsEqual(
    previous: ResponseMatchingFlag[],
    current: ResponseMatchingFlag[]
  ): boolean {
    if (previous.length !== current.length) {
      return false;
    }
    return previous.every(flag => current.includes(flag));
  }

  loadResponseAnalysis(options: ResponseAnalysisLoadOptions = {}): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.responseAnalysisRequestGeneration += 1;
      this.isLoadingResponseAnalysis = false;
      this.responseAnalysisRequestKey = undefined;
      return;
    }

    const requestKey = this.getResponseAnalysisRequestKey(workspaceId);
    if (
      !options.force &&
      this.isLoadingResponseAnalysis &&
      this.responseAnalysisRequestKey === requestKey
    ) {
      return;
    }

    if (this.analysisPollingTimer) {
      clearTimeout(this.analysisPollingTimer);
      this.analysisPollingTimer = undefined;
    }

    const requestGeneration = this.responseAnalysisRequestGeneration + 1;
    this.responseAnalysisRequestGeneration = requestGeneration;
    this.responseAnalysisRequestKey = requestKey;
    this.isLoadingResponseAnalysis = true;
    this.responseAnalysisError = null;
    this.testPersonCodingService
      .getResponseAnalysis(
        workspaceId,
        this.normalizeAggregationThreshold(this.duplicateAggregationThreshold),
        this.emptyPageIndex + 1,
        this.emptyPageSize,
        this.duplicatePageIndex + 1,
        this.duplicatePageSize
      )
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          if (this.isCurrentResponseAnalysisRequest(
            requestKey,
            requestGeneration
          )) {
            this.isLoadingResponseAnalysis = false;
            this.responseAnalysisRequestKey = undefined;
          }
        })
      )
      .subscribe({
        next: (analysis: ResponseAnalysisDto & { isCalculating?: boolean }) => {
          if (!this.isCurrentResponseAnalysisRequest(
            requestKey,
            requestGeneration
          )) {
            return;
          }

          this.responseAnalysis = analysis;
          this.responseAnalysisError = null;
          this.focusManualFreshnessTargetIfReady();

          if (analysis.isCalculating) {
            this.analysisPollingTimer = setTimeout(() => {
              if (this.responseAnalysis?.isCalculating) {
                this.loadResponseAnalysis();
              }
            }, this.responseAnalysisPollingDelayMs);
          }
        },
        error: error => {
          if (!this.isCurrentResponseAnalysisRequest(
            requestKey,
            requestGeneration
          )) {
            return;
          }

          this.focusManualFreshnessTargetIfReady();
          this.responseAnalysis = null;
          this.responseAnalysisError = `Fehler beim Laden der Antwortanalyse: ${error.message || error}`;
          this.snackBar.open(this.responseAnalysisError, 'OK', {
            duration: 3000
          });
        }
      });
  }

  private isCurrentResponseAnalysisRequest(
    requestKey: string,
    requestGeneration: number
  ): boolean {
    return (
      this.responseAnalysisRequestKey === requestKey &&
      this.responseAnalysisRequestGeneration === requestGeneration
    );
  }

  private getResponseAnalysisRequestKey(workspaceId: number): string {
    return [
      workspaceId,
      this.normalizeAggregationThreshold(this.duplicateAggregationThreshold),
      this.emptyPageIndex + 1,
      this.emptyPageSize,
      this.duplicatePageIndex + 1,
      this.duplicatePageSize
    ].join(':');
  }

  restartAnalysis(
    rollbackResponseMatchingFlags?: ResponseMatchingFlag[]
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    const targetMatchingFlags = this.getPersistableResponseMatchingFlags();
    const localFlagsAfterSave = [...this.responseMatchingFlags];
    const shouldSaveMatchingMode = !this.areMatchingFlagsEqual(
      targetMatchingFlags,
      this.persistedResponseMatchingFlags
    );
    const shouldRefreshAggregationDependentViews = shouldSaveMatchingMode;
    let settingsReadyForAnalysis = !shouldSaveMatchingMode;

    this.responseAnalysisRequestGeneration += 1;
    this.responseAnalysisRequestKey = undefined;
    this.isLoadingResponseAnalysis = true;
    this.responseAnalysisError = null;
    const saveMatchingMode$ = shouldSaveMatchingMode ?
      this.saveResponseMatchingMode(targetMatchingFlags, {
        localFlagsAfterSave,
        rollbackFlags: rollbackResponseMatchingFlags,
        showSuccessMessage: false
      }) :
      of(undefined);

    saveMatchingMode$
      .pipe(
        tap(() => {
          settingsReadyForAnalysis = true;
        }),
        switchMap(() => this.codingJobBackendService.triggerResponseAnalysis(
          workspaceId,
          this.normalizeAggregationThreshold(
            this.duplicateAggregationThreshold
          )
        )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.snackBar.open('Antwortanalyse wurde gestartet.', 'OK', {
            duration: 3000
          });
          if (shouldRefreshAggregationDependentViews) {
            this.refreshAggregationDependentViews(false);
          }
          this.loadResponseAnalysis({ force: true }); // Start polling
        },
        error: error => {
          this.isLoadingResponseAnalysis = false;
          if (settingsReadyForAnalysis) {
            this.snackBar.open(
              `Fehler beim Starten der Antwortanalyse: ${error.message || error}`,
              'OK',
              { duration: 3000 }
            );
          }
        }
      });
  }

  refreshResponseAnalysis(): void {
    this.loadResponseAnalysis({ force: true });
  }

  toggleEmptyResponsesDetails(): void {
    this.showEmptyResponsesDetails = !this.showEmptyResponsesDetails;
  }

  toggleDuplicateValuesDetails(): void {
    this.showDuplicateValuesDetails = !this.showDuplicateValuesDetails;
  }

  onApplyEmptyResponseCoding(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.responseAnalysis || !this.emptyResponseMissing) {
      return;
    }

    const uncodedCount = this.getUncodedCount();
    if (uncodedCount === 0) {
      return;
    }

    const emptyResponseMissing = this.emptyResponseMissing;

    // Show Material Dialog confirmation
    const dialogRef = this.dialog.open(ApplyEmptyCodingDialogComponent, {
      width: '550px',
      data: {
        count: uncodedCount,
        code: emptyResponseMissing.code,
        score: emptyResponseMissing.score
      }
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((confirmed: unknown) => {
        if (!confirmed) {
          return;
        }

        this.isApplyingEmptyCoding = true;

        this.testPersonCodingService
          .applyEmptyResponseCoding(workspaceId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (result: {
              success: boolean;
              updatedCount: number;
              message: string;
            }) => {
              this.isApplyingEmptyCoding = false;

              if (result.success) {
                this.showSuccess(
                  this.translateService.instant(
                    'coding-management-manual.response-analysis.apply-empty-coding-success',
                    { count: result.updatedCount }
                  )
                );

                // Refresh analysis and statistics
                this.restartAnalysis();
                this.refreshAllStatistics();
              } else {
                this.showError(
                  this.translateService.instant(
                    'coding-management-manual.response-analysis.apply-empty-coding-error',
                    { error: result.message }
                  )
                );
              }
            },
            error: () => {
              this.isApplyingEmptyCoding = false;
              this.showError(
                this.translateService.instant(
                  'coding-management-manual.response-analysis.apply-empty-coding-error',
                  { error: 'Unbekannter Fehler' }
                )
              );
            }
          });
      });
  }

  onApplyDuplicateAggregation(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.responseAnalysis) {
      return;
    }

    // Filter groups that meet the threshold
    const groupsMeetingThreshold =
      this.responseAnalysis.duplicateValues.groups.filter(
        group => (group.occurrenceCount ?? group.occurrences.length) >=
          this.duplicateAggregationThreshold
      );

    if (groupsMeetingThreshold.length === 0) {
      this.showError(
        this.translateService.instant(
          'coding-management-manual.duplicate-aggregation.no-groups-meet-threshold',
          { threshold: this.duplicateAggregationThreshold }
        )
      );
      return;
    }

    const totalResponsesInGroups = groupsMeetingThreshold.reduce(
      (sum, group) => sum + (group.occurrenceCount ?? group.occurrences.length),
      0
    );

    // Show confirmation dialog
    const dialogData: ApplyDuplicateAggregationDialogData = {
      duplicateGroups: groupsMeetingThreshold.length,
      totalResponses: totalResponsesInGroups,
      threshold: this.duplicateAggregationThreshold
    };

    const dialogRef = this.dialog.open(
      ApplyDuplicateAggregationDialogComponent,
      {
        width: '550px',
        data: dialogData
      }
    );

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((confirmed: unknown) => {
        if (!confirmed) {
          return;
        }

        this.isApplyingDuplicateAggregation = true;

        this.testPersonCodingService
          .applyDuplicateAggregation(
            workspaceId,
            this.duplicateAggregationThreshold,
            true
          )
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: result => {
              this.isApplyingDuplicateAggregation = false;

              if (result.success) {
                this.showSuccess(
                  this.translateService.instant(
                    'coding-management-manual.duplicate-aggregation.success',
                    {
                      aggregatedResponses: result.aggregatedResponses,
                      aggregatedGroups: result.aggregatedGroups,
                      uniqueCases: result.uniqueCodingCases
                    }
                  )
                );

                // Sync with matching flag: Clear 'NO_AGGREGATION' when applying
                this.saveResponseMatchingMode(
                  this.responseMatchingFlags.filter(
                    f => f !== ResponseMatchingFlag.NO_AGGREGATION
                  )
                )
                  .pipe(takeUntil(this.destroy$))
                  .subscribe(() => {
                    this.onResponseMatchingModeChanged();
                  });
              } else {
                this.showError(
                  this.translateService.instant(
                    'coding-management-manual.duplicate-aggregation.error',
                    { error: result.message }
                  )
                );
              }
            },
            error: () => {
              this.isApplyingDuplicateAggregation = false;
              this.showError(
                this.translateService.instant(
                  'coding-management-manual.duplicate-aggregation.error',
                  { error: 'Unbekannter Fehler' }
                )
              );
            }
          });
      });
  }

  onDeactivateDuplicateAggregation(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translateService.instant(
          'coding-management-manual.duplicate-aggregation.deactivate-dialog-title'
        ),
        message: this.translateService.instant(
          'coding-management-manual.duplicate-aggregation.deactivate-confirm'
        ),
        confirmButtonText: this.translateService.instant(
          'coding-management-manual.duplicate-aggregation.deactivate-confirm-button'
        ),
        cancelButtonText: this.translateService.instant(
          'coding-management-manual.duplicate-aggregation.cancel'
        )
      }
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe((confirmed: unknown) => {
        if (!confirmed) {
          return;
        }

        this.isApplyingDuplicateAggregation = true;

        this.testPersonCodingService
          .applyDuplicateAggregation(
            workspaceId,
            this.duplicateAggregationThreshold,
            false // Deactivate
          )
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: result => {
              this.isApplyingDuplicateAggregation = false;

              if (result.success) {
                this.showSuccess(result.message);

                // Sync with matching flag: Set 'NO_AGGREGATION' when deactivating
                this.saveResponseMatchingMode([
                  ResponseMatchingFlag.NO_AGGREGATION
                ])
                  .pipe(takeUntil(this.destroy$))
                  .subscribe(() => {
                    this.onResponseMatchingModeChanged();
                  });
              } else {
                this.showError(result.message);
              }
            },
            error: () => {
              this.isApplyingDuplicateAggregation = false;
              this.showError('Fehler beim Deaktivieren der Aggregation');
            }
          });
      });
  }

  onThresholdChanged(newValue: number | string | null): void {
    if (this.responseAnalysis?.isCalculating) {
      return;
    }
    const normalizedValue = this.normalizeAggregationThreshold(newValue);
    if (this.duplicateAggregationThreshold !== normalizedValue) {
      this.duplicateAggregationThreshold = normalizedValue;
    }
    this.emptyPageIndex = 0;
    this.duplicatePageIndex = 0;
    this.thresholdChangeSubject.next(normalizedValue);
  }

  onEmptyPageChange(event: PageEvent): void {
    this.emptyPageIndex = event.pageIndex;
    this.emptyPageSize = event.pageSize;
    this.loadResponseAnalysis();
  }

  onDuplicatePageChange(event: PageEvent): void {
    this.duplicatePageIndex = event.pageIndex;
    this.duplicatePageSize = event.pageSize;
    this.loadResponseAnalysis();
  }

  hasUncodedEmptyResponses(): boolean {
    return (this.responseAnalysis?.emptyResponses?.totalUncoded || 0) > 0;
  }

  getUncodedCount(): number {
    return this.responseAnalysis?.emptyResponses?.totalUncoded || 0;
  }

  private normalizeAggregationThreshold(
    value: number | string | null | undefined
  ): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 2;
    }
    return Math.min(100, Math.max(2, Math.round(numericValue)));
  }
}
