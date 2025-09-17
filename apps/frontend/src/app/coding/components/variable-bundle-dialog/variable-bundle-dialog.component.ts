import {
  Component, Inject, OnInit, OnDestroy, inject, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  takeUntil, fromEvent
} from 'rxjs';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { VariableAnalysisItem } from '../../models/variable-analysis-item.model';

export interface VariableBundleGroupDialogData {
  bundleGroup?: VariableBundle;
  isEdit: boolean;
}

@Component({
  selector: 'coding-box-variable-bundle-dialog',
  templateUrl: './variable-bundle-dialog.component.html',
  styleUrls: ['./variable-bundle-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatChipsModule,
    MatTableModule,
    MatCheckboxModule,
    MatPaginatorModule,
    MatSortModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    TranslateModule,
    MatTooltipModule
  ]
})
export class VariableBundleDialogComponent implements OnInit, OnDestroy {
  @ViewChild('unitNameFilterInput') unitNameFilterInput!: ElementRef;
  @ViewChild('variableIdFilterInput') variableIdFilterInput!: ElementRef;

  private fb = inject(FormBuilder);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private destroy$ = new Subject<void>();

  bundleGroupForm!: FormGroup;
  isLoading = false;

  // Variables
  availableVariables: Variable[] = [];
  selectedVariables = new SelectionModel<Variable>(true, []);
  displayedColumns: string[] = ['select', 'unitName', 'variableId'];
  dataSource = new MatTableDataSource<Variable>([]);

  // Variable analysis items
  variableAnalysisItems: VariableAnalysisItem[] = [];
  isLoadingVariableAnalysis = false;
  totalVariableAnalysisRecords = 0;
  variableAnalysisPageIndex = 0;
  variableAnalysisPageSize = 10;
  variableAnalysisPageSizeOptions = [5, 10, 25, 50];

  // Filters
  unitNameFilter = '';
  variableIdFilter = '';
  private readonly debounceTimeMs = 300;

  // Selected variables table
  selectedVariablesDataSource = new MatTableDataSource<Variable>([]);
  selectedVariablesDisplayedColumns: string[] = ['unitName', 'variableId', 'actions'];

  constructor(
    public dialogRef: MatDialogRef<VariableBundleDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableBundleGroupDialogData
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadVariableAnalysisItems();

    if (this.data.bundleGroup?.variables) {
      this.selectedVariablesDataSource.data = [...this.data.bundleGroup.variables];
    }

    // Set up debounce for filter inputs after view is initialized
    setTimeout(() => this.setupFilterDebounce(), 0);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupFilterDebounce(): void {
    // Skip if the ViewChild elements aren't available yet
    if (!this.unitNameFilterInput || !this.variableIdFilterInput) {
      return;
    }

    // Set up debounce for unit name filter
    fromEvent(this.unitNameFilterInput.nativeElement, 'input')
      .pipe(
        debounceTime(this.debounceTimeMs),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.unitNameFilter = this.unitNameFilterInput.nativeElement.value;
        this.applyFilter();
      });

    // Set up debounce for variable ID filter
    fromEvent(this.variableIdFilterInput.nativeElement, 'input')
      .pipe(
        debounceTime(this.debounceTimeMs),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.variableIdFilter = this.variableIdFilterInput.nativeElement.value;
        this.applyFilter();
      });
  }

  initForm(): void {
    this.bundleGroupForm = this.fb.group({
      name: [this.data.bundleGroup?.name || '', Validators.required],
      description: [this.data.bundleGroup?.description || '']
    });
  }

  loadVariableAnalysisItems(page: number = 1, limit: number = 10): void {
    this.isLoadingVariableAnalysis = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.isLoadingVariableAnalysis = false;
      return;
    }

    this.backendService.getVariableAnalysis(
      workspaceId,
      page,
      limit,
      this.unitNameFilter || undefined,
      this.variableIdFilter || undefined
    ).subscribe({
      next: response => {
        // Convert variable analysis items to variable bundles
        this.variableAnalysisItems = response.data;

        // Create unique variables from the items
        const uniqueVariables = new Map<string, Variable>();

        this.variableAnalysisItems.forEach(item => {
          const key = `${item.unitId}|${item.variableId}`;
          if (!uniqueVariables.has(key)) {
            uniqueVariables.set(key, {
              unitName: item.unitId,
              variableId: item.variableId
            });
          }
        });

        this.availableVariables = Array.from(uniqueVariables.values());
        this.dataSource.data = this.availableVariables;

        // Pre-select variables that are already in the bundle group
        if (this.data.bundleGroup?.variables) {
          this.data.bundleGroup.variables.forEach((variable: Variable) => {
            const foundVariable = this.availableVariables.find(
              v => v.unitName === variable.unitName && v.variableId === variable.variableId
            );
            if (foundVariable) {
              this.selectedVariables.select(foundVariable);
            }
          });
        }

        this.totalVariableAnalysisRecords = response.total;
        this.variableAnalysisPageIndex = page - 1;
        this.isLoadingVariableAnalysis = false;
      },
      error: () => {
        this.isLoadingVariableAnalysis = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.loadVariableAnalysisItems(event.pageIndex + 1, event.pageSize);
  }

  applyFilter(): void {
    this.loadVariableAnalysisItems(1, this.variableAnalysisPageSize);
  }

  clearFilters(): void {
    this.unitNameFilter = '';
    this.variableIdFilter = '';

    // Reset the input field values
    if (this.unitNameFilterInput) {
      this.unitNameFilterInput.nativeElement.value = '';
    }
    if (this.variableIdFilterInput) {
      this.variableIdFilterInput.nativeElement.value = '';
    }

    this.loadVariableAnalysisItems(1, this.variableAnalysisPageSize);
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected(): boolean {
    const numSelected = this.selectedVariables.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selectedVariables.clear();
    } else {
      this.dataSource.data.forEach(row => this.selectedVariables.select(row));
    }
  }

  /** The label for the checkbox on the passed row */
  checkboxLabel(row?: Variable): string {
    if (!row) {
      return `${this.isAllSelected() ? 'deselect' : 'select'} all`;
    }
    return `${this.selectedVariables.isSelected(row) ? 'deselect' : 'select'} row ${row.unitName}`;
  }

  /** Add selected variables to the bundle group */
  addSelectedVariables(): void {
    const currentVariables = this.selectedVariablesDataSource.data;
    const newVariables = this.selectedVariables.selected.filter(variable => !currentVariables.some(v => v.unitName === variable.unitName && v.variableId === variable.variableId
    )
    );

    if (newVariables.length > 0) {
      this.selectedVariablesDataSource.data = [...currentVariables, ...newVariables];
      this.selectedVariables.clear();
    }
  }

  /** Remove a variable from the bundle group */
  removeVariable(variable: Variable): void {
    const currentVariables = this.selectedVariablesDataSource.data;
    const updatedVariables = currentVariables.filter(v => !(v.unitName === variable.unitName && v.variableId === variable.variableId)
    );

    this.selectedVariablesDataSource.data = updatedVariables;
  }

  onSubmit(): void {
    if (this.bundleGroupForm.invalid) {
      return;
    }

    const bundleGroup: VariableBundle = {
      id: this.data.bundleGroup?.id || 0,
      ...this.bundleGroupForm.value,
      createdAt: this.data.bundleGroup?.createdAt || new Date(),
      updatedAt: new Date(),
      variables: this.selectedVariablesDataSource.data
    };

    this.dialogRef.close(bundleGroup);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
