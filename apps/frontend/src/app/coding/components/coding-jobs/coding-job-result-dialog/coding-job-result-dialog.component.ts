import {
  Component, Inject, inject, OnInit,
  ViewChild
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorIntl, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CommonModule, NgClass } from '@angular/common';

import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { BackendService } from '../../../../services/backend.service';
import { SearchFilterComponent } from '../../../../shared/search-filter/search-filter.component';
import { CodingJob } from '../../../models/coding-job.model';
import { GermanPaginatorIntl } from '../../../../shared/services/german-paginator-intl.service';

interface CodingResult {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  testPerson: string;
  code?: string | number;
  codeLabel?: string;
  score?: number;
  codingIssueOptionLabel?: string;
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
    MatPaginatorModule,
    MatProgressSpinner,
    MatButtonModule,
    MatIcon,
    NgClass,
    SearchFilterComponent,
    MatTooltip
  ],
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ]
})
export class CodingJobResultDialogComponent implements OnInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);

  isLoading = true;
  dataSource = new MatTableDataSource<CodingResult>([]);
  displayedColumns: string[] = [
    'unitName',
    'testPerson',
    'variableId',
    'code',
    'score',
    'codingIssueOption'
  ];

  constructor(
    public dialogRef: MatDialogRef<CodingJobResultDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { codingJob: CodingJob; workspaceId: number }
  ) {}

  ngOnInit(): void {
    this.loadCodingResults();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  loadCodingResults(): void {
    this.isLoading = true;

    this.backendService.getCodingJobUnits(this.data.workspaceId, this.data.codingJob.id).subscribe({
      next: unitsResult => {
        if (!unitsResult || unitsResult.length === 0) {
          this.isLoading = false;
          this.dataSource.data = [];
          return;
        }

        this.backendService.getCodingProgress(this.data.workspaceId, this.data.codingJob.id).subscribe({
          next: progressResult => {
            const codingResults: CodingResult[] = unitsResult.map(unit => {
              const testPerson = `${unit.personLogin}@${unit.personCode}@${unit.bookletName}`;
              const progressKey = `${testPerson}::${unit.bookletName}::${unit.unitName}::${unit.variableId}`;
              const progress = progressResult[progressKey] as { id?: string; label?: string; score?: number; codingIssueOption?: number } | undefined;

              return {
                unitName: unit.unitName,
                unitAlias: unit.unitAlias,
                variableId: unit.variableId,
                bookletName: unit.bookletName,
                personLogin: unit.personLogin,
                personCode: unit.personCode,
                testPerson: `${unit.personLogin}@${unit.personCode}`,
                code: progress?.id,
                codeLabel: progress?.label,
                score: progress?.score,
                codingIssueOptionLabel: progress?.codingIssueOption ? this.getCodingIssueOption(progress.codingIssueOption) : undefined
              };
            });

            this.dataSource.data = codingResults;
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

  applyFilter(filterValue: string): void {
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  applyCodingResults(): void {
    this.isLoading = true;
    this.backendService.applyCodingResults(this.data.workspaceId, this.data.codingJob.id).subscribe({
      next: result => {
        this.isLoading = false;
        let message = result.message;
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
        return '';
      }
      return result.code.toString();
    }
    return 'Nicht kodiert';
  }

  getScoreDisplay(result: CodingResult): string {
    if (this.isCodingIssueOption(result)) {
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

  isCodingIssueOption(result: CodingResult): boolean {
    if (result.code === undefined || result.code === null) return false;
    const codeNum = typeof result.code === 'number' ? result.code : parseInt(result.code.toString(), 10);
    return codeNum < 0;
  }

  getCodingIssueOption(codingIssueOptionId: number): string {
    const mapping: { [key: number]: string } = {
      [-1]: 'Code-Vergabe unsicher',
      [-2]: 'Neuer Code nötig',
      [-3]: 'Ungültig (Spaßantwort)',
      [-4]: 'Technische Probleme'
    };
    return mapping[codingIssueOptionId] || 'Unknown';
  }

  getCellClasses(result: CodingResult): string {
    if (this.isCodingIssueOption(result)) {
      return 'uncertain';
    }
    return this.hasCode(result) ? 'coded' : 'not-coded';
  }
}
