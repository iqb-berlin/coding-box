import {
  Component, OnDestroy, OnInit, inject, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  Subject, takeUntil, debounceTime, finalize, Observable, of, switchMap, tap
} from 'rxjs';
import { PageEvent, MatPaginatorModule } from '@angular/material/paginator';
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
import { ApplyEmptyCodingDialogComponent } from './apply-empty-coding-dialog.component';
import {
  ApplyDuplicateAggregationDialogComponent,
  ApplyDuplicateAggregationDialogData
} from './apply-duplicate-aggregation-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { Coder } from '../../models/coder.model';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';
import {
  WorkspaceSettingsService,
  ResponseMatchingFlag
} from '../../../ws-admin/services/workspace-settings.service';
import { CodingStatistics } from '../../../../../../../api-dto/coding/coding-statistics';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';

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
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule
  ]
})
export class CodingManagementManualComponent implements OnInit, OnDestroy {
  @ViewChild(CodingJobsComponent) codingJobsComponent?: CodingJobsComponent;
  @ViewChild(CodingJobDefinitionsComponent)
    codingJobDefinitionsComponent?: CodingJobDefinitionsComponent;

  @ViewChild(CoderTrainingsListComponent)
    coderTrainingsListComponent?: CoderTrainingsListComponent;

  private testPersonCodingService = inject(TestPersonCodingService);
  private codingJobBackendService = inject(CodingJobBackendService);
  private statisticsService = inject(CodingStatisticsService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private validationStateService = inject(ValidationStateService);
  private translateService = inject(TranslateService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private dialog = inject(MatDialog);
  private destroy$ = new Subject<void>();

  validationProgress: ValidationProgress | null = null;
  isLoading = false;

  // Granular loading states
  isLoadingVariableCoverage = false;
  isLoadingCaseCoverage = false;
  isLoadingCodingProgress = false;
  isLoadingKappaSummary = false;

  // Response matching mode configuration
  responseMatchingFlags: ResponseMatchingFlag[] = [];
  isLoadingMatchingMode = false;
  isSavingMatchingMode = false;
  ResponseMatchingFlag = ResponseMatchingFlag; // Expose enum to template

  // Response analysis data
  responseAnalysis: {
    emptyResponses: {
      total: number;
      items: {
        unitName: string;
        unitAlias: string | null;
        variableId: string;
        personLogin: string;
        personCode: string;
        personGroup: string;
        bookletName: string;
        responseId: number;
        value: string | null;
      }[];
    };
    duplicateValues: {
      total: number;
      totalResponses: number;
      groups: {
        unitName: string;
        unitAlias: string | null;
        variableId: string;
        normalizedValue: string;
        originalValue: string;
        occurrences: {
          personLogin: string;
          personCode: string;
          bookletName: string;
          responseId: number;
          value: string;
        }[];
      }[];
      isAggregationApplied: boolean;
    };
    matchingFlags: string[];
    analysisTimestamp: string;
    isCalculating?: boolean;
    progress?: number;
  } | null = null;

  isLoadingResponseAnalysis = false;
  showEmptyResponsesDetails = false;
  showDuplicateValuesDetails = false;
  isApplyingEmptyCoding = false;

  // Duplicate aggregation state
  duplicateAggregationThreshold = 2;
  isApplyingDuplicateAggregation = false;

  emptyPageIndex = 0;
  emptyPageSize = 50;
  duplicatePageIndex = 0;
  duplicatePageSize = 50;

  // Debouncing for job definition changes
  private jobDefinitionChangeSubject = new Subject<void>();

  private thresholdChangeSubject = new Subject<number>();

  private statisticsRefreshSubject = new Subject<void>();

  codingProgressOverview: {
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
  } | null = null;

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
  } | null = null;

  caseCoverageOverview: {
    totalCasesToCode: number;
    casesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    coveragePercentage: number;
  } | null = null;

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
  }[] = [];

  statusDistribution: { [status: string]: number } = {};
  statusDistributionV2: { [status: string]: number } = {};
  appliedResultsOverview: {
    totalIncompleteVariables: number;
    totalIncompleteResponses: number;
    appliedResponses: number;
    remainingResponses: number;
    completionPercentage: number;
    finalStatusBreakdown: {
      codingComplete: number;
      invalid: number;
      codingError: number;
      other: number;
    };
  } | null = null;

  showCoderTraining = false;
  editTraining: CoderTraining | null = null;

  expectedCombinations: ExpectedCombinationDto[] = [];

  ngOnInit(): void {
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

    // Set up debounced statistics refresh
    this.jobDefinitionChangeSubject
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshAllStatistics();
        if (this.coderTrainingsListComponent) {
          this.coderTrainingsListComponent.loadCoderTrainings();
        }
      });

    // Auto-apply aggregation when threshold changes
    this.thresholdChangeSubject
      .pipe(
        debounceTime(800), // Wait for user to stop typing
        takeUntil(this.destroy$)
      )
      .subscribe((threshold: number) => {
        const workspaceId = this.appService.selectedWorkspaceId;
        if (workspaceId) {
          this.workspaceSettingsService.setAggregationThreshold(workspaceId, threshold)
            .pipe(takeUntil(this.destroy$))
            .subscribe();
        }
        this.processAutoApplyAggregation(threshold);
      });

    this.loadCodingProgressOverview();
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadWorkspaceKappaSummary();
    this.loadCodingIncompleteVariables();
    this.loadStatusDistribution();
    this.loadStatusDistributionV2();
    this.loadAppliedResultsOverview();
    this.loadResponseMatchingMode();
    this.loadAggregationThreshold();
    this.loadResponseAnalysis();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    this.jobDefinitionChangeSubject.complete();
    this.statisticsRefreshSubject.complete();
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

    this.processExternalCodingFile(file);
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
    this.validationStateService.startValidation();

    try {
      const workspaceId = this.appService.selectedWorkspaceId;

      if (!workspaceId) {
        const errorMsg = this.translateService.instant(
          'coding-management-manual.errors.no-workspace-selected'
        );
        this.showError(errorMsg);
        this.validationStateService.setValidationError(errorMsg);
        return;
      }

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
          previewOnly: true
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
              fileName: file.name
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
    this.loadAppliedResultsOverview();
  }

  reloadCodingJobsList(): void {
    if (this.codingJobsComponent) {
      this.codingJobsComponent.loadCodingJobs();
    }
    if (this.coderTrainingsListComponent) {
      this.coderTrainingsListComponent.loadCoderTrainings();
    }
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
        })
      )
      .subscribe({
        next: (overview: { totalCasesToCode: number; completedCases: number; completionPercentage: number; } | null) => {
          this.codingProgressOverview = overview;
        },
        error: () => {
          this.codingProgressOverview = null;
        }
      });
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
        })
      )
      .subscribe({
        next: (overview: {
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
        } | null) => {
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
        })
      )
      .subscribe({
        next: (overview: {
          totalCasesToCode: number;
          casesInJobs: number;
          doubleCodedCases: number;
          singleCodedCases: number;
          unassignedCases: number;
          coveragePercentage: number;
        } | null) => {
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
        next: (summary: {
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
        } | null) => {
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
      return;
    }

    this.codingJobBackendService
      .getCodingIncompleteVariables(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (
          variables: {
            unitName: string;
            variableId: string;
            responseCount: number;
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
    if (this.codingIncompleteVariables.length > 0) {
      const totalIncompleteResponses = this.codingIncompleteVariables.reduce(
        (sum, variable) => sum + variable.responseCount,
        0
      );
      const workspaceId = this.appService.selectedWorkspaceId;
      if (workspaceId) {
        this.codingJobBackendService
          .getAppliedResultsCount(workspaceId, this.codingIncompleteVariables)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (appliedResponses: number) => {
              const remainingResponses =
                totalIncompleteResponses - appliedResponses;
              const completionPercentage =
                totalIncompleteResponses > 0 ?
                  (appliedResponses / totalIncompleteResponses) * 100 :
                  0;

              this.appliedResultsOverview = {
                totalIncompleteVariables: this.codingIncompleteVariables.length,
                totalIncompleteResponses: totalIncompleteResponses,
                appliedResponses: appliedResponses,
                remainingResponses: Math.max(0, remainingResponses),
                completionPercentage: Math.min(100, completionPercentage),
                finalStatusBreakdown: {
                  codingComplete: this.statusDistributionV2.CODING_COMPLETE || 0,
                  invalid: this.statusDistributionV2.INVALID || 0,
                  codingError: this.statusDistributionV2.CODING_ERROR || 0,
                  other: 0
                }
              };
            },
            error: () => {
              const appliedResponses =
                (this.statusDistributionV2.CODING_COMPLETE || 0) +
                (this.statusDistributionV2.INVALID || 0) +
                (this.statusDistributionV2.CODING_ERROR || 0);

              const remainingResponses =
                totalIncompleteResponses - appliedResponses;
              const completionPercentage =
                totalIncompleteResponses > 0 ?
                  (appliedResponses / totalIncompleteResponses) * 100 :
                  0;

              this.appliedResultsOverview = {
                totalIncompleteVariables: this.codingIncompleteVariables.length,
                totalIncompleteResponses: totalIncompleteResponses,
                appliedResponses: appliedResponses,
                remainingResponses: Math.max(0, remainingResponses),
                completionPercentage: Math.min(100, completionPercentage),
                finalStatusBreakdown: {
                  codingComplete: this.statusDistributionV2.CODING_COMPLETE || 0,
                  invalid: this.statusDistributionV2.INVALID || 0,
                  codingError: this.statusDistributionV2.CODING_ERROR || 0,
                  other: 0 // Could be expanded to include other statuses
                }
              };
            }
          });
      }
    }
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
          this.refreshAllStatistics();
          this.reloadCodingJobsList();
        },
        error: () => {
          this.showError('Fehler beim Generieren der Kodierer-Schulungspakete');
        }
      });
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
    this.workspaceSettingsService
      .getResponseMatchingMode(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (flags: ResponseMatchingFlag[]) => {
          this.responseMatchingFlags = flags;
          this.isLoadingMatchingMode = false;
        },
        error: () => {
          this.responseMatchingFlags = [];
          this.isLoadingMatchingMode = false;
        }
      });
  }

  private loadAggregationThreshold(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.workspaceSettingsService
      .getAggregationThreshold(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((threshold: number) => {
        this.duplicateAggregationThreshold = threshold;
      });
  }

  hasMatchingFlag(flag: ResponseMatchingFlag): boolean {
    return this.responseMatchingFlags.includes(flag);
  }

  toggleMatchingFlag(flag: ResponseMatchingFlag): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingResponseAnalysis = true;

    let newFlags: ResponseMatchingFlag[];

    if (flag === ResponseMatchingFlag.NO_AGGREGATION) {
      if (this.hasMatchingFlag(flag)) {
        newFlags = [];
      } else {
        newFlags = [ResponseMatchingFlag.NO_AGGREGATION];
      }
    } else {
      newFlags = this.responseMatchingFlags.filter(
        f => f !== ResponseMatchingFlag.NO_AGGREGATION
      );
      if (this.hasMatchingFlag(flag)) {
        newFlags = newFlags.filter(f => f !== flag);
      } else {
        newFlags = [...newFlags, flag];
      }
    }

    // Determine if we need to apply/revert aggregation (only when toggling NO_AGGREGATION)
    const isAggregationToggle = flag === ResponseMatchingFlag.NO_AGGREGATION;

    // Sequential execution: Save Settings -> (Optional) Apply Aggregation -> Refresh Stats
    this.saveResponseMatchingMode(newFlags, isAggregationToggle)
      .pipe(
        switchMap(() => {
          if (isAggregationToggle) {
            const isNoAggregationSet = newFlags.includes(ResponseMatchingFlag.NO_AGGREGATION);
            // If NO_AGGREGATION is set, we deactivate aggregation (false).
            // If NO_AGGREGATION is NOT set, we activate aggregation (true).
            return this.testPersonCodingService.applyDuplicateAggregation(
              workspaceId,
              this.duplicateAggregationThreshold,
              !isNoAggregationSet
            );
          }
          return of(null);
        }),
        finalize(() => {
          this.isLoadingMatchingMode = false;
          this.isLoadingResponseAnalysis = false;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          // Final refresh after all operations are complete
          this.onResponseMatchingModeChanged();
        },
        error: () => {
          // Error handling is mostly done in the individual methods (toasts)
        }
      });
  }

  private saveResponseMatchingMode(flags: ResponseMatchingFlag[], skipRefresh = false): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    this.isSavingMatchingMode = true;
    return this.workspaceSettingsService
      .setResponseMatchingMode(workspaceId, flags)
      .pipe(
        tap({
          next: () => {
            this.responseMatchingFlags = flags;
            this.isSavingMatchingMode = false;
            this.showSuccess(
              this.translateService.instant(
                'coding-management-manual.response-matching.save-success'
              )
            );

            if (!skipRefresh) {
              this.onResponseMatchingModeChanged();
            }
          },
          error: () => {
            this.isSavingMatchingMode = false;
            this.showError(
              this.translateService.instant(
                'coding-management-manual.response-matching.save-error'
              )
            );
          }
        }),
        switchMap(() => of(undefined))
      );
  }

  private onResponseMatchingModeChanged(): void {
    this.restartAnalysis();

    this.loadCodingProgressOverview();
    this.loadCaseCoverageOverview();
    this.loadCodingIncompleteVariables();

    this.reloadCodingJobsList();
    if (this.codingJobDefinitionsComponent) {
      this.codingJobDefinitionsComponent.refresh();
    }
  }

  isMatchingOptionDisabled(flag: ResponseMatchingFlag): boolean {
    if (flag === ResponseMatchingFlag.NO_AGGREGATION) {
      return false;
    }
    return this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION);
  }

  loadResponseAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingResponseAnalysis = true;
    this.testPersonCodingService
      .getResponseAnalysis(
        workspaceId,
        this.duplicateAggregationThreshold,
        this.emptyPageIndex + 1,
        this.emptyPageSize,
        this.duplicatePageIndex + 1,
        this.duplicatePageSize
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (analysis: ResponseAnalysisDto & { isCalculating?: boolean }) => {
          this.responseAnalysis = analysis;
          this.isLoadingResponseAnalysis = false;

          if (analysis.isCalculating) {
            // Poll every 5 seconds if calculating
            setTimeout(() => {
              if (this.responseAnalysis?.isCalculating) {
                this.loadResponseAnalysis();
              }
            }, 5000);
          }
        },
        error: error => {
          this.isLoadingResponseAnalysis = false;
          this.responseAnalysis = null;
          this.snackBar.open(
            `Fehler beim Laden der Antwortanalyse: ${error.message || error}`,
            'OK',
            { duration: 3000 }
          );
        }
      });
  }

  restartAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.isLoadingResponseAnalysis = true;
    this.codingJobBackendService.triggerResponseAnalysis(workspaceId).subscribe({
      next: () => {
        this.snackBar.open('Antwortanalyse wurde gestartet.', 'OK', { duration: 3000 });
        this.loadResponseAnalysis(); // Start polling
      },
      error: error => {
        this.isLoadingResponseAnalysis = false;
        this.snackBar.open(
          `Fehler beim Starten der Antwortanalyse: ${error.message || error}`,
          'OK',
          { duration: 3000 }
        );
      }
    });
  }

  refreshResponseAnalysis(): void {
    this.loadResponseAnalysis();
  }

  toggleEmptyResponsesDetails(): void {
    this.showEmptyResponsesDetails = !this.showEmptyResponsesDetails;
  }

  toggleDuplicateValuesDetails(): void {
    this.showDuplicateValuesDetails = !this.showDuplicateValuesDetails;
  }

  onApplyEmptyResponseCoding(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.responseAnalysis) {
      return;
    }

    const totalResponses = this.responseAnalysis.emptyResponses.total;

    // Show Material Dialog confirmation
    const dialogRef = this.dialog.open(ApplyEmptyCodingDialogComponent, {
      width: '550px',
      data: { count: totalResponses }
    });

    dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((confirmed: unknown) => {
      if (!confirmed) {
        return;
      }

      this.isApplyingEmptyCoding = true;

      this.testPersonCodingService
        .applyEmptyResponseCoding(workspaceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (result: { success: boolean; updatedCount: number; message: string; }) => {
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
    const groupsMeetingThreshold = this.responseAnalysis.duplicateValues.groups.filter(
      group => group.occurrences.length >= this.duplicateAggregationThreshold
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
      (sum, group) => sum + group.occurrences.length,
      0
    );

    // Show confirmation dialog
    const dialogData: ApplyDuplicateAggregationDialogData = {
      duplicateGroups: groupsMeetingThreshold.length,
      totalResponses: totalResponsesInGroups,
      threshold: this.duplicateAggregationThreshold
    };

    const dialogRef = this.dialog.open(ApplyDuplicateAggregationDialogComponent, {
      width: '550px',
      data: dialogData
    });

    dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((confirmed: unknown) => {
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
                this.responseMatchingFlags.filter(f => f !== ResponseMatchingFlag.NO_AGGREGATION)
              );

              // Refresh analysis and statistics
              this.loadResponseAnalysis();
              this.refreshAllStatistics();
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
        title: this.translateService.instant('coding-management-manual.duplicate-aggregation.deactivate-dialog-title'),
        message: this.translateService.instant('coding-management-manual.duplicate-aggregation.deactivate-confirm'),
        confirmButtonText: this.translateService.instant('coding-management-manual.duplicate-aggregation.deactivate-confirm-button'),
        cancelButtonText: this.translateService.instant('coding-management-manual.duplicate-aggregation.cancel')
      }
    });

    dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe((confirmed: unknown) => {
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
              this.saveResponseMatchingMode([ResponseMatchingFlag.NO_AGGREGATION]);

              // Refresh analysis and statistics
              this.loadResponseAnalysis();
              this.refreshAllStatistics();
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

  onThresholdChanged(newValue: number): void {
    this.emptyPageIndex = 0;
    this.duplicatePageIndex = 0;
    this.thresholdChangeSubject.next(newValue);
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

  private processAutoApplyAggregation(threshold: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingResponseAnalysis = true;

    if (!this.responseAnalysis) {
      // If no analysis yet, we still want to apply it later,
      // but we need to wait for the analysis to be loaded first
      // or we just trigger the aggregation which will then reload the analysis.
    }

    // Only apply if "No aggregation" is NOT selected
    if (this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION)) {
      return;
    }

    // Optional: Validate threshold
    if (threshold < 2 || threshold > 100) {
      return;
    }

    this.isApplyingDuplicateAggregation = true;
    this.testPersonCodingService
      .applyDuplicateAggregation(workspaceId, threshold, true)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isApplyingDuplicateAggregation = false;
          this.isLoadingResponseAnalysis = false;
        })
      )
      .subscribe({
        next: (result: {
          success: boolean;
          aggregatedGroups: number;
          aggregatedResponses: number;
          uniqueCodingCases: number;
          message: string;
        }) => {
          if (result.success) {
            this.showSuccess(
              this.translateService.instant('coding-management-manual.duplicate-aggregation.auto-updated') || 'Aggregation aktualisiert'
            );
            this.restartAnalysis();
            this.refreshAllStatistics();
          }
        }
      });
  }
}
