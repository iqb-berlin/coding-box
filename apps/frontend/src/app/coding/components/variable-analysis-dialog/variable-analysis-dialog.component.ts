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
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { VariableAnalysisItemDto } from '../../../../../../../api-dto/coding/variable-analysis-item.dto';

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
  // Variable analysis data
  variableAnalysisData: VariableAnalysisItemDto[] = [];
  variableAnalysisDataSource = new MatTableDataSource<VariableAnalysisItemDto>([]);
  variableAnalysisColumns: string[] = [
    'replayUrl', 'unitId', 'variableId',
    'code', 'description', 'score', 'occurrenceCount',
    'totalCount', 'relativeOccurrence'
  ];

  totalVariableAnalysisRecords = 0;

  variableAnalysisPageIndex = 0;

  variableAnalysisPageSize = 100;

  variableAnalysisPageSizeOptions = [10, 25, 50, 100, 200];

  // Filters
  unitIdFilter = '';

  variableIdFilter = '';

  // Loading state
  isLoadingVariableAnalysis = false;

  // Filter debounce
  variableAnalysisFilterChanged = new Subject<void>();

  @ViewChild(MatSort) sort!: MatSort;

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(
    public dialogRef: MatDialogRef<VariableAnalysisDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableAnalysisDialogData,
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // Set up filter debounce
    this.variableAnalysisFilterChanged.pipe(
      debounceTime(500),
      distinctUntilChanged()
    ).subscribe(() => {
      this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
    });

    // If initial data is provided, use it
    if (this.data.initialData) {
      this.variableAnalysisData = this.data.initialData.data;
      this.variableAnalysisDataSource.data = this.data.initialData.data;
      this.totalVariableAnalysisRecords = this.data.initialData.total;
      this.variableAnalysisPageIndex = this.data.initialData.page - 1; // MatPaginator uses 0-based index
      this.variableAnalysisPageSize = this.data.initialData.limit;
    } else {
      // Otherwise fetch the data
      this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
    }
  }

  fetchVariableAnalysis(page: number = 1, limit: number = 100): void {
    const workspaceId = this.data.workspaceId;
    this.isLoadingVariableAnalysis = true;

    // Get filter values, trimming whitespace and only passing non-empty values
    const unitId = this.unitIdFilter.trim() || undefined;
    const variableId = this.variableIdFilter.trim() || undefined;

    this.backendService.getVariableAnalysis(
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

          // Set up sorting for the variable analysis table
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

    // Reset to first page and refresh data
    this.fetchVariableAnalysis(1, this.variableAnalysisPageSize);
  }

  onVariableAnalysisFilterChange(): void {
    this.variableAnalysisFilterChanged.next();
  }

  close(): void {
    this.dialogRef.close();
  }
}
