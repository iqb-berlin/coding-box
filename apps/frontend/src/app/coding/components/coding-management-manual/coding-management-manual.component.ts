import { Component, OnDestroy, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Subject, takeUntil, debounceTime, finalize } from 'rxjs';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { CodingJobDefinitionsComponent } from '../coding-job-definitions/coding-job-definitions.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';
import {
  CoderTrainingComponent,
  VariableConfig
} from '../coder-training/coder-training.component';
import { CoderTrainingsListComponent } from '../coder-trainings-list/coder-trainings-list.component';
import {
  ImportComparisonDialogComponent,
  ImportComparisonData
} from '../import-comparison-dialog/import-comparison-dialog.component';
import { Coder } from '../../models/coder.model';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';
import {
  WorkspaceSettingsService,
  ResponseMatchingFlag
} from '../../../ws-admin/services/workspace-settings.service';

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
    MatCheckboxModule
  ]
})
export class CodingManagementManualComponent implements OnInit, OnDestroy {
  @ViewChild(CodingJobsComponent) codingJobsComponent?: CodingJobsComponent;
  @ViewChild(CodingJobDefinitionsComponent)
  codingJobDefinitionsComponent?: CodingJobDefinitionsComponent;

  private testPersonCodingService = inject(TestPersonCodingService);
  private backendService = inject(BackendService);
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
        bookletName: string;
        responseId: number;
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
    };
    matchingFlags: string[];
    analysisTimestamp: string;
  } | null = null;

  isLoadingResponseAnalysis = false;
  showEmptyResponsesDetails = false;
  showDuplicateValuesDetails = false;

  // Debouncing for job definition changes
  private jobDefinitionChangeSubject = new Subject<void>();
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

  expectedCombinations: ExpectedCombinationDto[] = [];

  ngOnInit(): void {
    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe((progress) => {
        this.validationProgress = progress;
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
      });

    this.loadCodingProgressOverview();
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadWorkspaceKappaSummary();
    this.loadCodingIncompleteVariables();
    this.loadStatusDistribution();
    this.loadAppliedResultsOverview();
    this.loadResponseMatchingMode();
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
      reader.onerror = (error) => reject(error);
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
    this.loadAppliedResultsOverview();
  }

  reloadCodingJobsList(): void {
    if (this.codingJobsComponent) {
      this.codingJobsComponent.loadCodingJobs();
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
        next: (overview) => {
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
        next: (overview) => {
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
        next: (overview) => {
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
        next: (summary) => {
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

    this.backendService
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

    this.backendService
      .getCodingStatistics(workspaceId, 'v1')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (statistics) => {
          this.statusDistribution = {
            CODING_INCOMPLETE: statistics.statusCounts['4'] || 0,
            CODING_COMPLETE: statistics.statusCounts['5'] || 0,
            INVALID: statistics.statusCounts['6'] || 0,
            CODING_ERROR: statistics.statusCounts['7'] || 0
          };
          this.loadAppliedResultsOverview();
        },
        error: () => {
          this.statusDistribution = {
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
        this.backendService
          .getAppliedResultsCount(workspaceId, this.codingIncompleteVariables)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (appliedResponses: number) => {
              const remainingResponses =
                totalIncompleteResponses - appliedResponses;
              const completionPercentage =
                totalIncompleteResponses > 0
                  ? (appliedResponses / totalIncompleteResponses) * 100
                  : 0;

              this.appliedResultsOverview = {
                totalIncompleteVariables: this.codingIncompleteVariables.length,
                totalIncompleteResponses: totalIncompleteResponses,
                appliedResponses: appliedResponses,
                remainingResponses: Math.max(0, remainingResponses),
                completionPercentage: Math.min(100, completionPercentage),
                finalStatusBreakdown: {
                  codingComplete: this.statusDistribution.CODING_COMPLETE || 0,
                  invalid: this.statusDistribution.INVALID || 0,
                  codingError: this.statusDistribution.CODING_ERROR || 0,
                  other: 0
                }
              };
            },
            error: () => {
              const appliedResponses =
                (this.statusDistribution.CODING_COMPLETE || 0) +
                (this.statusDistribution.INVALID || 0) +
                (this.statusDistribution.CODING_ERROR || 0);

              const remainingResponses =
                totalIncompleteResponses - appliedResponses;
              const completionPercentage =
                totalIncompleteResponses > 0
                  ? (appliedResponses / totalIncompleteResponses) * 100
                  : 0;

              this.appliedResultsOverview = {
                totalIncompleteVariables: this.codingIncompleteVariables.length,
                totalIncompleteResponses: totalIncompleteResponses,
                appliedResponses: appliedResponses,
                remainingResponses: Math.max(0, remainingResponses),
                completionPercentage: Math.min(100, completionPercentage),
                finalStatusBreakdown: {
                  codingComplete: this.statusDistribution.CODING_COMPLETE || 0,
                  invalid: this.statusDistribution.INVALID || 0,
                  codingError: this.statusDistribution.CODING_ERROR || 0,
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
        next: (packages) => {
          const totalResponses = packages.reduce(
            (total, pkg) => total + pkg.responses.length,
            0
          );

          this.showSuccess(
            `Schulung erfolgreich generiert: ${packages.length} Kodierer-Pakete mit insgesamt ${totalResponses} Antworten erstellt`
          );
          this.closeCoderTraining();
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
        next: (flags) => {
          this.responseMatchingFlags = flags;
          this.isLoadingMatchingMode = false;
        },
        error: () => {
          this.responseMatchingFlags = [];
          this.isLoadingMatchingMode = false;
        }
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

    let newFlags: ResponseMatchingFlag[];

    if (flag === ResponseMatchingFlag.NO_AGGREGATION) {
      if (this.hasMatchingFlag(flag)) {
        newFlags = [];
      } else {
        newFlags = [ResponseMatchingFlag.NO_AGGREGATION];
      }
    } else {
      newFlags = this.responseMatchingFlags.filter(
        (f) => f !== ResponseMatchingFlag.NO_AGGREGATION
      );
      if (this.hasMatchingFlag(flag)) {
        newFlags = newFlags.filter((f) => f !== flag);
      } else {
        newFlags = [...newFlags, flag];
      }
    }

    this.saveResponseMatchingMode(newFlags);
  }

  private saveResponseMatchingMode(flags: ResponseMatchingFlag[]): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isSavingMatchingMode = true;
    this.workspaceSettingsService
      .setResponseMatchingMode(workspaceId, flags)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.responseMatchingFlags = flags;
          this.isSavingMatchingMode = false;
          this.showSuccess(
            this.translateService.instant(
              'coding-management-manual.response-matching.save-success'
            )
          );

          // Refresh all affected areas after matching mode change
          this.onResponseMatchingModeChanged();
        },
        error: () => {
          this.isSavingMatchingMode = false;
          this.showError(
            this.translateService.instant(
              'coding-management-manual.response-matching.save-error'
            )
          );
        }
      });
  }

  private onResponseMatchingModeChanged(): void {
    this.loadResponseAnalysis();

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

  private loadResponseAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingResponseAnalysis = true;
    this.testPersonCodingService
      .getResponseAnalysis(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (analysis) => {
          this.responseAnalysis = analysis;
          this.isLoadingResponseAnalysis = false;
        },
        error: () => {
          this.responseAnalysis = null;
          this.isLoadingResponseAnalysis = false;
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
}
