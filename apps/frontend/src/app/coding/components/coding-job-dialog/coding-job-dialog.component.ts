import {
  Component, Inject, OnInit, inject
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
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { TranslateModule } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import { CodingJob, VariableBundle, Variable } from '../../models/coding-job.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { VariableAnalysisItem } from '../../models/variable-analysis-item.model';
import { VariableBundleService } from '../../services/variable-bundle.service';

export interface CodingJobDialogData {
  codingJob?: CodingJob;
  isEdit: boolean;
}

@Component({
  selector: 'coding-box-coding-job-dialog',
  templateUrl: './coding-job-dialog.component.html',
  styleUrls: ['./coding-job-dialog.component.scss'],
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
    MatTabsModule,
    MatExpansionModule,
    TranslateModule
  ]
})
export class CodingJobDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private variableBundleGroupService = inject(VariableBundleService);

  codingJobForm!: FormGroup;
  isLoading = false;

  // Variables
  variableBundles: Variable[] = [];
  selectedVariableBundles = new SelectionModel<Variable>(true, []);
  displayedColumns: string[] = ['select', 'unitName', 'variableId'];
  dataSource = new MatTableDataSource<Variable>([]);

  // Variable bundle groups
  variableBundleGroups: VariableBundle[] = [];
  selectedVariableBundleGroups = new SelectionModel<VariableBundle>(true, []);
  bundleGroupsDisplayedColumns: string[] = ['select', 'name', 'description', 'variableCount'];
  bundleGroupsDataSource = new MatTableDataSource<VariableBundle>([]);
  isLoadingBundleGroups = false;

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
  bundleGroupNameFilter = '';

  constructor(
    public dialogRef: MatDialogRef<CodingJobDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CodingJobDialogData
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadVariableAnalysisItems();
    this.loadVariableBundleGroups();
  }

  initForm(): void {
    this.codingJobForm = this.fb.group({
      name: [this.data.codingJob?.name || '', Validators.required],
      description: [this.data.codingJob?.description || ''],
      status: [this.data.codingJob?.status || 'pending', Validators.required]
    });

    if (this.data.codingJob?.variables) {
      this.variableBundles = [...this.data.codingJob.variables];
      this.dataSource.data = this.variableBundles;
      this.selectedVariableBundles = new SelectionModel<Variable>(true, [...this.variableBundles]);
    }

    if (this.data.codingJob?.variableBundles) {
      this.selectedVariableBundleGroups = new SelectionModel<VariableBundle>(true, [...this.data.codingJob.variableBundles]);
    }
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

        this.variableBundles = Array.from(uniqueVariables.values());
        this.dataSource.data = this.variableBundles;

        // Pre-select variables that were already selected
        if (this.data.codingJob?.variables) {
          this.data.codingJob.variables.forEach(variable => {
            const foundVariable = this.variableBundles.find(
              b => b.unitName === variable.unitName && b.variableId === variable.variableId
            );
            if (foundVariable) {
              this.selectedVariableBundles.select(foundVariable);
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

  loadVariableBundleGroups(): void {
    this.isLoadingBundleGroups = true;

    this.variableBundleGroupService.getBundleGroups().subscribe({
      next: bundleGroups => {
        this.variableBundleGroups = bundleGroups;
        this.bundleGroupsDataSource.data = bundleGroups;

        // Pre-select bundle groups that were already selected
        if (this.data.codingJob?.variableBundles) {
          this.data.codingJob.variableBundles.forEach(group => {
            const foundGroup = this.variableBundleGroups.find(g => g.id === group.id);
            if (foundGroup) {
              this.selectedVariableBundleGroups.select(foundGroup);
            }
          });
        }

        this.isLoadingBundleGroups = false;
      },
      error: () => {
        this.isLoadingBundleGroups = false;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.loadVariableAnalysisItems(event.pageIndex + 1, event.pageSize);
  }

  applyFilter(): void {
    this.loadVariableAnalysisItems(1, this.variableAnalysisPageSize);
  }

  applyBundleGroupFilter(): void {
    if (this.bundleGroupNameFilter) {
      this.bundleGroupsDataSource.filter = this.bundleGroupNameFilter.trim().toLowerCase();
    } else {
      this.bundleGroupsDataSource.filter = '';
    }
  }

  clearFilters(): void {
    this.unitNameFilter = '';
    this.variableIdFilter = '';
    this.loadVariableAnalysisItems(1, this.variableAnalysisPageSize);
  }

  clearBundleGroupFilter(): void {
    this.bundleGroupNameFilter = '';
    this.bundleGroupsDataSource.filter = '';
  }

  /** Whether the number of selected bundle groups matches the total number of rows. */
  isAllBundleGroupsSelected(): boolean {
    const numSelected = this.selectedVariableBundleGroups.selected.length;
    const numRows = this.bundleGroupsDataSource.data.length;
    return numSelected === numRows;
  }

  /** Selects all bundle groups if they are not all selected; otherwise clear selection. */
  masterToggleBundleGroups(): void {
    if (this.isAllBundleGroupsSelected()) {
      this.selectedVariableBundleGroups.clear();
    } else {
      this.bundleGroupsDataSource.data.forEach(row => this.selectedVariableBundleGroups.select(row));
    }
  }

  /** The label for the checkbox on the passed bundle group row */
  bundleGroupCheckboxLabel(row?: VariableBundle): string {
    if (!row) {
      return `${this.isAllBundleGroupsSelected() ? 'deselect' : 'select'} all`;
    }
    return `${this.selectedVariableBundleGroups.isSelected(row) ? 'deselect' : 'select'} row ${row.name}`;
  }

  /** Gets the number of variables in a bundle group */
  getVariableCount(bundleGroup: VariableBundle): number {
    return bundleGroup.variables.length;
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected(): boolean {
    const numSelected = this.selectedVariableBundles.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selectedVariableBundles.clear();
    } else {
      this.dataSource.data.forEach(row => this.selectedVariableBundles.select(row));
    }
  }

  /** The label for the checkbox on the passed row */
  checkboxLabel(row?: Variable): string {
    if (!row) {
      return `${this.isAllSelected() ? 'deselect' : 'select'} all`;
    }
    return `${this.selectedVariableBundles.isSelected(row) ? 'deselect' : 'select'} row ${row.unitName}`;
  }

  onSubmit(): void {
    if (this.codingJobForm.invalid) {
      return;
    }

    const codingJob: CodingJob = {
      id: this.data.codingJob?.id || 0,
      ...this.codingJobForm.value,
      createdAt: this.data.codingJob?.createdAt || new Date(),
      updatedAt: new Date(),
      assignedCoders: this.data.codingJob?.assignedCoders || [],
      variables: this.selectedVariableBundles.selected,
      variableBundles: this.selectedVariableBundleGroups.selected
    };

    this.dialogRef.close(codingJob);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
