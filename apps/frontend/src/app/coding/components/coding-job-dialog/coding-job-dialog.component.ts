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
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import { MatTooltip } from '@angular/material/tooltip';
import { CodingJob, VariableBundle, Variable } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CoderService } from '../../services/coder.service';
import { VariableAnalysisItem } from '../../models/variable-analysis-item.model';

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
    TranslateModule,
    MatTooltip
  ]
})
export class CodingJobDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private coderService = inject(CoderService);
  private snackBar = inject(MatSnackBar);

  codingJobForm!: FormGroup;
  isLoading = false;
  isSaving = false;

  // Variables
  variables: Variable[] = [];
  selectedVariables = new SelectionModel<Variable>(true, []);
  displayedColumns: string[] = ['select', 'unitName', 'variableId'];
  dataSource = new MatTableDataSource<Variable>([]);

  // Coders
  coders: Coder[] = [];
  isLoadingCoders = false;
  availableCoders: Coder[] = [];
  selectedCoders = new SelectionModel<Coder>(true, []);
  isLoadingAvailableCoders = false;

  // Variable bundles
  variableBundles: VariableBundle[] = [];
  selectedVariableBundles = new SelectionModel<VariableBundle>(true, []);
  bundlesDataSource = new MatTableDataSource<VariableBundle>([]);
  isLoadingBundles = false;

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
  bundleNameFilter = '';

  constructor(
    public dialogRef: MatDialogRef<CodingJobDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CodingJobDialogData
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadCodingIncompleteVariables();
    this.loadVariableBundles();
    this.loadAvailableCoders();
    console.log(this.data);
    // Load coders if we're in edit mode and have a job ID
    if (this.data.isEdit && this.data.codingJob?.id) {
      this.loadCoders(this.data.codingJob.id);
    }
  }

  /**
   * Loads all available coders in the workspace for selection
   */
  loadAvailableCoders(): void {
    this.isLoadingAvailableCoders = true;

    this.coderService.getCoders().subscribe({
      next: coders => {
        this.availableCoders = coders;
        this.isLoadingAvailableCoders = false;
        if (this.data.isEdit && this.data.codingJob?.assignedCoders) {
          const preSelectedCoders = coders.filter(coder => this.data.codingJob?.assignedCoders?.includes(coder.id));
          this.selectedCoders = new SelectionModel<Coder>(true, preSelectedCoders);
        }
      },
      error: () => {
        this.isLoadingAvailableCoders = false;
      }
    });
  }

  /**
   * Loads coders assigned to the current job
   * @param jobId The ID of the job
   */
  loadCoders(jobId: number): void {
    this.isLoadingCoders = true;

    this.coderService.getCodersByJobId(jobId).subscribe({
      next: coders => {
        this.coders = coders;
        this.isLoadingCoders = false;
        // Pre-select the assigned coders
        this.selectedCoders = new SelectionModel<Coder>(true, coders);
      },
      error: () => {
        this.isLoadingCoders = false;
      }
    });
  }

  initForm(): void {
    this.codingJobForm = this.fb.group({
      name: [this.data.codingJob?.name || '', Validators.required],
      description: [this.data.codingJob?.description || ''],
      status: [this.data.codingJob?.status || 'pending', Validators.required]
    });

    if (this.data.codingJob?.variables) {
      this.variables = [...this.data.codingJob.variables];
      this.dataSource.data = this.variables;
      this.selectedVariables = new SelectionModel<Variable>(true, [...this.variables]);
    }

    if (this.data.codingJob?.variableBundles) {
      this.selectedVariableBundles = new SelectionModel<VariableBundle>(true, [...this.data.codingJob.variableBundles]);
    }
  }

  loadCodingIncompleteVariables(unitNameFilter?: string): void {
    this.isLoadingVariableAnalysis = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.isLoadingVariableAnalysis = false;
      return;
    }

    this.backendService.getCodingIncompleteVariables(
      workspaceId,
      unitNameFilter || undefined
    ).subscribe({
      next: variables => {
        this.variables = variables;
        this.dataSource.data = this.variables;
        if (this.data.codingJob?.variables) {
          this.data.codingJob.variables.forEach(variable => {
            const foundVariable = this.variables.find(
              b => b.unitName === variable.unitName && b.variableId === variable.variableId
            );
            if (foundVariable) {
              this.selectedVariables.select(foundVariable);
            }
          });
        }

        this.totalVariableAnalysisRecords = variables.length;
        this.isLoadingVariableAnalysis = false;
      },
      error: () => {
        this.isLoadingVariableAnalysis = false;
      }
    });
  }

  loadVariableBundles(): void {
    this.isLoadingBundles = true;

    // Get the current workspace ID from the app service
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.backendService.getVariableBundles(workspaceId).subscribe({
        next: bundles => {
          this.variableBundles = bundles;
          this.bundlesDataSource.data = bundles;
          this.isLoadingBundles = false;
        },
        error: () => {
          this.isLoadingBundles = false;
        }
      });
    } else {
      this.isLoadingBundles = false;
    }
  }

  onPageChange(): void {
    // Pagination not needed for CODING_INCOMPLETE variables
    // This method can be removed or kept for future use
  }

  applyFilter(): void {
    this.loadCodingIncompleteVariables(this.unitNameFilter);
  }

  applyBundleFilter(): void {
    if (this.bundleNameFilter) {
      this.bundlesDataSource.filter = this.bundleNameFilter.trim().toLowerCase();
    } else {
      this.bundlesDataSource.filter = '';
    }
  }

  clearFilters(): void {
    this.unitNameFilter = '';
    this.variableIdFilter = '';
    this.loadCodingIncompleteVariables();
  }

  clearBundleFilter(): void {
    this.bundleNameFilter = '';
    this.bundlesDataSource.filter = '';
  }

  /** Whether the number of selected bundle matches the total number of rows. */
  isAllBundlesSelected(): boolean {
    const numSelected = this.selectedVariableBundles.selected.length;
    const numRows = this.bundlesDataSource.data.length;
    return numSelected === numRows;
  }

  /**
   * Check if a variable was originally assigned to this coding job
   * @param variable The variable to check
   * @returns true if the variable was originally assigned to this job
   */
  isVariableOriginallyAssigned(variable: Variable): boolean {
    if (!this.data.codingJob?.variables) {
      return false;
    }

    return this.data.codingJob.variables.some(
      originalVar => originalVar.unitName === variable.unitName && originalVar.variableId === variable.variableId
    );
  }

  /**
   * Check if a variable bundle was originally assigned to this coding job
   * @param bundle The variable bundle to check
   * @returns true if the bundle was originally assigned to this job
   */
  isBundleOriginallyAssigned(bundle: VariableBundle): boolean {
    if (!this.data.codingJob?.variableBundles) {
      return false;
    }

    return this.data.codingJob.variableBundles.some(
      originalBundle => originalBundle.id === bundle.id
    );
  }

  isCoderOriginallyAssigned(coder: Coder): boolean {
    if (!this.data.codingJob?.assignedCoders) {
      return false;
    }

    return this.data.codingJob.assignedCoders.includes(coder.id);
  }

  /** Gets the number of variables in a bundle */
  getVariableCount(bundle: VariableBundle): number {
    return bundle.variables.length;
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected(): boolean {
    const numSelected = this.selectedVariables.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows && numRows > 0;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selectedVariables.clear();
    } else {
      this.dataSource.data.forEach(row => this.selectedVariables.select(row));
    }
  }

  /** Whether all coders are selected. */
  isAllCodersSelected(): boolean {
    const numSelected = this.selectedCoders.selected.length;
    const numRows = this.availableCoders.length;
    return numSelected === numRows && numRows > 0;
  }

  /** Selects all coders if they are not all selected; otherwise clear selection. */
  masterCoderToggle(): void {
    if (this.isAllCodersSelected()) {
      this.selectedCoders.clear();
    } else {
      this.availableCoders.forEach(coder => this.selectedCoders.select(coder));
    }
  }

  onSubmit(): void {
    if (this.codingJobForm.invalid) {
      return;
    }

    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('No workspace selected', 'Close', { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const codingJob: CodingJob = {
      id: this.data.codingJob?.id || 0,
      ...this.codingJobForm.value,
      createdAt: this.data.codingJob?.createdAt || new Date(),
      updatedAt: new Date(),
      assignedCoders: this.selectedCoders.selected.map(coder => coder.id),
      variables: this.selectedVariables.selected,
      variableBundles: this.selectedVariableBundles.selected,
      assignedVariables: this.selectedVariables.selected,
      assignedVariableBundles: this.selectedVariableBundles.selected
    };

    // If we're editing an existing coding job
    if (this.data.isEdit && this.data.codingJob?.id) {
      this.backendService.updateCodingJob(workspaceId, this.data.codingJob.id, codingJob).subscribe({
        next: updatedJob => {
          this.isSaving = false;
          this.snackBar.open('Coding job updated successfully', 'Close', { duration: 3000 });
          this.dialogRef.close(updatedJob);
        },
        error: error => {
          this.isSaving = false;
          this.snackBar.open(`Error updating coding job: ${error.message}`, 'Close', { duration: 5000 });
        }
      });
    } else { // If we're creating a new coding job
      this.backendService.createCodingJob(workspaceId, codingJob).subscribe({
        next: createdJob => {
          this.isSaving = false;
          this.snackBar.open('Coding job created successfully', 'Close', { duration: 3000 });
          this.dialogRef.close(createdJob);
        },
        error: error => {
          this.isSaving = false;
          this.snackBar.open(`Error creating coding job: ${error.message}`, 'Close', { duration: 5000 });
        }
      });
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
