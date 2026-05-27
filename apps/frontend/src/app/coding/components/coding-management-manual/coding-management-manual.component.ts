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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  Subject, takeUntil, debounceTime, finalize, Observable, of, tap,
  distinctUntilChanged, filter,
  firstValueFrom,
  map
} from 'rxjs';
import * as ExcelJS from 'exceljs';
import { Router } from '@angular/router';
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
  CodingJobBackendService
} from '../../services/coding-job-backend.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';
import {
  ResponseMatchingFlag
} from '../../../ws-admin/services/workspace-settings.service';
import { CodingStatistics } from '../../../../../../../api-dto/coding/coding-statistics';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';
import {
  CodingFreshnessSummaryDto,
  CodingFreshnessSummaryItemDto
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
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

interface SavedCodeProgress {
  id?: number;
  codingIssueOption?: number;
  [key: string]: unknown;
}

type PlanningStatusState =
  'loading' |
  'warning' |
  'planning-incomplete' |
  'planning-ready' |
  'execution-ready' |
  'completion-ready' |
  'progress-unavailable' |
  'complete';

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
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private document = inject(DOCUMENT);
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
  private persistedResponseMatchingFlags: ResponseMatchingFlag[] = [];
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

  emptyPageIndex = 0;
  emptyPageSize = 5;
  duplicatePageIndex = 0;
  duplicatePageSize = 50;

  // Debouncing for job definition changes
  private jobDefinitionChangeSubject = new Subject<void>();

  private thresholdChangeSubject = new Subject<number>();

  private matchingFlagChangeSubject = new Subject<ResponseMatchingFlag[]>();

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

  statusDistribution: { [status: string]: number } = {};
  statusDistributionV2: { [status: string]: number } = {};
  appliedResultsOverview: (AppliedResultsOverview & {
    totalIncompleteVariables: number;
    finalStatusBreakdown: {
      codingComplete: number;
      invalid: number;
      codingError: number;
      other: number;
    };
  }) | null = null;

  completedJobsReadyForApply: CodingJob[] = [];
  completedJobsBlockedForReview: CodingJob[] = [];
  codingFreshnessSummary: CodingFreshnessSummaryDto | null = null;

  isLoadingCompletedJobsReadyForApply = false;
  isLoadingCodingFreshness = false;

  isApplyingCodingResults = false;

  private applyingCodingResultJobIds = new Set<number>();

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
          this.isApplyingDuplicateAggregation = true;
          this.testPersonCodingService
            .saveAggregationSettings(workspaceId, threshold, this.responseMatchingFlags)
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
                this.responseMatchingFlags = result.flags;
                this.persistedResponseMatchingFlags = [...result.flags];
                this.duplicateAggregationThreshold = this.normalizeAggregationThreshold(result.threshold);
                this.refreshAggregationDependentViews();
              },
              error: () => {
                this.showError('Fehler beim Speichern der Aggregationseinstellungen');
              }
            });
        }
      });

    this.matchingFlagChangeSubject
      .pipe(
        debounceTime(500),
        filter(flags => !this.areMatchingFlagsEqual(flags, this.persistedResponseMatchingFlags)),
        takeUntil(this.destroy$)
      )
      .subscribe((flags: ResponseMatchingFlag[]) => {
        const workspaceId = this.appService.selectedWorkspaceId;
        if (!workspaceId) {
          return;
        }

        this.isLoadingMatchingMode = true;
        this.saveResponseMatchingMode(flags)
          .pipe(
            finalize(() => {
              this.isLoadingMatchingMode = false;
            }),
            takeUntil(this.destroy$)
          )
          .subscribe({
            next: () => {
              this.onResponseMatchingModeChanged();
            },
            error: () => {
              // Error handling is done in saveResponseMatchingMode.
            }
          });
      });

    this.testPersonCodingService.autoCodingCompleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshAllStatistics();
        this.loadCodingFreshness();
        this.loadResponseAnalysis();
        this.reloadCodingJobsList();
        if (this.codingJobDefinitionsComponent) {
          this.codingJobDefinitionsComponent.refresh();
        }
      });

    this.loadInitialManualCodingState();
    this.loadCodingFreshness();
  }

  ngOnDestroy(): void {
    if (this.analysisPollingTimer) {
      clearTimeout(this.analysisPollingTimer);
    }
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
        this.dialog.open<
        CodingImportFormatDialogComponent,
        CodingImportFormatDialogData,
        CodingImportFormatDialogResult | undefined
        >(CodingImportFormatDialogComponent, {
          width: '720px',
          maxWidth: '95vw',
          data: detection
        }).afterClosed()
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

  private async detectCodingImportFormat(file: File): Promise<CodingImportFormatDialogData> {
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
        headers.push(this.normalizeImportHeader(cell.text || cell.value?.toString() || ''));
      });
      return headers.filter(Boolean);
    }

    const sample = await file.slice(0, 65536).text();
    const firstLine = sample.split(/\r?\n/).find(line => line.trim().length > 0) || '';
    const delimiter = this.detectCsvDelimiter(firstLine);
    return this.splitCsvHeaderLine(firstLine, delimiter)
      .map(header => this.normalizeImportHeader(header))
      .filter(Boolean);
  }

  private detectFormatFromHeaders(headers: string[]): CodingImportDetectedFormat {
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
          'status_v1', 'code_v1', 'score_v1',
          'status_v2', 'code_v2', 'score_v2',
          'status_v3', 'code_v3', 'score_v3'
        ])
    ) {
      return 'coding-results';
    }

    if (has('variable_id') && (has('unit_key') || has('unit_alias'))) {
      if (hasAny(['status', 'code', 'score', 'variable_page', 'variable_anchor'])) {
        return hasAny(['variable_page', 'variable_anchor']) ? 'coding-list' : 'external-coding';
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
      const hasCodingValues = ['status', 'code', 'score'].some(header => headers.includes(header));
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
        description: 'Die Datei sieht nach einem Kodierergebnis-Export aus dem Coding Management aus.',
        canImport: availableVersions.length > 0,
        headers,
        availableVersions,
        selectedVersion: availableVersions.includes('v2') ? 'v2' : availableVersions[0],
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
        description: 'Diese Datei enthält vollständige Testergebnisse mit Antworten und Zuständen, nicht nur Code-/Score-Kodierungen.',
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
        description: 'Diese Datei enthält Testlogs und kann nicht als Code-/Score-Kodierung übernommen werden.',
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

  private getAvailableCodingVersions(headers: string[]): Array<'v1' | 'v2' | 'v3'> {
    return (['v1', 'v2', 'v3'] as Array<'v1' | 'v2' | 'v3'>)
      .filter(version => (
        headers.includes(`status_${version}`) ||
          headers.includes(`code_${version}`) ||
          headers.includes(`score_${version}`)
      ));
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
  }

  reloadCodingJobsList(): void {
    if (this.codingJobsComponent) {
      this.codingJobsComponent.loadCodingJobs();
    }
    if (this.coderTrainingsListComponent) {
      this.coderTrainingsListComponent.loadCoderTrainings();
    }
  }

  openCreateJobDefinition(): void {
    if (this.codingJobDefinitionsComponent) {
      this.codingJobDefinitionsComponent.createDefinition();
      return;
    }

    this.showError('Die Jobdefinitionen werden noch geladen. Bitte versuchen Sie es gleich erneut.');
  }

  refreshManualCodingPlanning(): void {
    this.refreshAllStatistics();
    this.loadCodingFreshness();
    this.loadResponseAnalysis();
    this.reloadCodingJobsList();

    if (this.codingJobDefinitionsComponent) {
      this.codingJobDefinitionsComponent.refresh();
    }
  }

  isAnyPlanningDataLoading(): boolean {
    return this.isLoadingResponseAnalysis ||
      this.isLoadingCodingProgress ||
      this.isLoadingVariableCoverage ||
      this.isLoadingCaseCoverage ||
      this.isLoadingMatchingMode;
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
      (sum, variable) => sum + (
        variable.availableCases ??
        variable.uniqueCasesAfterAggregation ??
        variable.responseCount ??
        0
      ),
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

    return Math.max(0, totalEffectiveCases - this.getAvailableCasesForNewJobs());
  }

  getVariableCoveragePercentage(): number {
    return this.variableCoverageOverview?.coveragePercentage || 0;
  }

  getAppliedResultsPercentage(): number {
    return this.appliedResultsOverview?.completionPercentage || 0;
  }

  getCurrentRawManualResponses(): number {
    return this.appliedResultsOverview?.rawTotalIncompleteResponses ??
      this.codingProgressOverview?.rawTotalCasesToCode ??
      this.caseCoverageOverview?.totalCasesToCode ??
      0;
  }

  isResponseAnalysisOutdated(): boolean {
    const analysisRawCases = this.responseAnalysis?.aggregationSummary?.rawCases ?? 0;
    const currentRawManualResponses = this.getCurrentRawManualResponses();
    return !!this.responseAnalysis &&
      !this.responseAnalysis.isCalculating &&
      analysisRawCases > 0 &&
      currentRawManualResponses > 0 &&
      analysisRawCases !== currentRawManualResponses;
  }

  scrollToSection(sectionId: string): void {
    this.document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  hasPreparationWarnings(): boolean {
    return this.hasUncodedEmptyResponses() ||
      this.hasDuplicateFindingsWithoutAggregation;
  }

  isPreparationReady(): boolean {
    return !!this.responseAnalysis &&
      !this.responseAnalysis.isCalculating &&
      !this.hasPreparationWarnings();
  }

  hasPlanningWarnings(): boolean {
    return (this.variableCoverageOverview?.conflictedVariables || 0) > 0 ||
      (this.variableCoverageOverview?.missingVariables || 0) > 0 ||
      (this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0;
  }

  isPlanningReady(): boolean {
    return !!this.variableCoverageOverview &&
      !!this.caseCoverageOverview &&
      !this.hasPlanningWarnings();
  }

  hasExecutionOpenWork(): boolean {
    return this.getOpenCodingCases() > 0;
  }

  isCompletionComplete(): boolean {
    return this.getAppliedResultsPercentage() >= 100 &&
      this.getOpenCodingCases() === 0;
  }

  hasCompletedJobsReadyForApply(): boolean {
    return this.completedJobsReadyForApply.length > 0;
  }

  hasCompletedJobsBlockedForReview(): boolean {
    return this.completedJobsBlockedForReview.length > 0;
  }

  canApplyCompletedJobResults(): boolean {
    return this.codingJobsComponent?.canApplyResults ??
      (this.appService.authData.isAdmin === true);
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

    dialogRef.afterClosed().subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
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
        message: `Möchten Sie die Ergebnisse für ${this.completedJobsReadyForApply.length} abgeschlossene Kodierjob(s) anwenden? Jobs mit Kodierungsproblemen werden übersprungen.`,
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
        return 'status-warning';
      case 'planning-incomplete':
      case 'completion-ready':
      case 'progress-unavailable':
        return 'status-attention';
      case 'complete':
        return 'status-complete';
      case 'loading':
      case 'planning-ready':
      case 'execution-ready':
      default:
        return 'status-ready';
    }
  }

  private getPlanningStatusState(): PlanningStatusState {
    if (this.isAnyPlanningDataLoading()) {
      return 'loading';
    }

    if ((this.variableCoverageOverview?.conflictedVariables || 0) > 0) {
      return 'warning';
    }

    if ((this.variableCoverageOverview?.missingVariables || 0) > 0 ||
        (this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return 'planning-incomplete';
    }

    if (this.isCompletionComplete()) {
      return 'complete';
    }

    if (this.isPlanningReady() &&
        !!this.codingProgressOverview &&
        this.hasExecutionOpenWork()) {
      return 'execution-ready';
    }

    if (this.isPlanningReady() &&
        !!this.codingProgressOverview &&
        !!this.appliedResultsOverview &&
        !this.hasExecutionOpenWork()) {
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
      case 'planning-incomplete':
        return 'assignment_late';
      case 'execution-ready':
        return 'play_circle';
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
        return 'Konflikte prüfen';
      case 'planning-incomplete':
        return 'Planung noch unvollständig';
      case 'execution-ready':
        return 'Bereit für die Durchführung';
      case 'completion-ready':
        return 'Bereit für den Abschluss';
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

    if ((this.variableCoverageOverview?.conflictedVariables || 0) > 0) {
      return `${this.variableCoverageOverview?.conflictedVariables || 0} Variablenkonflikte müssen vor der verlässlichen Jobplanung geklärt werden.`;
    }

    if ((this.variableCoverageOverview?.missingVariables || 0) > 0) {
      return `${this.variableCoverageOverview?.missingVariables || 0} Variablen sind noch keiner Jobdefinition zugeordnet.`;
    }

    if ((this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return `${this.caseCoverageOverview?.effectiveUnassignedCases || 0} Fälle sind noch nicht in Kodierjobs verteilt.`;
    }

    if (this.getOpenCodingCases() === 0 && this.getAppliedResultsPercentage() >= 100) {
      return 'Alle manuellen Kodierungen sind abgeschlossen und final übernommen.';
    }

    if (this.isPlanningReady() &&
        !!this.codingProgressOverview &&
        this.hasExecutionOpenWork()) {
      return 'Die Planung ist vollständig. Bearbeiten Sie nun die offenen Kodierfälle im Abschnitt Durchführung.';
    }

    if (this.isPlanningReady() &&
        !!this.codingProgressOverview &&
        !!this.appliedResultsOverview &&
        !this.hasExecutionOpenWork()) {
      return 'Alle Kodierfälle sind abgeschlossen. Übernehmen Sie nun die Kodierergebnisse in den Datenbestand.';
    }

    return 'Prüfen Sie die Antwortanalyse und erstellen Sie danach passende Kodierjob-Definitionen.';
  }

  getPlanningNextStepTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'loading':
        return 'Planungsstand wird geladen';
      case 'warning':
        return 'Konflikte zuerst klären';
      case 'planning-incomplete':
        return 'Kodierfälle in Jobs verteilen';
      case 'execution-ready':
        return 'Kodierjobs bearbeiten lassen';
      case 'completion-ready':
        return 'Ergebnisse übernehmen';
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
        return 'Prüfen Sie Variablen, die von mehreren Definitionen mit überlappenden Fällen verwendet werden.';
      case 'planning-incomplete':
        if ((this.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
          const unavailableHint = unavailableCases > 0 ?
            ` ${unavailableCases} Fälle sind bereits in Jobs verteilt oder durch andere Definitionen reserviert.` :
            '';
          return `${this.caseCoverageOverview?.effectiveUnassignedCases || 0} Fälle sind noch nicht in Kodierjobs. Für neue Jobdefinitionen sind aktuell ${availableCases} Fälle verfügbar.${unavailableHint} Danach Definition freigeben und Jobs erstellen.`;
        }
        return 'Ordnen Sie die fehlenden Variablen einer Jobdefinition zu. Danach Definition freigeben und Jobs erstellen.';
      case 'execution-ready':
        return 'Die Fälle sind verteilt. Kodierer können nun ihre zugewiesenen Kodierjobs bearbeiten.';
      case 'completion-ready':
        return 'Alle Kodierfälle sind bearbeitet. Übernehmen Sie jetzt die abgeschlossenen Ergebnisse in den Datenbestand.';
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
      case 'execution-ready':
        return 'Zu den Kodierjobs';
      case 'completion-ready':
        return 'Zum Abschluss';
      case 'complete':
        return 'Abschluss ansehen';
      case 'loading':
      case 'progress-unavailable':
        return 'Aktualisieren';
      default:
        return 'Zu den Jobdefinitionen';
    }
  }

  getPlanningNextStepTargetSection(): string {
    switch (this.getPlanningStatusState()) {
      case 'execution-ready':
        return 'manual-execution';
      case 'completion-ready':
      case 'complete':
        return 'manual-completion';
      default:
        return 'manual-planning';
    }
  }

  performPlanningNextStep(): void {
    const planningStatusState = this.getPlanningStatusState();
    if (planningStatusState === 'loading' || planningStatusState === 'progress-unavailable') {
      this.refreshManualCodingPlanning();
      return;
    }

    this.scrollToSection(this.getPlanningNextStepTargetSection());
  }

  getPlanningNextStepIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'warning':
        return 'warning';
      case 'execution-ready':
        return 'play_circle';
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
      .sort((a, b) => (
        a.version.localeCompare(b.version) ||
        a.state.localeCompare(b.state)
      ));
  }

  get hasCodingFreshnessWarnings(): boolean {
    return this.codingFreshnessWarnings.length > 0;
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
    if (includeResponseAnalysis) {
      this.loadResponseAnalysis();
    }
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadCodingProgressOverview();
    this.loadCodingIncompleteVariables();
    this.loadStatusDistributionV2();
    this.reloadCodingJobsList();

    if (this.codingJobDefinitionsComponent) {
      this.codingJobDefinitionsComponent.refresh();
    }
  }

  private loadInitialManualCodingState(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.refreshAllStatistics();
      this.loadResponseAnalysis();
      return;
    }

    this.isLoadingMatchingMode = true;
    this.isLoadingResponseAnalysis = true;

    this.testPersonCodingService
      .getAggregationSettings(workspaceId)
      .pipe(
        finalize(() => {
          this.isLoadingMatchingMode = false;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: settings => {
          this.responseMatchingFlags = settings.flags;
          this.persistedResponseMatchingFlags = [...settings.flags];
          this.duplicateAggregationThreshold = this.normalizeAggregationThreshold(settings.threshold);
          this.refreshAllStatistics();
          this.loadResponseAnalysis();
        },
        error: () => {
          this.responseMatchingFlags = [];
          this.persistedResponseMatchingFlags = [];
          this.duplicateAggregationThreshold = 2;
          this.refreshAllStatistics();
          this.loadResponseAnalysis();
        }
      });
  }

  private loadCodingFreshness(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.codingFreshnessSummary = null;
      return;
    }

    this.isLoadingCodingFreshness = true;
    this.testPersonCodingService
      .getCodingFreshness(workspaceId)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoadingCodingFreshness = false;
        })
      )
      .subscribe(summary => {
        this.codingFreshnessSummary = summary;
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
      return;
    }

    this.testPersonCodingService
      .getAppliedResultsOverview(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: overview => {
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
          this.appliedResultsOverview = null;
        }
      });
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
          const completedJobs = (response.data || [])
            .filter(job => this.isCodingJobReadyForApply(job));

          if (completedJobs.length === 0) {
            this.completedJobsReadyForApply = [];
            this.completedJobsBlockedForReview = [];
            this.isLoadingCompletedJobsReadyForApply = false;
            return;
          }

          this.codingJobBackendService
            .getBulkCodingProgress(workspaceId, completedJobs.map(job => job.id))
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: progressByJobId => {
                this.completedJobsBlockedForReview = completedJobs
                  .filter(job => this.hasBlockingCodingIssues(progressByJobId[job.id]));
                this.completedJobsReadyForApply = completedJobs
                  .filter(job => !this.hasBlockingCodingIssues(progressByJobId[job.id]));
                this.isLoadingCompletedJobsReadyForApply = false;
              },
              error: () => {
                this.completedJobsReadyForApply = [];
                this.completedJobsBlockedForReview = completedJobs;
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
      return savedCode.id === -1 ||
        savedCode.id === -2 ||
        savedCode.codingIssueOption === -1 ||
        savedCode.codingIssueOption === -2;
    });
  }

  private isCodingJobReadyForApply(job: CodingJob): boolean {
    return job.status === 'completed' &&
      job.freshnessStatus !== 'stale_source' &&
      !job.training?.id &&
      !job.training_id;
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
    this.refreshAllStatistics();
    this.loadCodingFreshness();
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

  get isDuplicateAggregationActive(): boolean {
    return !this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION);
  }

  get responseAnalysisAggregationSavings(): number {
    return this.responseAnalysis?.aggregationSummary?.collapsedCases ?? 0;
  }

  get hasDuplicateFindingsWithoutAggregation(): boolean {
    return !!this.responseAnalysis &&
      !this.responseAnalysis.aggregationSummary.aggregationActive &&
      this.responseAnalysis.duplicateValues.total > 0;
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
          this.duplicateAggregationThreshold = this.normalizeAggregationThreshold(settings.threshold);
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
          this.duplicateAggregationThreshold = this.normalizeAggregationThreshold(settings.threshold);
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

  toggleMatchingFlag(flag: ResponseMatchingFlag): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.responseAnalysis?.isCalculating) {
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
        f => f !== ResponseMatchingFlag.NO_AGGREGATION
      );
      if (this.hasMatchingFlag(flag)) {
        newFlags = newFlags.filter(f => f !== flag);
      } else {
        newFlags = [...newFlags, flag];
      }
    }

    this.responseMatchingFlags = newFlags;
    this.emptyPageIndex = 0;
    this.duplicatePageIndex = 0;
    this.matchingFlagChangeSubject.next(newFlags);
  }

  private saveResponseMatchingMode(flags: ResponseMatchingFlag[]): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const rollbackFlags = [...this.persistedResponseMatchingFlags];
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
            this.responseMatchingFlags = result.flags;
            this.persistedResponseMatchingFlags = [...result.flags];
            this.duplicateAggregationThreshold = this.normalizeAggregationThreshold(result.threshold);
            this.showSuccess(
              this.translateService.instant(
                'coding-management-manual.response-matching.save-success'
              )
            );
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

    if (this.analysisPollingTimer) {
      clearTimeout(this.analysisPollingTimer);
      this.analysisPollingTimer = undefined;
    }

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
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (analysis: ResponseAnalysisDto & { isCalculating?: boolean }) => {
          this.responseAnalysis = analysis;
          this.responseAnalysisError = null;
          this.isLoadingResponseAnalysis = false;

          if (analysis.isCalculating) {
            // Poll every 5 seconds if calculating
            this.analysisPollingTimer = setTimeout(() => {
              if (this.responseAnalysis?.isCalculating) {
                this.loadResponseAnalysis();
              }
            }, 5000);
          }
        },
        error: error => {
          this.isLoadingResponseAnalysis = false;
          this.responseAnalysis = null;
          this.responseAnalysisError = `Fehler beim Laden der Antwortanalyse: ${error.message || error}`;
          this.snackBar.open(
            this.responseAnalysisError,
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
    this.responseAnalysisError = null;
    this.codingJobBackendService
      .triggerResponseAnalysis(
        workspaceId,
        this.normalizeAggregationThreshold(this.duplicateAggregationThreshold)
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
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

    const uncodedCount = this.getUncodedCount();
    if (uncodedCount === 0) {
      return;
    }

    // Show Material Dialog confirmation
    const dialogRef = this.dialog.open(ApplyEmptyCodingDialogComponent, {
      width: '550px',
      data: { count: uncodedCount }
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
              this.saveResponseMatchingMode([ResponseMatchingFlag.NO_AGGREGATION])
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

  private normalizeAggregationThreshold(value: number | string | null | undefined): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 2;
    }
    return Math.min(100, Math.max(2, Math.round(numericValue)));
  }
}
