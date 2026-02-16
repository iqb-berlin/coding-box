import {
  Component, Inject, OnInit, OnDestroy,
  ViewChild,
  inject,
  HostListener
} from '@angular/core';
import { Subject, debounceTime } from 'rxjs';
import {
  MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog
} from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';

import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CommonModule, NgClass } from '@angular/common';

import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { FileService } from '../../../../shared/services/file/file.service';
import { CodingJobBackendService } from '../../../services/coding-job-backend.service';
import { AppService } from '../../../../core/services/app.service';
import { CodingJob } from '../../../models/coding-job.model';
import { SchemeEditorDialogComponent } from '../../scheme-editor-dialog/scheme-editor-dialog.component';
import { base64ToUtf8, utf8ToBase64 } from '../../../../shared/utils/common-utils';

import { UnitsReplay, UnitsReplayUnit } from '../../../../replay/services/units-replay.service';

interface CodingResult {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  testPerson: string;
  code?: string | number;
  codeLabel?: string;
  score?: number;
  codingIssueOptionLabel?: string;
  givenCode?: string | number;
  givenScore?: number;
}

@Component({
  selector: 'coding-box-coding-job-result-dialog',
  templateUrl: './coding-job-result-dialog.component.html',
  styleUrls: ['./coding-job-result-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatProgressSpinner,
    MatButtonModule,
    MatIcon,
    NgClass,
    MatTooltip
  ]
})
export class CodingJobResultDialogComponent implements OnInit, OnDestroy {
  @ViewChild(MatSort) sort!: MatSort;

  private codingJobBackendService = inject(CodingJobBackendService);
  private fileService = inject(FileService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  isLoading = true;
  dataSource = new MatTableDataSource<CodingResult>([]);
  displayedColumns: string[] = [
    'unitName',
    'testPerson',
    'variableId',
    'code',
    'score',
    'codingIssueOption',
    'actions'
  ];

  private refreshSubject = new Subject<void>();
  private isDestroyed = false;

  unitNameFilter = '';
  variableFilter = '';
  codingIssueFilter = '';
  testPersonFilter = '';

  constructor(
    public dialogRef: MatDialogRef<CodingJobResultDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { codingJob: CodingJob; workspaceId: number }
  ) { }

  ngOnInit(): void {
    this.loadCodingResults();
    this.setupAutoRefresh();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.refreshSubject.complete();
  }

  private setupAutoRefresh(): void {
    this.refreshSubject.pipe(debounceTime(1000)).subscribe(() => {
      if (!this.isDestroyed) {
        this.loadCodingResults();
      }
    });
  }

  @HostListener('window:focus', ['$event'])
  onWindowFocus(): void {
    this.refreshSubject.next();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.filterPredicate = this.createFilterPredicate();
    this.applyFilters();
  }

  loadCodingResults(): void {
    this.isLoading = true;

    this.codingJobBackendService.getCodingJobUnits(this.data.workspaceId, this.data.codingJob.id).subscribe({
      next: unitsResult => {
        if (!unitsResult || unitsResult.length === 0) {
          this.isLoading = false;
          this.dataSource.data = [];
          return;
        }

        this.codingJobBackendService.getCodingProgress(this.data.workspaceId, this.data.codingJob.id).subscribe({
          next: progressResult => {
            this.dataSource.data = unitsResult.map(unit => {
              const testPerson = `${unit.personLogin}@${unit.personCode}@${unit.bookletName}`;
              const progressKey = `${testPerson}::${unit.bookletName}::${unit.unitName}::${unit.variableId}`;
              const progress = progressResult[progressKey] as { id?: string; label?: string; score?: number; codingIssueOption?: number } | undefined;

              return {
                unitName: unit.unitName,
                unitAlias: unit.unitAlias,
                variableId: unit.variableId,
                variableAnchor: unit.variableAnchor,
                bookletName: unit.bookletName,
                personLogin: unit.personLogin,
                personCode: unit.personCode,
                personGroup: unit.personGroup,
                testPerson: `${unit.personLogin}@${unit.personCode}@${unit.personGroup}`,
                code: progress?.id,
                codeLabel: progress?.label,
                score: progress?.score,
                codingIssueOptionLabel: progress?.codingIssueOption ? this.getCodingIssueOption(progress.codingIssueOption) : undefined,
                givenCode: progress?.codingIssueOption && progress?.id && this.isPositiveCode(progress.id) ? progress.id : undefined,
                givenScore: progress?.codingIssueOption && progress?.score !== undefined && progress?.score !== null ? progress.score : undefined
              };
            });
            this.isLoading = false;
          },
          error: () => {
            this.snackBar.open('Fehler beim Laden der Kodierergebnisse', 'Schließen', { duration: 3000 });
            this.isLoading = false;
          }
        });
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der Kodiereinheiten', 'Schließen', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  private createFilterPredicate(): (data: CodingResult, filter: string) => boolean {
    return (data: CodingResult, filter: string): boolean => {
      const filters = JSON.parse(filter);

      // Check unit name filter (includes unitName and unitAlias)
      const unitFilter = filters.unitName?.toLowerCase() || '';
      if (unitFilter && !data.unitName.toLowerCase().includes(unitFilter) &&
        !(data.unitAlias && data.unitAlias.toLowerCase().includes(unitFilter))) {
        return false;
      }

      // Check variable filter
      const variableFilter = filters.variable?.toLowerCase() || '';
      if (variableFilter && !data.variableId.toLowerCase().includes(variableFilter)) {
        return false;
      }

      // Check coding issue filter
      const codingIssueFilter = filters.codingIssue?.toLowerCase() || '';
      if (codingIssueFilter && !(data.codingIssueOptionLabel && data.codingIssueOptionLabel.toLowerCase().includes(codingIssueFilter))) {
        return false;
      }

      // Check test person filter
      const testPersonFilter = filters.testPerson?.toLowerCase() || '';
      return !(testPersonFilter && !data.testPerson.toLowerCase().includes(testPersonFilter));
    };
  }

  applyFilters(): void {
    const filterObj = {
      unitName: this.unitNameFilter,
      variable: this.variableFilter,
      codingIssue: this.codingIssueFilter,
      testPerson: this.testPersonFilter
    };
    this.dataSource.filter = JSON.stringify(filterObj);
  }

  onUnitNameFilterChange(): void {
    this.applyFilters();
  }

  onVariableFilterChange(): void {
    this.applyFilters();
  }

  onCodingIssueFilterChange(): void {
    this.applyFilters();
  }

  onTestPersonFilterChange(): void {
    this.applyFilters();
  }

  applyCodingResults(): void {
    this.isLoading = true;
    this.codingJobBackendService.applyCodingResults(this.data.workspaceId, this.data.codingJob.id).subscribe({
      next: result => {
        this.isLoading = false;
        let message = this.translateService.instant(result.messageKey, result.messageParams || {});
        if (result.success) {
          if (result.updatedResponsesCount > 0) {
            message += `\n\nAktualisiert: ${result.updatedResponsesCount} Antworten`;
          }
          if (result.skippedReviewCount > 0) {
            message += `\nÜbersprungen (manuelle Prüfung benötigt): ${result.skippedReviewCount} Antworten`;
          }
          this.snackBar.open(`Ergebnisse erfolgreich angewendet!\n${message}`, 'Schließen', {
            duration: 5000,
            panelClass: ['success-snackbar']
          });
          this.dialogRef.close({ resultsApplied: true });
        } else {
          this.snackBar.open(`Fehler beim Anwenden der Ergebnisse: ${message}`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      },
      error: error => {
        this.isLoading = false;
        this.snackBar.open(`Fehler beim Anwenden der Kodierergebnisse: ${error.message || error}`, 'Schließen', { duration: 5000 });
      }
    });
  }

  getCodeDisplay(result: CodingResult): string {
    if (result.code !== undefined && result.code !== null) {
      if (this.isCodingIssueOption(result)) {
        if (result.givenCode !== undefined && result.givenCode !== null) {
          return `${result.givenCode} (unsicher)`;
        }
        return '';
      }
      return result.code.toString();
    }
    return 'Nicht kodiert';
  }

  getScoreDisplay(result: CodingResult): string {
    if (this.isCodingIssueOption(result)) {
      if (result.givenScore !== undefined && result.givenScore !== null) {
        return `${result.givenScore} (unsicher)`;
      }
      return result.codeLabel || '';
    }
    if (result.score !== undefined && result.score !== null) {
      return result.score.toString();
    }
    if (this.hasCode(result)) {
      return '';
    }
    return 'Nicht kodiert';
  }

  hasCode(result: CodingResult): boolean {
    return result.code !== undefined && result.code !== null;
  }

  private isPositiveCode(code: string | number): boolean {
    if (typeof code === 'number') {
      return code > 0;
    }
    const numCode = parseInt(code, 10);
    return !Number.isNaN(numCode) && numCode > 0;
  }

  isCodingIssueOption(result: CodingResult): boolean {
    if (result.code !== undefined && result.code !== null) {
      const codeNum = typeof result.code === 'number' ? result.code : parseInt(result.code.toString(), 10);
      if (codeNum < 0) return true;
    }
    return result.codingIssueOptionLabel !== null && result.codingIssueOptionLabel !== undefined;
  }

  isNewCodeNeeded(result: CodingResult): boolean {
    if (result.code !== undefined && result.code !== null) {
      const codeNum = typeof result.code === 'number' ? result.code : parseInt(result.code.toString(), 10);
      if (codeNum === -2) return true;
    }

    if (result.codingIssueOptionLabel) {
      const expectedLabel = this.getCodingIssueOption(-2);
      // Check for exact match or if label contains the expected text
      return result.codingIssueOptionLabel === expectedLabel ||
        result.codingIssueOptionLabel.includes('Neuer Code') ||
        result.codingIssueOptionLabel.includes('new-code-needed');
    }
    return false;
  }

  getCodingIssueOption(codingIssueOptionId: number): string {
    const keyMapping: { [key: number]: string } = {
      [-1]: 'code-selector.coding-issue-options.code-assignment-uncertain',
      [-2]: 'code-selector.coding-issue-options.new-code-needed',
      [-3]: 'code-selector.coding-issue-options.invalid-joke-answer',
      [-4]: 'code-selector.coding-issue-options.technical-problems'
    };

    const translationKey = keyMapping[codingIssueOptionId];
    if (translationKey) {
      return this.translateService.instant(translationKey);
    }
    return 'Unknown';
  }

  getCellClasses(result: CodingResult): string {
    if (this.isCodingIssueOption(result)) {
      if (result.givenCode !== undefined && result.givenCode !== null) {
        return 'uncertain-with-code';
      }
      return 'uncertain';
    }
    return this.hasCode(result) ? 'coded' : 'not-coded';
  }

  reviewCodingResult(result: CodingResult): void {
    if (!result || !this.isCodingIssueOption(result)) {
      this.snackBar.open('Nur Kodierungs-Hinweis-Fälle können überprüft werden', 'Schließen', { duration: 3000 });
      return;
    }

    const loadingSnackBar = this.snackBar.open('Öffne Kodierungs-Interface...', '', { duration: 3000 });

    this.appService.createToken(this.data.workspaceId, this.appService.loggedUser?.sub || '', 3600).subscribe({
      next: (token: string) => {
        loadingSnackBar.dismiss();

        const testPerson = `${result.personLogin}@${result.personCode}@${result.personGroup || ''}@${result.bookletName}`;

        const reviewUnit: UnitsReplayUnit = {
          id: 0, // Not needed for replay
          name: result.unitName,
          alias: result.unitAlias,
          bookletId: 0, // Not needed for replay
          testPerson: testPerson,
          variableId: result.variableId,
          variableAnchor: result.variableAnchor
        };

        const unitsData: UnitsReplay = {
          id: this.data.codingJob.id, // Use original coding job ID
          name: `${this.data.codingJob.name} - Review: ${result.variableId}`,
          units: [reviewUnit],
          currentUnitIndex: 0
        };

        const serializedUnits = this.serializeUnitsData(unitsData);

        const queryParams = {
          auth: token,
          mode: 'coding',
          unitsData: serializedUnits
        };

        const unitName = result.unitAlias || result.unitName || '';
        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${testPerson}/${unitName}/0/${result.variableId}`],
              { queryParams: queryParams })
          );

        window.open(`#/${url}`, '_blank');
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open('Fehler beim Erstellen des Authentisierungs-Tokens', 'Schließen', { duration: 3000 });
      }
    });
  }

  editCodingScheme(result: CodingResult): void {
    if (!result || !this.isNewCodeNeeded(result)) {
      this.snackBar.open('Nur "Neuer Code erforderlich" Fälle können bearbeitet werden', 'Schließen', { duration: 3000 });
      return;
    }

    const codingSchemeRef = result.unitAlias;
    if (!codingSchemeRef) {
      this.snackBar.open('Kein Kodierungsschema-Referenz gefunden für diese Einheit', 'Schließen', { duration: 3000 });
      return;
    }

    this.fileService.getCodingSchemeFile(this.data.workspaceId, codingSchemeRef).subscribe({
      next: schemeFile => {
        if (!schemeFile) {
          this.snackBar.open('Kodierungsschema-Datei nicht gefunden', 'Schließen', { duration: 3000 });
          return;
        }

        const schemeContent = base64ToUtf8(schemeFile.base64Data);

        const dialogRef = this.dialog.open(SchemeEditorDialogComponent, {
          width: '90vw',
          height: '90vh',
          maxWidth: '1200px',
          data: {
            workspaceId: this.data.workspaceId,
            fileId: codingSchemeRef, // Use the reference as fileId for saving logic
            fileName: schemeFile.filename,
            content: schemeContent
          }
        });

        dialogRef.afterClosed().subscribe(dialogResult => {
          if (dialogResult === true) {
            this.snackBar.open('Kodierungsschema erfolgreich aktualisiert', 'Schließen', { duration: 3000 });
            this.loadCodingResults();
          }
        });
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden des Kodierungsschemas', 'Schließen', { duration: 3000 });
      }
    });
  }

  private serializeUnitsData(unitsData: UnitsReplay): string {
    try {
      const jsonString = JSON.stringify(unitsData);
      return utf8ToBase64(jsonString);
    } catch (error) {
      return '';
    }
  }
}
