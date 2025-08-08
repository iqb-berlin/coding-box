import {
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import * as ExcelJS from 'exceljs';
import { Subject, takeUntil } from 'rxjs';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { AppService } from '../../../services/app.service';
import {
  ValidationProgress,
  ValidationStateService
} from '../../services/validation-state.service';

@Component({
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  imports: [
    TranslateModule,
    MatAnchor,
    CodingJobsComponent,
    MatIcon,
    MatButton,
    MatProgressBarModule,
    VariableBundleManagerComponent,
    CommonModule
  ]
})
export class CodingManagementManualComponent implements OnInit, OnDestroy {
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private validationStateService = inject(ValidationStateService);
  private destroy$ = new Subject<void>();

  validationResults: ValidateCodingCompletenessResponseDto | null = null;
  validationProgress: ValidationProgress | null = null;
  isLoading = false;

  ngOnInit(): void {
    // Subscribe to validation progress updates
    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.validationProgress = progress;
        this.isLoading = progress.status === 'loading' || progress.status === 'processing';

        if (progress.status === 'error') {
          this.showError(progress.error || 'Fehler bei der Validierung');
        }
      });

    // Subscribe to validation results
    this.validationStateService.validationResults$
      .pipe(takeUntil(this.destroy$))
      .subscribe(results => {
        this.validationResults = results;

        if (results) {
          this.showSuccess(`Validierung abgeschlossen. ${results.missing} von ${results.total} Kombinationen fehlen.`);
        }
      });

    // Restore previous validation state if available
    const currentResults = this.validationStateService.getValidationResults();
    if (currentResults) {
      this.validationResults = currentResults;
    }

    const currentProgress = this.validationStateService.getValidationProgress();
    this.validationProgress = currentProgress;
    this.isLoading = currentProgress.status === 'loading' || currentProgress.status === 'processing';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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

    // Start validation process
    this.validationStateService.startValidation();

    // Process file in the background
    setTimeout(() => {
      this.readExcelFile(file);
    }, 0);
  }

  /**
   * Check if the file is an Excel file
   */
  private isExcelFile(file: File): boolean {
    return file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  }

  /**
   * Read Excel file and parse data using exceljs
   */
  private readExcelFile(file: File): void {
    const workbook = new ExcelJS.Workbook();
    const reader = new FileReader();

    reader.onload = async (e: ProgressEvent<FileReader>) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;

        // Update progress
        this.validationStateService.updateProgress(10, 'Excel-Datei wird geladen...');

        await workbook.xlsx.load(buffer);
        this.validationStateService.updateProgress(30, 'Excel-Datei wird verarbeitet...');

        // Get the first worksheet
        const worksheet = workbook.getWorksheet(1);
        if (!worksheet || worksheet.rowCount <= 1) {
          this.validationStateService.setValidationError('Die Datei enthält keine gültigen Daten');
          return;
        }

        // Extract headers from the first row
        const headers: string[] = [];
        worksheet.getRow(1).eachCell(cell => {
          headers.push(cell.value?.toString() || '');
        });

        this.validationStateService.updateProgress(40, 'Daten werden extrahiert...');

        // Extract data from the remaining rows
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

          // Update progress every 100 rows or at the end
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

    // Read the file as an ArrayBuffer for exceljs
    reader.readAsArrayBuffer(file);
  }

  /**
   * Map parsed data to ExpectedCombinationDto[]
   */
  private mapToExpectedCombinations(data: Record<string, string>[]): ExpectedCombinationDto[] {
    return data.map(item => ({
      unit_key: item.unit_key || '',
      login_name: item.login_name || '',
      login_code: item.login_code || '',
      booklet_id: item.booklet_id || '',
      variable_id: item.variable_id || ''
    }));
  }

  /**
   * Validate coding completeness
   */
  private validateCodingCompleteness(expectedCombinations: ExpectedCombinationDto[]): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.validationStateService.setValidationError('Kein Arbeitsbereich ausgewählt');
      return;
    }

    this.validationStateService.updateProgress(80, 'Validierung wird durchgeführt...');

    this.testPersonCodingService.validateCodingCompleteness(workspaceId, expectedCombinations)
      .subscribe({
        next: results => {
          this.validationStateService.setValidationResults(results);
        },
        error: () => {
          this.validationStateService.setValidationError('Fehler bei der Validierung');
        }
      });
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  /**
   * Show success message
   */
  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['success-snackbar']
    });
  }
}
