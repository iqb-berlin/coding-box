import {
  Component, inject, OnInit, OnDestroy
} from '@angular/core';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { CommonModule, DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import * as ExcelJS from 'exceljs';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ValidationStateService, ValidationProgress } from '../../services/validation-state.service';
import { AppService } from '../../../core/services/app.service';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import {
  ValidateCodingCompletenessResponseDto
} from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { CodingValidationResultsDialogComponent } from '../coding-validation-results-dialog/coding-validation-results-dialog.component';

export type ExportFormat = 'json' | 'csv' | 'excel';

@Component({
  selector: 'app-export-dialog',
  templateUrl: './export-dialog.component.html',
  styleUrls: ['./export-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatRadioModule,
    MatProgressBarModule,
    MatIconModule,
    MatDividerModule,
    CommonModule,
    TranslateModule
  ],
  providers: [
    DatePipe
  ]
})
export class ExportDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject<MatDialogRef<ExportDialogComponent>>(MatDialogRef);
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private validationStateService = inject(ValidationStateService);
  private translate = inject(TranslateService);
  private matDialog = inject(MatDialog);
  private destroy$ = new Subject<void>();

  selectedFormat: ExportFormat = 'json';

  validationResults: ValidateCodingCompletenessResponseDto | null = null;
  validationProgress: ValidationProgress | null = null;
  isValidating = false;
  validationCacheKey: string | null = null;
  validationCurrentPage = 1;
  expectedCombinations: ExpectedCombinationDto[] = [];

  ngOnInit(): void {
    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.validationProgress = progress;
        this.isValidating = progress.status === 'loading' || progress.status === 'processing';
      });

    this.validationStateService.validationResults$
      .pipe(takeUntil(this.destroy$))
      .subscribe(results => {
        this.validationResults = results;
        if (results) {
          this.validationCacheKey = results.cacheKey || null;
          // Open validation results dialog when validation completes
          this.openValidationResultsDialog(results);
        }
      });

    const currentResults = this.validationStateService.getValidationResults();
    if (currentResults) {
      this.validationResults = currentResults;
    }

    const currentProgress = this.validationStateService.getValidationProgress();
    this.validationProgress = currentProgress;
    this.isValidating = currentProgress.status === 'loading' || currentProgress.status === 'processing';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onExport(): void {
    this.dialogRef.close(this.selectedFormat);
  }

  // Validation methods
  onValidationFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    if (!this.isExcelFile(file)) {
      this.validationStateService.setValidationError(this.translate.instant('coding.coding-management-manual.errors.invalid-file-type'));
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
        this.validationStateService.updateProgress(10, this.translate.instant('export-dialog.validation.file-loading'));
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
    this.validationCurrentPage = 1;

    this.loadValidationPage(1);
  }

  private loadValidationPage(page: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.validationStateService.setValidationError('Kein Arbeitsbereich ausgewählt');
      return;
    }

    this.validationStateService.updateProgress(80, `Validierung wird durchgeführt (Seite ${page})...`);
    this.validationCurrentPage = page;

    this.testPersonCodingService.validateCodingCompleteness(
      workspaceId,
      this.expectedCombinations,
      page,
      50
    ).subscribe({
      next: results => {
        this.validationStateService.setValidationResults(results);
      },
      error: () => {
        this.validationStateService.setValidationError('Fehler bei der Validierung');
      }
    });
  }

  downloadValidationExcel(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId || !this.validationCacheKey) {
      return;
    }

    this.isValidating = true;

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
        this.isValidating = false;
      },
      error: () => {
        this.isValidating = false;
      }
    });
  }

  openValidationResultsDialog(results: ValidateCodingCompletenessResponseDto): void {
    this.matDialog.open(CodingValidationResultsDialogComponent, {
      width: '90vw',
      maxWidth: '1400px',
      maxHeight: '90vh',
      data: {
        validationResults: results,
        validationCacheKey: this.validationCacheKey,
        expectedCombinations: this.expectedCombinations
      }
    });
  }
}
