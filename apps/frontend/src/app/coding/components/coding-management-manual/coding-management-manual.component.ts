import {
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import * as ExcelJS from 'exceljs';
import { Subject, takeUntil } from 'rxjs';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { CodingJobDefinitionsComponent } from '../coding-job-definitions/coding-job-definitions.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';
import { CoderTrainingComponent, VariableConfig } from '../coder-training/coder-training.component';
import { Coder } from '../../models/coder.model';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';
import { AppService } from '../../../services/app.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';
import { CoderTrainingsListComponent } from '../coder-trainings-list/coder-trainings-list.component';
import { DoubleCodedReviewComponent } from '../double-coded-review/double-coded-review.component';

@Component({
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  imports: [
    TranslateModule,
    MatAnchor,
    CodingJobsComponent,
    CodingJobDefinitionsComponent,
    MatIcon,
    MatButton,
    MatProgressBarModule,
    MatDialogModule,
    VariableBundleManagerComponent,
    CoderTrainingComponent,
    CoderTrainingsListComponent,
    CommonModule
  ]
})
export class CodingManagementManualComponent implements OnInit, OnDestroy {
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private validationStateService = inject(ValidationStateService);
  private translateService = inject(TranslateService);
  private dialog = inject(MatDialog);
  private destroy$ = new Subject<void>();

  validationResults: ValidateCodingCompletenessResponseDto | null = null;
  validationProgress: ValidationProgress | null = null;
  isLoading = false;

  codingProgressOverview: {
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
  } | null = null;

  variableCoverageOverview: {
    totalVariables: number;
    coveredVariables: number;
    missingVariables: number;
    coveragePercentage: number;
    variableCaseCounts: { unitName: string; variableId: string; caseCount: number }[];
  } | null = null;

  caseCoverageOverview: {
    totalCasesToCode: number;
    casesInJobs: number;
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

  importResults: {
    message: string;
    processedRows: number;
    updatedRows: number;
    errors: string[];
    affectedRows: Array<{
      unitAlias: string;
      variableId: string;
      personCode?: string;
      personLogin?: string;
      personGroup?: string;
      bookletName?: string;
      originalCodedStatus: string;
      originalCode: number | null;
      originalScore: number | null;
      updatedCodedStatus: string | null;
      updatedCode: number | null;
      updatedScore: number | null;
    }>;
  } | null = null;

  showComparisonTable = false;
  showCoderTraining = false;

  currentPage = 1;
  pageSize = 50;
  expectedCombinations: ExpectedCombinationDto[] = [];
  validationCacheKey: string | null = null;

  comparisonCurrentPage = 1;
  comparisonPageSize = 100;

  get totalPages(): number {
    return this.validationResults?.totalPages || 0;
  }

  get hasNextPage(): boolean {
    return this.validationResults?.hasNextPage || false;
  }

  get hasPreviousPage(): boolean {
    return this.validationResults?.hasPreviousPage || false;
  }

  get comparisonTotalPages(): number {
    if (!this.importResults?.affectedRows) return 0;
    return Math.ceil(this.importResults.affectedRows.length / this.comparisonPageSize);
  }

  get comparisonHasNextPage(): boolean {
    return this.comparisonCurrentPage < this.comparisonTotalPages;
  }

  get comparisonHasPreviousPage(): boolean {
    return this.comparisonCurrentPage > 1;
  }

  get completionPercentage(): number {
    if (!this.validationResults || this.validationResults.total === 0) {
      return 0;
    }
    return ((this.validationResults.total - this.validationResults.missing) / this.validationResults.total) * 100;
  }

  get paginatedAffectedRows(): Array<{
    unitAlias: string;
    variableId: string;
    personCode?: string;
    personLogin?: string;
    personGroup?: string;
    bookletName?: string;
    originalCodedStatus: string;
    originalCode: number | null;
    originalScore: number | null;
    updatedCodedStatus: string | null;
    updatedCode: number | null;
    updatedScore: number | null;
  }> {
    if (!this.importResults?.affectedRows) return [];

    const startIndex = (this.comparisonCurrentPage - 1) * this.comparisonPageSize;
    const endIndex = startIndex + this.comparisonPageSize;
    return this.importResults.affectedRows.slice(startIndex, endIndex);
  }

  ngOnInit(): void {
    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.validationProgress = progress;
        this.isLoading = progress.status === 'loading' || progress.status === 'processing';

        if (progress.status === 'error') {
          this.showError(progress.error || this.translateService.instant('coding-management-manual.errors.validation-failed'));
        }
      });

    this.validationStateService.validationResults$
      .pipe(takeUntil(this.destroy$))
      .subscribe(results => {
        this.validationResults = results;

        if (results) {
          this.validationCacheKey = results.cacheKey || null;
          this.showSuccess(this.translateService.instant('coding-management-manual.success.validation-completed', { missing: results.missing, total: results.total }));
        }
      });

    const currentResults = this.validationStateService.getValidationResults();
    if (currentResults) {
      this.validationResults = currentResults;
    }

    const currentProgress = this.validationStateService.getValidationProgress();
    this.validationProgress = currentProgress;
    this.isLoading = currentProgress.status === 'loading' || currentProgress.status === 'processing';
    this.loadCodingProgressOverview();
    this.loadVariableCoverageOverview();
    this.loadCaseCoverageOverview();
    this.loadWorkspaceKappaSummary();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onExternalCodingFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      this.showError(this.translateService.instant('coding-management-manual.errors.no-file-selected'));
      return;
    }

    const file = input.files[0];
    if (!this.isExcelOrCsvFile(file)) {
      this.showError(this.translateService.instant('coding-management-manual.errors.invalid-file-type'));
      return;
    }

    this.processExternalCodingFile(file);
  }

  private isExcelOrCsvFile(file: File): boolean {
    return file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');
  }

  private async processExternalCodingFile(file: File): Promise<void> {
    this.isLoading = true;
    this.validationStateService.startValidation();

    try {
      const workspaceId = this.appService.selectedWorkspaceId;

      if (!workspaceId) {
        const errorMsg = this.translateService.instant('coding-management-manual.errors.no-workspace-selected');
        this.showError(errorMsg);
        this.validationStateService.setValidationError(errorMsg);
        return;
      }

      this.validationStateService.updateProgress(10, this.translateService.instant('coding-management-manual.progress.file-processing'));
      const fileData = await this.fileToBase64(file);

      await this.testPersonCodingService.importExternalCodingWithProgress(
        workspaceId,
        {
          file: fileData,
          fileName: file.name
        },
        (progress: number, message: string) => {
          this.validationStateService.updateProgress(progress, message);
        },
        // onComplete callback
        (result: ExternalCodingImportResultDto) => {
          this.validationStateService.resetValidation();
          this.importResults = result;
          this.showComparisonTable = true;
          this.comparisonCurrentPage = 1;

          this.showSuccess(this.translateService.instant('coding-management-manual.success.import-completed', { updatedRows: result.updatedRows, processedRows: result.processedRows }));

          if (result.errors && result.errors.length > 0) {
            this.showError(this.translateService.instant('error.general', { error: `${result.errors.length} Warnungen aufgetreten. Details in der Konsole.` }));
          }

          this.isLoading = false;
        },
        // onError callback
        (error: string) => {
          this.validationStateService.setValidationError(`Import fehlgeschlagen: ${error}`);
          this.showError(this.translateService.instant('coding-management-manual.errors.import-failed'));
          this.isLoading = false;
        }
      );
    } catch (error) {
      this.validationStateService.setValidationError(this.translateService.instant('coding-management-manual.errors.import-failed'));
      this.showError(this.translateService.instant('coding-management-manual.errors.import-failed'));
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

  /**
   * Handle file selection event
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      this.showError('Keine Datei ausgewählt');
      return;
    }

    const file = input.files[0];
    if (!this.isExcelFile(file)) {
      this.showError('Bitte wählen Sie eine Excel-Datei aus (.xlsx, .xls)');
      return;
    }
    this.validationStateService.startValidation();
    setTimeout(() => {
      this.readExcelFile(file);
    }, 0);
  }

  private isExcelFile(file: File): boolean {
    return file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  }

  private readExcelFile(file: File): void {
    const workbook = new ExcelJS.Workbook();
    const reader = new FileReader();

    reader.onload = async (e: ProgressEvent<FileReader>) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        this.validationStateService.updateProgress(10, 'Excel-Datei wird geladen...');
        await workbook.xlsx.load(buffer);
        this.validationStateService.updateProgress(30, 'Excel-Datei wird verarbeitet...');
        const worksheet = workbook.getWorksheet(1);
        if (!worksheet || worksheet.rowCount <= 1) {
          this.validationStateService.setValidationError('Die Datei enthält keine gültigen Daten');
          return;
        }
        const headers: string[] = [];
        worksheet.getRow(1).eachCell(cell => {
          headers.push(cell.value?.toString() || '');
        });

        this.validationStateService.updateProgress(40, 'Daten werden extrahiert...');
        const data: Record<string, string>[] = [];
        const totalRows = worksheet.rowCount - 1;

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
          const row = worksheet.getRow(rowNumber);
          const rowData: Record<string, string> = {};

          headers.forEach((header, index) => {
            const cell = row.getCell(index + 1);
            rowData[header.trim()] = cell.value?.toString() || '';
          });

          data.push(rowData);

          if (rowNumber % 100 === 0 || rowNumber === worksheet.rowCount) {
            const progress = 40 + Math.floor(((rowNumber - 2) / totalRows) * 20);
            this.validationStateService.updateProgress(
              progress,
              `Daten werden extrahiert (${rowNumber - 1}/${totalRows})...`
            );
          }
        }

        if (data.length === 0) {
          this.validationStateService.setValidationError('Die Datei enthält keine gültigen Daten');
          return;
        }

        this.validationStateService.updateProgress(60, 'Daten werden für Validierung vorbereitet...');
        const expectedCombinations = this.mapToExpectedCombinations(data);

        this.validationStateService.updateProgress(70, 'Validierung wird durchgeführt...');
        this.validateCodingCompleteness(expectedCombinations);
      } catch (error) {
        this.validationStateService.setValidationError('Fehler beim Parsen der Excel-Datei');
      }
    };

    reader.onerror = () => {
      this.validationStateService.setValidationError('Fehler beim Lesen der Datei');
    };

    reader.readAsArrayBuffer(file);
  }

  private mapToExpectedCombinations(data: Record<string, string>[]): ExpectedCombinationDto[] {
    return data.map(item => ({
      unit_key: item.unit_key || '',
      login_name: item.login_name || '',
      login_code: item.login_code || '',
      booklet_id: item.booklet_id || '',
      variable_id: item.variable_id || ''
    }));
  }

  private validateCodingCompleteness(expectedCombinations: ExpectedCombinationDto[]): void {
    this.expectedCombinations = expectedCombinations;
    this.currentPage = 1;

    this.loadValidationPage(1);
  }

  private loadValidationPage(page: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.validationStateService.setValidationError('Kein Arbeitsbereich ausgewählt');
      return;
    }

    this.validationStateService.updateProgress(80, `Validierung wird durchgeführt (Seite ${page})...`);
    this.currentPage = page;

    this.testPersonCodingService.validateCodingCompleteness(
      workspaceId,
      this.expectedCombinations,
      page,
      this.pageSize
    ).subscribe({
      next: results => {
        this.validationStateService.setValidationResults(results);
      },
      error: () => {
        this.validationStateService.setValidationError('Fehler bei der Validierung');
      }
    });
  }

  nextPage(): void {
    if (this.hasNextPage) {
      this.loadValidationPage(this.currentPage + 1);
    }
  }

  previousPage(): void {
    if (this.hasPreviousPage) {
      this.loadValidationPage(this.currentPage - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize = newPageSize;
    this.loadValidationPage(1); // Reset to first page when changing page size
  }

  nextComparisonPage(): void {
    if (this.comparisonHasNextPage) {
      this.comparisonCurrentPage += 1;
    }
  }

  previousComparisonPage(): void {
    if (this.comparisonHasPreviousPage) {
      this.comparisonCurrentPage -= 1;
    }
  }

  changeComparisonPageSize(newPageSize: number): void {
    this.comparisonPageSize = newPageSize;
    this.comparisonCurrentPage = 1;
  }

  downloadExcel(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId || !this.validationCacheKey) {
      this.showError('Keine Daten zum Herunterladen verfügbar. Bitte führen Sie zuerst eine Validierung durch.');
      return;
    }

    this.isLoading = true;

    this.testPersonCodingService.downloadValidationResultsAsExcel(
      workspaceId,
      this.validationCacheKey
    ).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().slice(0, 10);
        link.download = `validation-results-${timestamp}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        this.showSuccess('Excel-Datei wurde erfolgreich heruntergeladen');
        this.isLoading = false;
      },
      error: error => {
        let errorMessage = 'Fehler beim Herunterladen der Excel-Datei';
        if (error.status === 404) {
          errorMessage = 'Validierungsdaten nicht gefunden. Bitte führen Sie zuerst eine neue Validierung durch.';
        } else if (error.status === 400) {
          errorMessage = 'Ungültiger Cache-Schlüssel. Bitte führen Sie eine neue Validierung durch.';
        } else if (error.status === 500) {
          errorMessage = 'Server-Fehler beim Generieren der Excel-Datei. Bitte versuchen Sie es später erneut.';
        } else if (error.status === 0) {
          errorMessage = 'Netzwerk-Fehler. Bitte überprüfen Sie Ihre Internetverbindung.';
        } else if (error.message && error.message.includes('cache')) {
          errorMessage = 'Die Validierungsdaten sind nicht mehr verfügbar. Bitte führen Sie eine neue Validierung durch.';
        }

        this.showError(errorMessage);
        this.isLoading = false;
      }
    });
  }

  downloadComparisonTable(): void {
    if (!this.importResults || !this.importResults.affectedRows || this.importResults.affectedRows.length === 0) {
      this.showError('Keine Vergleichsdaten zum Herunterladen verfügbar.');
      return;
    }

    this.isLoading = true;

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Import Vergleich');

      const headers = [
        'Unit Alias',
        'Variable ID',
        'Person Code',
        'Original Status',
        'Original Code',
        'Original Score',
        'Updated Status',
        'Updated Code',
        'Updated Score'
      ];
      worksheet.addRow(headers);

      // Style headers
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      this.importResults.affectedRows.forEach(row => {
        worksheet.addRow([
          row.unitAlias,
          row.variableId,
          row.personCode,
          row.originalCodedStatus,
          row.originalCode,
          row.originalScore,
          row.updatedCodedStatus,
          row.updatedCode,
          row.updatedScore
        ]);
      });

      // Auto-fit columns
      worksheet.columns.forEach(column => {
        if (column) {
          let maxLength = 0;
          column.eachCell?.({ includeEmpty: true }, cell => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
              maxLength = columnLength;
            }
          });
          if (column.width !== undefined) {
            column.width = Math.min(maxLength + 2, 50);
          }
        }
      });

      // Generate Excel file
      workbook.xlsx.writeBuffer().then(buffer => {
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().slice(0, 10);
        link.download = `import-comparison-${timestamp}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        this.showSuccess('Vergleichstabelle wurde erfolgreich als Excel-Datei heruntergeladen');
        this.isLoading = false;
      });
    } catch (error) {
      this.showError('Fehler beim Erstellen der Excel-Datei');
      this.isLoading = false;
    }
  }

  closeComparisonTable(): void {
    this.showComparisonTable = false;
    this.importResults = null;
  }

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

  openDoubleCodedReviewDialog(): void {
    this.dialog.open(DoubleCodedReviewComponent, {
      width: '90vw',
      maxWidth: '1400px',
      height: '90vh',
      maxHeight: '900px',
      data: {}
    });
  }

  private loadCodingProgressOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.testPersonCodingService.getCodingProgressOverview(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: overview => {
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

    this.testPersonCodingService.getVariableCoverageOverview(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: overview => {
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

    this.testPersonCodingService.getCaseCoverageOverview(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: overview => {
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

    this.testPersonCodingService.getWorkspaceCohensKappaSummary(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: summary => {
          this.workspaceKappaSummary = summary;
        },
        error: () => {
          this.workspaceKappaSummary = null;
        }
      });
  }

  getKappaInterpretationText(kappa: number | null): string {
    if (kappa === null) {
      return 'Keine Daten verfügbar';
    }
    if (kappa < 0) {
      return 'Schlechte Übereinstimmung (weniger als zufällig)';
    }
    if (kappa < 0.2) {
      return 'Schwache Übereinstimmung';
    }
    if (kappa < 0.4) {
      return 'Mäßige Übereinstimmung';
    }
    if (kappa < 0.6) {
      return 'Akzeptable Übereinstimmung';
    }
    if (kappa < 0.8) {
      return 'Gute Übereinstimmung';
    }
    return 'Ausgezeichnete Übereinstimmung';
  }

  getKappaInterpretationClass(kappa: number | null): string {
    if (kappa === null) {
      return 'kappa-no-data';
    }
    if (kappa < 0) {
      return 'kappa-poor';
    }
    if (kappa < 0.2) {
      return 'kappa-poor';
    }
    if (kappa < 0.4) {
      return 'kappa-fair';
    }
    if (kappa < 0.6) {
      return 'kappa-moderate';
    }
    if (kappa < 0.8) {
      return 'kappa-good';
    }
    return 'kappa-excellent';
  }

  onTrainingStart(data: { selectedCoders: Coder[], variableConfigs: VariableConfig[] }): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.testPersonCodingService.generateCoderTrainingPackages(
      workspaceId,
      data.selectedCoders,
      data.variableConfigs
    ).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: packages => {
          const totalResponses = packages.reduce((total, pkg) => total + pkg.responses.length, 0);

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
}
