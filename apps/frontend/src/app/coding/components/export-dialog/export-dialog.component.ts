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
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
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
    TranslateModule,
    MatButtonToggleGroup,
    MatButtonToggle
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
  trainingRequiredFilter: 'all' | 'true' | 'false' = 'all';

  validationResults: ValidateCodingCompletenessResponseDto | null = null;
  validationProgress: ValidationProgress | null = null;
  isValidating = false;
  validationCacheKey: string | null = null;
  validationCurrentPage = 1;
  expectedCombinations: ExpectedCombinationDto[] = [];
  private readonly maxDisplayedMappingErrors = 5;

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
    const trainingRequired = this.trainingRequiredFilter === 'all' ? undefined : this.trainingRequiredFilter === 'true';
    this.dialogRef.close({
      format: this.selectedFormat,
      trainingRequired
    });
  }

  // Validation methods
  onValidationFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    if (!this.isExcelFile(file)) {
      this.validationStateService.setValidationError(this.translate.instant('export-dialog.validation.invalid-file-type'));
      return;
    }

    this.validationStateService.startValidation();
    setTimeout(() => {
      this.readExcelFile(file);
    }, 0);
  }

  private isExcelFile(file: File): boolean {
    return file.name.toLowerCase().endsWith('.xlsx');
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
          headers.push(this.normalizeValidationHeader(this.getCellText(cell)));
        });

        this.validationStateService.updateProgress(40, 'Daten werden extrahiert...');
        const data: Record<string, string>[] = [];
        const totalRows = worksheet.rowCount - 1;

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
          const row = worksheet.getRow(rowNumber);
          const rowData: Record<string, string> = {};

          headers.forEach((header, index) => {
            const cell = row.getCell(index + 1);
            rowData[header] = this.getCellText(cell);
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
        const { expectedCombinations, errors } = this.mapToExpectedCombinations(data);
        if (errors.length > 0) {
          const displayedErrors = errors.slice(0, this.maxDisplayedMappingErrors).join(' ');
          const additionalErrorCount = Math.max(0, errors.length - this.maxDisplayedMappingErrors);
          this.validationStateService.setValidationError(
            additionalErrorCount > 0 ?
              `${displayedErrors} Weitere ${additionalErrorCount} Zeilen enthalten Fehler.` :
              displayedErrors
          );
          return;
        }

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

  private mapToExpectedCombinations(data: Record<string, string>[]): {
    expectedCombinations: ExpectedCombinationDto[];
    errors: string[];
  } {
    const errors: string[] = [];
    const expectedCombinations = data.map((item, index) => {
      const unitKey = this.getFirstValue(item, ['unit_key', 'unit_name', 'unitname']);
      const unitAlias = this.getFirstValue(item, ['unit_alias', 'unitalias']);
      const loginName = this.getFirstValue(item, ['login_name', 'person_login', 'loginname', 'personlogin', 'login']);
      const loginCode = this.getFirstValue(item, ['login_code', 'person_code', 'logincode', 'personcode']);
      const personGroup = this.getFirstValue(item, ['person_group', 'login_group', 'persongroup', 'logingroup', 'group']);
      const bookletId = this.getFirstValue(item, ['booklet_id', 'booklet_name', 'bookletid', 'bookletname']);
      const variableId = this.getFirstValue(item, ['variable_id']);
      const variablePage = this.getFirstValue(item, ['variable_page']);
      const variableAnchor = this.getFirstValue(item, ['variable_anchor']);

      const missingFields: string[] = [];
      if (!unitKey && !unitAlias) missingFields.push('unit_key/unit_alias');
      if (!loginName) missingFields.push('login_name/person_login');
      if (!loginCode) missingFields.push('login_code/person_code');
      if (!bookletId) missingFields.push('booklet_id/booklet_name');
      if (!variableId) missingFields.push('variable_id');

      if (missingFields.length > 0) {
        errors.push(`Zeile ${index + 2}: Pflichtfelder fehlen (${missingFields.join(', ')}).`);
      }

      return {
        unit_key: unitKey || unitAlias,
        unit_alias: unitAlias || undefined,
        login_name: loginName,
        login_code: loginCode,
        person_group: personGroup || undefined,
        booklet_id: bookletId,
        variable_id: variableId,
        variable_page: variablePage || undefined,
        variable_anchor: variableAnchor || undefined
      };
    });

    return { expectedCombinations, errors };
  }

  private normalizeValidationHeader(header: string): string {
    return header
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  private getFirstValue(
    row: Record<string, string>,
    candidates: string[]
  ): string {
    for (const candidate of candidates) {
      const value = row[candidate]?.trim();
      if (value) {
        return value;
      }
    }
    return '';
  }

  private getCellText(cell: ExcelJS.Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      const objectValue = value as unknown as Record<string, unknown>;
      if (typeof objectValue.text === 'string') {
        return objectValue.text.trim();
      }
      if (Array.isArray(objectValue.richText)) {
        return objectValue.richText
          .map(part => (
            typeof part === 'object' && part && 'text' in part ? String(part.text) : ''
          ))
          .join('')
          .trim();
      }
      if (objectValue.result !== undefined && objectValue.result !== null) {
        return String(objectValue.result).trim();
      }
    }
    return String(value).trim();
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
