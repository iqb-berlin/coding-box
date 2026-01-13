import {
  Component,
  Inject,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CodingService } from '../../services/coding.service';
import { AppService } from '../../../core/services/app.service';
import { VariableAnalysisItemDto } from '../../../../../../../api-dto/coding/variable-analysis-item.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';

export interface VariableAnalysisDialogData {
  workspaceId: number;
  initialData?: {
    data: VariableAnalysisItemDto[];
    total: number;
    page: number;
    limit: number;
  };
}

@Component({
  selector: 'coding-box-variable-analysis-dialog',
  templateUrl: './variable-analysis-dialog.component.html',
  styleUrls: ['./variable-analysis-dialog.component.scss'],
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule
  ]
})
export class VariableAnalysisDialogComponent implements OnInit {
  variableAnalysisData: VariableAnalysisItemDto[] = [];
  variableAnalysisDataSource = new MatTableDataSource<VariableAnalysisItemDto>([]);
  variableAnalysisColumns: string[] = [
    'replayUrl', 'unitId', 'variableId',
    'code', 'score', 'occurrenceCount',
    'totalCount', 'relativeOccurrence'
  ];

  totalVariableAnalysisRecords = 0;
  variableAnalysisPageIndex = 0;
  variableAnalysisPageSize = 200;
  variableAnalysisPageSizeOptions = [100, 200, 500, 1000];
  unitIdFilter = '';
  variableIdFilter = '';
  isLoadingVariableAnalysis = false;
  variableAnalysisFilterChanged = new Subject<void>();

  @ViewChild(MatSort) sort!: MatSort;

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(
    public dialogRef: MatDialogRef<VariableAnalysisDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableAnalysisDialogData,
    private codingService: CodingService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.variableAnalysisFilterChanged.pipe(
      debounceTime(500),
      distinctUntilChanged()
    ).subscribe(() => {
      this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
    });

    if (this.data.initialData) {
      this.variableAnalysisData = this.data.initialData.data;
      this.variableAnalysisDataSource.data = this.data.initialData.data;
      this.totalVariableAnalysisRecords = this.data.initialData.total;
      this.variableAnalysisPageIndex = this.data.initialData.page - 1; // MatPaginator uses 0-based index
      this.variableAnalysisPageSize = this.data.initialData.limit;
    } else {
      this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
    }
  }

  fetchVariableAnalysis(page: number = 1, limit: number = 100): void {
    const workspaceId = this.data.workspaceId;
    this.isLoadingVariableAnalysis = true;

    const unitId = this.unitIdFilter.trim() || undefined;
    const variableId = this.variableIdFilter.trim() || undefined;

    this.codingService.getVariableAnalysis(
      workspaceId,
      page,
      limit,
      unitId,
      variableId
    )
      .subscribe({
        next: response => {
          this.variableAnalysisData = response.data;
          this.variableAnalysisDataSource.data = response.data;
          this.totalVariableAnalysisRecords = response.total;
          this.variableAnalysisPageIndex = response.page - 1; // MatPaginator uses 0-based index
          this.variableAnalysisPageSize = response.limit;

          setTimeout(() => {
            if (this.sort) {
              this.variableAnalysisDataSource.sort = this.sort;
            }
          });

          this.isLoadingVariableAnalysis = false;
        },
        error: () => {
          this.isLoadingVariableAnalysis = false;
          this.snackBar.open('Fehler beim Abrufen der Variablenanalyse', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      });
  }

  onVariableAnalysisPaginatorChange(event: PageEvent): void {
    const page = event.pageIndex + 1; // Convert from 0-based to 1-based index
    const limit = event.pageSize;
    this.fetchVariableAnalysis(page, limit);
  }

  clearVariableAnalysisFilters(): void {
    this.unitIdFilter = '';
    this.variableIdFilter = '';
    this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
  }

  onVariableAnalysisFilterChange(): void {
    this.variableAnalysisFilterChanged.next();
  }

  close(): void {
    this.dialogRef.close();
  }
}
