import {
  Component, Inject, inject, OnInit,
  ViewChild
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CommonModule, NgClass } from '@angular/common';

import { MatSnackBar } from '@angular/material/snack-bar';
import { BackendService } from '../../../../services/backend.service';
import { SearchFilterComponent } from '../../../../shared/search-filter/search-filter.component';
import { CodingJob } from '../../../models/coding-job.model';

interface CodingResult {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  testPerson: string;
  code?: string;
  codeLabel?: string;
  score?: number;
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
    SearchFilterComponent
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
    'score'
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

    this.backendService.startCodingJob(this.data.workspaceId, this.data.codingJob.id).subscribe({
      next: unitsResult => {
        if (!unitsResult || unitsResult.total === 0) {
          this.isLoading = false;
          this.dataSource.data = [];
          return;
        }

        this.backendService.getCodingProgress(this.data.workspaceId, this.data.codingJob.id).subscribe({
          next: progressResult => {
            const codingResults: CodingResult[] = unitsResult.items.map(unit => {
              const testPerson = `${unit.personLogin}@${unit.personCode}@${unit.bookletName}`;
              const progressKey = `${testPerson}::${unit.bookletName}::${unit.unitName}::${unit.variableId}`;
              const progress = progressResult[progressKey] as { id?: string; score?: number } | undefined;

              return {
                unitName: unit.unitName,
                unitAlias: unit.unitAlias,
                variableId: unit.variableId,
                bookletName: unit.bookletName,
                personLogin: unit.personLogin,
                personCode: unit.personCode,
                testPerson: `${unit.personLogin}@${unit.personCode}`,
                code: progress?.id,
                score: progress?.score
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

  getCodeDisplay(result: CodingResult): string {
    if (result.code !== undefined && result.code !== null) {
      return result.code;
    }
    return 'Nicht kodiert';
  }

  getScoreDisplay(result: CodingResult): string {
    if (result.score !== undefined && result.score !== null) {
      return result.score.toString();
    }
    return 'Nicht kodiert';
  }

  hasCode(result: CodingResult): boolean {
    return result.code !== undefined && result.code !== null;
  }
}
