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
import { forkJoin } from 'rxjs';
import { CodingJob, VariableBundle, Variable } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';

export interface CodingJobDialogData {
  codingJob?: CodingJob;
  isEdit: boolean;
  preloadedVariables?: Variable[];
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
  private codingJobService = inject(CodingJobService);

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
  isLoadingVariableAnalysis = false;
  totalVariableAnalysisRecords = 0;
  variableAnalysisPageIndex = 0;
  variableAnalysisPageSize = 10;
  variableAnalysisPageSizeOptions = [5, 10, 25, 50];

  // Missings profiles
  missingsProfiles: { label: string; id: number }[] = [];
  selectedMissingsProfileId: number | null = null;
  isLoadingMissingsProfiles = false;

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
    this.loadMissingsProfiles();
    if (this.data.isEdit && this.data.codingJob?.id) {
      this.loadCoders(this.data.codingJob.id);
      this.selectedMissingsProfileId = this.data.codingJob.missings_profile_id || null;
    }

    this.dataSource.filterPredicate = (row, filter: string): boolean => {
      try {
        const { unitName, variableId } = JSON.parse(filter || '{}');
        const unitMatch = unitName ? row.unitName?.toLowerCase().includes(String(unitName).toLowerCase()) : true;
        const varMatch = variableId ? row.variableId?.toLowerCase().includes(String(variableId).toLowerCase()) : true;
        return unitMatch && varMatch;
      } catch {
        return true;
      }
    };
  }

  loadAvailableCoders(): void {
    this.isLoadingAvailableCoders = true;

    this.coderService.getCoders().subscribe({
      next: coders => {
        this.availableCoders = coders;
        this.isLoadingAvailableCoders = false;
        let assignedIds: number[] = [];
        if (this.data.isEdit && this.data.codingJob?.assignedCoders) {
          assignedIds = this.data.codingJob.assignedCoders;
        } else if (this.coders && this.coders.length > 0) {
          assignedIds = this.coders.map(c => c.id);
        }

        if (assignedIds.length > 0) {
          const preSelectedCoders = this.availableCoders.filter(c => assignedIds.includes(c.id));
          this.selectedCoders = new SelectionModel<Coder>(true, preSelectedCoders);
        } else {
          this.selectedCoders = new SelectionModel<Coder>(true, []);
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
        const assignedIds = coders.map(c => c.id);
        const preSelectedCoders = this.availableCoders.filter(c => assignedIds.includes(c.id));
        this.selectedCoders = new SelectionModel<Coder>(true, preSelectedCoders);
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

    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;

    if (originallyAssigned && originallyAssigned.length > 0) {
      this.selectedVariables = new SelectionModel<Variable>(true, [...originallyAssigned]);
    }
  }

  loadCodingIncompleteVariables(unitNameFilter?: string): void {
    this.isLoadingVariableAnalysis = true;

    // Use preloaded variables if available
    if (this.data.preloadedVariables && !unitNameFilter) {
      this.variables = this.data.preloadedVariables;
      this.dataSource.data = this.variables;
      this.processVariableSelection();
      this.totalVariableAnalysisRecords = this.variables.length;
      this.isLoadingVariableAnalysis = false;
      return;
    }

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
        this.processVariableSelection();
        this.totalVariableAnalysisRecords = variables.length;
        this.isLoadingVariableAnalysis = false;
      },
      error: () => {
        this.isLoadingVariableAnalysis = false;
      }
    });
  }

  private processVariableSelection(): void {
    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;
    if (originallyAssigned && originallyAssigned.length > 0) {
      const makeKey = (u?: string | null, v?: string | null) => `${(u || '').trim().toLowerCase()}::${(v || '').trim().toLowerCase()}`;

      const toKey = (obj: unknown): string => {
        if (obj && typeof obj === 'object') {
          const rec = obj as Record<string, unknown>;
          const unitNameVal = rec.unitName;
          const varIdCandidate = rec.variableId ?? rec.variableid ?? rec.variableID;
          const unitName = typeof unitNameVal === 'string' ? unitNameVal : '';
          const variableId = typeof varIdCandidate === 'string' ? varIdCandidate : '';
          return makeKey(unitName, variableId);
        }
        return makeKey('', '');
      };

      const assignedKeySet = new Set(originallyAssigned.map(toKey));

      this.selectedVariables.clear();
      this.variables.forEach(rowVar => {
        const rowKey = makeKey(rowVar.unitName ?? '', rowVar.variableId ?? '');
        if (assignedKeySet.has(rowKey)) {
          this.selectedVariables.select(rowVar);
        }
      });
    }
  }

  loadVariableBundles(): void {
    this.isLoadingBundles = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.backendService.getVariableBundles(workspaceId).subscribe({
        next: bundles => {
          this.variableBundles = bundles;
          this.bundlesDataSource.data = bundles;
          this.isLoadingBundles = false;
          if (this.data.isEdit && this.data.codingJob) {
            const assignedBundles = this.data.codingJob.variableBundles || this.data.codingJob.assignedVariableBundles;
            if (assignedBundles && assignedBundles.length > 0) {
              const ids = assignedBundles.map(b => b.name);
              const preSelected = this.variableBundles.filter(b => ids.includes(b.name));
              this.selectedVariableBundles.select(...preSelected);
            }
          }
        },
        error: () => {
          this.isLoadingBundles = false;
        }
      });
    } else {
      this.isLoadingBundles = false;
    }
  }

  loadMissingsProfiles(): void {
    this.isLoadingMissingsProfiles = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.backendService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles = profiles;
          this.isLoadingMissingsProfiles = false;
        },
        error: () => {
          this.isLoadingMissingsProfiles = false;
        }
      });
    } else {
      this.isLoadingMissingsProfiles = false;
    }
  }

  applyFilter(): void {
    this.loadCodingIncompleteVariables(this.unitNameFilter);
    this.dataSource.filter = JSON.stringify({
      unitName: this.unitNameFilter || '',
      variableId: this.variableIdFilter || ''
    });
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
    this.dataSource.filter = '';
    this.loadCodingIncompleteVariables();
  }

  clearBundleFilter(): void {
    this.bundleNameFilter = '';
    this.bundlesDataSource.filter = '';
  }

  isVariableOriginallyAssigned(variable: Variable): boolean {
    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;
    if (!originallyAssigned) {
      return false;
    }

    return originallyAssigned.some(
      originalVar => originalVar.unitName === variable.unitName && originalVar.variableId === variable.variableId
    );
  }

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

  getVariableCount(bundle: VariableBundle): number {
    return bundle.variables.length;
  }

  isAllSelected(): boolean {
    const numSelected = this.selectedVariables.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows && numRows > 0;
  }

  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selectedVariables.clear();
    } else {
      this.dataSource.data.forEach(row => this.selectedVariables.select(row));
    }
  }

  isAllCodersSelected(): boolean {
    const numSelected = this.selectedCoders.selected.length;
    const numRows = this.availableCoders.length;
    return numSelected === numRows && numRows > 0;
  }

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

    const selectedCoderIds = this.selectedCoders.selected.map(c => c.id);

    const codingJob: CodingJob = {
      id: this.data.codingJob?.id || 0,
      ...this.codingJobForm.value,
      created_at: this.data.codingJob?.created_at || new Date(),
      updated_at: new Date(),
      assignedCoders: selectedCoderIds,
      variables: this.selectedVariables.selected,
      variableBundles: this.selectedVariableBundles.selected,
      assignedVariables: this.selectedVariables.selected,
      assignedVariableBundles: this.selectedVariableBundles.selected,
      missings_profile_id: this.selectedMissingsProfileId || undefined
    };

    if (this.data.isEdit && this.data.codingJob?.id) {
      this.backendService.updateCodingJob(workspaceId, this.data.codingJob.id, codingJob).subscribe({
        next: updatedJob => {
          if (updatedJob?.id && selectedCoderIds.length > 0) {
            const assignCalls = selectedCoderIds.map(id => this.codingJobService.assignCoder(updatedJob.id!, id));
            forkJoin(assignCalls).subscribe({
              next: results => {
                const lastJob = results.filter(Boolean).pop() || { ...updatedJob, assignedCoders: selectedCoderIds };
                this.isSaving = false;
                this.snackBar.open('Coding job updated successfully', 'Close', { duration: 3000 });
                this.dialogRef.close(lastJob);
              },
              error: () => {
                this.isSaving = false;
                this.snackBar.open('Coding job updated, but assigning coders failed', 'Close', { duration: 5000 });
                this.dialogRef.close({ ...updatedJob, assignedCoders: selectedCoderIds });
              }
            });
          } else {
            this.isSaving = false;
            this.snackBar.open('Coding job updated successfully', 'Close', { duration: 3000 });
            this.dialogRef.close(updatedJob);
          }
        },
        error: error => {
          this.isSaving = false;
          this.snackBar.open(`Error updating coding job: ${error.message}`, 'Close', { duration: 5000 });
        }
      });
    } else {
      this.backendService.createCodingJob(workspaceId, codingJob).subscribe({
        next: createdJob => {
          if (createdJob?.id && selectedCoderIds.length > 0) {
            const assignCalls = selectedCoderIds.map(id => this.codingJobService.assignCoder(createdJob.id!, id));
            forkJoin(assignCalls).subscribe({
              next: results => {
                const lastJob = results.filter(Boolean).pop() || { ...createdJob, assignedCoders: selectedCoderIds };
                this.isSaving = false;
                this.snackBar.open('Coding job created successfully', 'Close', { duration: 3000 });
                this.dialogRef.close(lastJob);
              },
              error: () => {
                this.isSaving = false;
                this.snackBar.open('Job created, but assigning coders failed', 'Close', { duration: 5000 });
                this.dialogRef.close({ ...createdJob, assignedCoders: selectedCoderIds });
              }
            });
          } else {
            this.isSaving = false;
            this.snackBar.open('Coding job created successfully', 'Close', { duration: 3000 });
            this.dialogRef.close(createdJob);
          }
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
