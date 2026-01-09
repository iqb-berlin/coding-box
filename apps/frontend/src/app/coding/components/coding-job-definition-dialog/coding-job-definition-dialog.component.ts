import {
  Component, Inject, OnInit, OnDestroy, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators, ValidatorFn
} from '@angular/forms';
import {
  MatDialogRef, MAT_DIALOG_DATA, MatDialogModule, MatDialog
} from '@angular/material/dialog';
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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { SelectionModel } from '@angular/cdk/collections';
import { MatTooltip } from '@angular/material/tooltip';
import {
  forkJoin, Subject, takeUntil, firstValueFrom
} from 'rxjs';
import { CodingJob, VariableBundle, Variable } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { CodingJobBulkCreationDialogComponent, BulkCreationData, BulkCreationResult } from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';

export interface CodingJobDefinitionDialogData {
  codingJob?: CodingJob;
  isEdit: boolean;
  mode: 'definition' | 'job';
  jobDefinitionId?: number;
  preloadedVariables?: Variable[];
}

export interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  assignedCoders?: number[];
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  created_at?: Date;
  updated_at?: Date;
}

interface CreationResults {
  doubleCodingInfo: Record<string, {
    totalCases: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
  jobs: {
    coderId: number;
    coderName: string;
    variable: { unitName: string; variableId: string };
    jobId: number;
    jobName: string;
    caseCount: number;
  }[];
}

@Component({
  selector: 'coding-box-coding-job-definition-dialog',
  templateUrl: './coding-job-definition-dialog.component.html',
  styleUrls: ['./coding-job-definition-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
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
    MatRadioModule,
    TranslateModule,
    MatTooltip
  ]
})
export class CodingJobDefinitionDialogComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private coderService = inject(CoderService);
  private snackBar = inject(MatSnackBar);
  private codingJobService = inject(CodingJobService);
  private matDialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();

  codingJobForm!: FormGroup;
  isLoading = false;
  isSaving = false;

  // Double coding configuration
  doubleCodingMode: 'absolute' | 'percentage' = 'absolute';

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

  // Filters
  unitNameFilter = '';
  variableIdFilter = '';
  bundleNameFilter = '';
  availabilityFilter: 'all' | 'full' | 'partial' | 'none' = 'all';

  private disabledVariableKeys = new Set<string>();
  existingJobDefinitions: JobDefinition[] = [];

  constructor(
    public dialogRef: MatDialogRef<CodingJobDefinitionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CodingJobDefinitionDialogData
  ) {}

  ngOnInit(): void {
    if (this.data.codingJob?.doubleCodingAbsolute !== null && this.data.codingJob?.doubleCodingAbsolute !== undefined && this.data.codingJob.doubleCodingAbsolute > 0) {
      this.doubleCodingMode = 'absolute';
    } else if (this.data.codingJob?.doubleCodingPercentage !== null && this.data.codingJob?.doubleCodingPercentage !== undefined && this.data.codingJob.doubleCodingPercentage > 0) {
      this.doubleCodingMode = 'percentage';
    } else {
      this.doubleCodingMode = 'absolute'; // default
    }

    this.initForm();
    this.loadCodingIncompleteVariables();
    this.loadVariableBundles();
    this.loadAvailableCoders();
    if (this.data.isEdit && this.data.codingJob?.id) {
      this.loadCoders(this.data.codingJob.id);
    }

    if (this.data.mode === 'definition') {
      this.loadExistingJobDefinitions();
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

    // Subscribe to jobs created event for auto-refresh
    this.codingJobService.jobsCreatedEvent.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadCodingIncompleteVariables();
      this.applyAvailabilityFilter();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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

  loadExistingJobDefinitions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.backendService.getJobDefinitions(workspaceId).subscribe({
      next: definitions => {
        // When editing an existing job definition, exclude the current job definition
        // from the list to prevent its variables from being incorrectly disabled
        if (this.data.isEdit && this.data.jobDefinitionId) {
          this.existingJobDefinitions = definitions.filter(def => def.id !== this.data.jobDefinitionId);
        } else {
          this.existingJobDefinitions = definitions;
        }
        this.buildDisabledVariablesSet();
        this.applyJobDefinitionUsage();
        this.applyAvailabilityFilter();
      },
      error: () => {
        // Silently fail - disabled variables will just not be disabled
      }
    });
  }

  private buildDisabledVariablesSet(): void {
    this.disabledVariableKeys.clear();
  }

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
    const formFields: Record<string, [string | number | boolean | null | undefined, ValidatorFn[]]> = {
      durationSeconds: [this.data.codingJob?.durationSeconds || 1, [Validators.min(1)]],
      maxCodingCases: [this.data.codingJob?.maxCodingCases || null, [Validators.min(1)]],
      doubleCodingAbsolute: [this.data.codingJob?.doubleCodingAbsolute ?? 0, []],
      doubleCodingPercentage: [this.data.codingJob?.doubleCodingPercentage ?? 0, []],
      caseOrderingMode: [this.data.codingJob?.caseOrderingMode || 'continuous', []]
    };

    if (this.data.mode === 'job') {
      formFields.showScore = [this.data.codingJob?.showScore ?? true, []];
      formFields.allowComments = [this.data.codingJob?.allowComments ?? true, []];
      formFields.suppressGeneralInstructions = [this.data.codingJob?.suppressGeneralInstructions ?? false, []];
    }

    if (this.data.isEdit) {
      const defaultStatus = this.data.mode === 'definition' ? 'draft' : 'pending';
      formFields.status = [this.data.codingJob?.status || defaultStatus, [Validators.required]];
    }

    this.codingJobForm = this.fb.group(formFields);

    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;

    if (originallyAssigned && originallyAssigned.length > 0) {
      this.selectedVariables = new SelectionModel<Variable>(true, [...originallyAssigned]);
    }
  }

  loadCodingIncompleteVariables(unitNameFilter?: string): void {
    this.isLoadingVariableAnalysis = true;
    if (this.data.preloadedVariables && !unitNameFilter) {
      this.variables = this.data.preloadedVariables;
      this.applyJobDefinitionUsage();
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

    this.backendService.getCodingIncompleteVariables(workspaceId, unitNameFilter || undefined).subscribe({
      next: variables => {
        this.variables = variables;
        this.applyJobDefinitionUsage();
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
          const enrichedBundles = bundles.map(bundle => ({
            ...bundle,
            variables: bundle.variables.map((bundleVar: Variable) => {
              const matchingVar = this.variables.find(v => v.unitName === bundleVar.unitName && v.variableId === bundleVar.variableId);
              return {
                ...bundleVar,
                responseCount: matchingVar?.responseCount || 0
              };
            })
          }));

          this.variableBundles = enrichedBundles;
          this.bundlesDataSource.data = enrichedBundles;
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

  applyJobDefinitionUsage(): void {
    if (!this.variables || this.variables.length === 0) return;

    const casesUsedInDefinitions = new Map<string, number>();
    const makeKey = (u: string | undefined, v: string | undefined) => `${(u || '').trim().toLowerCase()}::${(v || '').trim().toLowerCase()}`;

    // Count cases used in each job definition (excluding the current one being edited)
    if (this.existingJobDefinitions && this.existingJobDefinitions.length > 0) {
      this.existingJobDefinitions.forEach(def => {
        // Skip the current definition being edited
        if (this.data.isEdit && this.data.jobDefinitionId && def.id === this.data.jobDefinitionId) {
          return;
        }

        def.assignedVariables?.forEach(v => {
          const key = makeKey(v.unitName, v.variableId);
          const casesForThisVar = def.maxCodingCases || (v.responseCount || 0);
          casesUsedInDefinitions.set(key, (casesUsedInDefinitions.get(key) || 0) + casesForThisVar);
        });
        def.assignedVariableBundles?.forEach(bundle => {
          bundle.variables?.forEach(v => {
            const key = makeKey(v.unitName, v.variableId);
            const casesForThisVar = def.maxCodingCases || (v.responseCount || 0);
            casesUsedInDefinitions.set(key, (casesUsedInDefinitions.get(key) || 0) + casesForThisVar);
          });
        });
      });
    }

    // Adjust available cases based on cases used in definitions
    this.variables.forEach(v => {
      const key = makeKey(v.unitName, v.variableId);
      const casesUsed = casesUsedInDefinitions.get(key) || 0;
      const originalAvailable = v.responseCount || 0;
      v.availableCases = Math.max(0, originalAvailable - casesUsed);
    });

    this.syncSelectionWithAvailability();
  }

  private syncSelectionWithAvailability(): void {
    const toDeselect = this.selectedVariables.selected.filter(v => v.availableCases !== undefined &&
      v.availableCases === 0 &&
      !(this.data.isEdit && this.isVariableOriginallyAssigned(v))
    );

    toDeselect.forEach(v => this.selectedVariables.deselect(v));
  }

  applyFilter(): void {
    this.loadCodingIncompleteVariables(this.unitNameFilter);
    this.applyAvailabilityFilter();
  }

  applyAvailabilityFilter(): void {
    // Debug logging to verify filter behavior
    // eslint-disable-next-line no-console
    console.log('[JobDefinitionDialog] applyAvailabilityFilter start', {
      availabilityFilter: this.availabilityFilter,
      totalVariables: this.variables.length
    });

    let filteredData = this.variables;

    // Apply text filters
    if (this.unitNameFilter || this.variableIdFilter) {
      filteredData = filteredData.filter(v => {
        const matchesUnit = !this.unitNameFilter ||
          v.unitName?.toLowerCase().includes(this.unitNameFilter.toLowerCase());
        const matchesVariable = !this.variableIdFilter ||
          v.variableId?.toLowerCase().includes(this.variableIdFilter.toLowerCase());
        return matchesUnit && matchesVariable;
      });
    }

    // Apply availability filter
    if (this.availabilityFilter !== 'all') {
      filteredData = filteredData.filter(v => {
        const availableRaw = v.availableCases !== undefined ?
          v.availableCases :
          v.responseCount ?? 0;
        const totalRaw = v.responseCount !== undefined ?
          v.responseCount :
          v.availableCases ?? 0;

        const available = Number(availableRaw ?? 0);
        const total = Number(totalRaw ?? 0);

        if (total <= 0) {
          // No cases at all => treat as none
          return this.availabilityFilter === 'none';
        }

        const isFull = available >= total;
        const isNone = available <= 0;
        const isPartial = !isFull && !isNone;

        switch (this.availabilityFilter) {
          case 'full':
            return isFull;
          case 'partial':
            return isPartial;
          case 'none':
            return isNone;
          default:
            return true;
        }
      });
    }

    this.dataSource.data = filteredData;
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
    this.availabilityFilter = 'all';
    this.dataSource.data = this.variables;
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

  isVariableDisabled(variable: Variable): boolean {
    if (this.data.mode !== 'definition') {
      return false;
    }

    if (variable.availableCases !== undefined && variable.availableCases === 0) {
      return true;
    }

    // Allow variables that were originally assigned to the current job definition being edited
    if (this.data.isEdit && this.isVariableOriginallyAssigned(variable)) {
      return false;
    }

    // Disable variables that are included in currently selected variable bundles
    return this.selectedVariableBundles.selected.some(bundle => bundle.variables.some(bundleVar => bundleVar.unitName === variable.unitName && bundleVar.variableId === variable.variableId
    )
    );
  }

  getVariableDisabledReason(variable: Variable): string {
    // Check if no cases are available
    if (variable.availableCases !== undefined && variable.availableCases === 0) {
      return `Alle ${variable.responseCount || 0} Fälle bereits verteilt`;
    }

    // Check if variable is included in currently selected variable bundle
    const selectedBundle = this.selectedVariableBundles.selected.find(bundle => bundle.variables.some(bundleVar => bundleVar.unitName === variable.unitName && bundleVar.variableId === variable.variableId
    )
    );

    if (selectedBundle) {
      return `Bereits in Variablenbündel "${selectedBundle.name}" enthalten`;
    }

    return 'Bereits in anderen Definitionen verwendet';
  }

  getVariableCount(bundle: VariableBundle): number {
    return bundle.variables.length;
  }

  getCodingJobCount(): number {
    return this.selectedVariables.selected.length;
  }

  getTotalCodingCases(): number {
    const maxCases = this.codingJobForm.value.maxCodingCases;
    const isDefinitionMode = this.data.mode === 'definition';

    const getAvailableCases = (v: Variable): number => (
      v.availableCases ?? v.responseCount ?? 0
    );

    // Sum all selected variables
    let total = this.selectedVariables.selected
      .reduce((sum, v) => sum + getAvailableCases(v), 0);

    // Include variables from selected bundles
    this.selectedVariableBundles.selected.forEach(bundle => {
      bundle.variables.forEach(v => {
        total += getAvailableCases(v as unknown as Variable);
      });
    });

    // Apply global cap per job definition (only in definition mode)
    if (
      isDefinitionMode &&
      typeof maxCases === 'number' &&
      maxCases > 0
    ) {
      total = Math.min(total, maxCases);
    }

    return total;
  }

  getTotalTimeInSeconds(): number {
    const durationPerCase = this.codingJobForm.value.durationSeconds || 1;
    return this.getTotalCodingCases() * durationPerCase;
  }

  getFormattedTotalTime(): string {
    const seconds = this.getTotalTimeInSeconds();
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  onAvailabilityChange(event: { value: 'all' | 'full' | 'partial' | 'none' }): void {
    this.availabilityFilter = event.value;
    this.applyAvailabilityFilter();
  }

  getAvailabilityClass(variable: Variable): string {
    if (variable.availableCases === undefined || variable.responseCount === undefined) {
      return '';
    }

    const availabilityPercentage = (variable.availableCases / variable.responseCount) * 100;

    if (availabilityPercentage === 100) {
      return 'availability-full';
    } if (availabilityPercentage > 0) {
      return 'availability-partial';
    }
    return 'availability-none';
  }

  getAvailabilityText(variable: Variable): string {
    if (variable.availableCases === undefined || variable.responseCount === undefined) {
      return `${variable.responseCount || 0}`;
    }

    return `${variable.availableCases}/${variable.responseCount}`;
  }

  isAllSelected(): boolean {
    const selectableRows = this.dataSource.data.filter(v => !this.isVariableDisabled(v));
    const numSelected = this.selectedVariables.selected.filter(v => !this.isVariableDisabled(v)).length;
    const numRows = selectableRows.length;
    return numSelected === numRows && numRows > 0;
  }

  masterToggle(): void {
    const selectableRows = this.dataSource.data.filter(v => !this.isVariableDisabled(v));
    if (this.isAllSelected()) {
      selectableRows.forEach(row => this.selectedVariables.deselect(row));
    } else {
      selectableRows.forEach(row => this.selectedVariables.select(row));
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

  async onSubmit(): Promise<void> {
    if (this.codingJobForm.invalid) {
      return;
    }

    if (this.data.mode === 'definition') {
      if (this.selectedCoders.selected.length === 0) {
        this.snackBar.open(
          this.translateService.instant('coding-job-definition-dialog.validation.coder-required'),
          this.translateService.instant('common.close'),
          { duration: 5000 }
        );
        return;
      }

      if (this.selectedVariables.selected.length === 0 && this.selectedVariableBundles.selected.length === 0) {
        this.snackBar.open(
          this.translateService.instant('coding-job-definition-dialog.validation.variable-or-bundle-required'),
          this.translateService.instant('common.close'),
          { duration: 5000 }
        );
        return;
      }

      if (this.data.isEdit && this.data.jobDefinitionId) {
        this.submitDefinitionUpdate();
      } else {
        this.submitDefinitionCreate();
      }
    } else {
      // mode === 'job'
      if (this.data.isEdit && this.data.codingJob?.id) {
        this.submitEdit();
        return;
      }

      if (this.selectedVariables.selected.length > 1) {
        await this.openBulkCreationDialog();
        return;
      }

      this.submitCreate();
    }
  }

  private submitEdit(): void {
    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
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
      assignedVariableBundles: this.selectedVariableBundles.selected
    };

    this.backendService.updateCodingJob(workspaceId, this.data.codingJob!.id!, codingJob).subscribe({
      next: updatedJob => {
        if (updatedJob?.id && selectedCoderIds.length > 0) {
          const assignCalls = selectedCoderIds.map(id => this.codingJobService.assignCoder(updatedJob.id!, id));
          forkJoin(assignCalls).subscribe({
            next: results => {
              const lastJob = results.filter(Boolean).pop() || { ...updatedJob, assignedCoders: selectedCoderIds };
              this.isSaving = false;
              this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.job-updated-success'), this.translateService.instant('common.close'), { duration: 3000 });
              this.dialogRef.close(lastJob);
            },
            error: () => {
              this.isSaving = false;
              this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.job-updated-coder-failed'), this.translateService.instant('common.close'), { duration: 5000 });
              this.dialogRef.close({ ...updatedJob, assignedCoders: selectedCoderIds });
            }
          });
        } else {
          this.isSaving = false;
          this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.job-updated-success'), this.translateService.instant('common.close'), { duration: 3000 });
          this.dialogRef.close(updatedJob);
        }
      },
      error: error => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-updating-job', { error: error.message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  private submitCreate(): void {
    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const selectedCoderIds = this.selectedCoders.selected.map(c => c.id);

    const codingJob: CodingJob = {
      id: 0,
      ...this.codingJobForm.value,
      created_at: new Date(),
      updated_at: new Date(),
      assignedCoders: selectedCoderIds,
      variables: this.selectedVariables.selected,
      variableBundles: this.selectedVariableBundles.selected,
      assignedVariables: this.selectedVariables.selected,
      assignedVariableBundles: this.selectedVariableBundles.selected
    };

    this.backendService.createCodingJob(workspaceId, codingJob).subscribe({
      next: createdJob => {
        if (createdJob?.id && selectedCoderIds.length > 0) {
          const assignCalls = selectedCoderIds.map(id => this.codingJobService.assignCoder(createdJob.id!, id));
          forkJoin(assignCalls).subscribe({
            next: results => {
              const lastJob = results.filter(Boolean).pop() || { ...createdJob, assignedCoders: selectedCoderIds };
              this.isSaving = false;
              this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.job-created-success'), this.translateService.instant('common.close'), { duration: 3000 });
              this.dialogRef.close(lastJob);
            },
            error: () => {
              this.isSaving = false;
              this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.job-created-coder-failed'), this.translateService.instant('common.close'), { duration: 5000 });
              this.dialogRef.close({ ...createdJob, assignedCoders: selectedCoderIds });
            }
          });
        } else {
          this.isSaving = false;
          this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.job-created-success'), this.translateService.instant('common.close'), { duration: 3000 });
          this.dialogRef.close(createdJob);
        }
      },
      error: error => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-creating-job', { error: error.message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  private buildBulkCreationData(creationResults?: CreationResults): BulkCreationData {
    const baseData: BulkCreationData = {
      selectedVariables: this.selectedVariables.selected,
      selectedVariableBundles: this.selectedVariableBundles.selected,
      selectedCoders: this.selectedCoders.selected,
      doubleCodingAbsolute: this.codingJobForm.value.doubleCodingAbsolute,
      doubleCodingPercentage: this.codingJobForm.value.doubleCodingPercentage
    };

    if (creationResults) {
      return {
        ...baseData,
        creationResults
      };
    }

    return baseData;
  }

  private async openBulkCreationDialog(): Promise<void> {
    const dialogData: BulkCreationData = this.buildBulkCreationData();

    const dialogRef = this.matDialog.open(CodingJobBulkCreationDialogComponent, {
      width: '1200px',
      data: dialogData
    });

    const result: BulkCreationResult | false = await firstValueFrom(dialogRef.afterClosed());
    if (result && result.confirmed) {
      await this.createBulkJobs(dialogData, result);
    }
  }

  private async openBulkCreationResultsDialog(creationResults: CreationResults): Promise<void> {
    const dialogData: BulkCreationData = this.buildBulkCreationData(creationResults);

    const dialogRef = this.matDialog.open(CodingJobBulkCreationDialogComponent, {
      width: '1200px',
      data: dialogData,
      disableClose: false
    });

    await firstValueFrom(dialogRef.afterClosed());
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async createBulkJobs(data: BulkCreationData, _displayOptions: BulkCreationResult): Promise<void> {
    this.isSaving = true;
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    try {
      // Use the new distributed job creation endpoint
      const mappedCoders = data.selectedCoders.map(coder => ({
        id: coder.id,
        name: coder.name,
        username: coder.name
      }));
      const result = await firstValueFrom(this.backendService.createDistributedCodingJobs(
        workspaceId,
        data.selectedVariables,
        mappedCoders,
        this.codingJobForm.value.doubleCodingAbsolute,
        this.codingJobForm.value.doubleCodingPercentage,
        data.selectedVariableBundles,
        this.codingJobForm.value.caseOrderingMode,
        this.codingJobForm.value.maxCodingCases
      ));

      if (result && result.success) {
        this.snackBar.open(result.message, this.translateService.instant('common.close'), { duration: 3000 });

        await this.openBulkCreationResultsDialog({
          doubleCodingInfo: result.doubleCodingInfo,
          jobs: result.jobs
        });

        this.dialogRef.close({ bulkJobCreation: true, distributedJobs: result.jobs });
      } else if (result) {
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.bulk-creation-failed-with-message', { message: result.message }), this.translateService.instant('common.close'), { duration: 5000 });
      } else {
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.bulk-creation-no-response'), this.translateService.instant('common.close'), { duration: 5000 });
      }
    } catch (error) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.bulk-creation-failed', { error: error instanceof Error ? error.message : String(error) }), this.translateService.instant('common.close'), { duration: 5000 });
    }

    this.isSaving = false;
  }

  toggleBundleSelection(bundle: VariableBundle): void {
    const wasSelected = this.selectedVariableBundles.isSelected(bundle);
    this.selectedVariableBundles.toggle(bundle);
    const isNowSelected = this.selectedVariableBundles.isSelected(bundle);

    if (!wasSelected && isNowSelected) {
      this.removeConflictingIndividualSelections(bundle);
    }
  }

  private removeConflictingIndividualSelections(bundle: VariableBundle): void {
    const variablesToRemove = this.selectedVariables.selected.filter(variable => bundle.variables.some(bundleVar => bundleVar.unitName === variable.unitName && bundleVar.variableId === variable.variableId
    )
    );

    variablesToRemove.forEach(variable => {
      this.selectedVariables.deselect(variable);
    });
  }

  toggleDoubleCodingMode(): void {
    if (this.doubleCodingMode === 'absolute') {
      this.doubleCodingMode = 'percentage';
      this.codingJobForm.get('doubleCodingAbsolute')?.setValue(0);
    } else {
      this.doubleCodingMode = 'absolute';
      this.codingJobForm.get('doubleCodingPercentage')?.setValue(0);
    }
  }

  get currentDoubleCodingControl(): FormControl {
    const controlName = this.doubleCodingMode === 'absolute' ? 'doubleCodingAbsolute' : 'doubleCodingPercentage';
    return this.codingJobForm.get(controlName) as FormControl;
  }

  getDoubleCodingLabel(): string {
    if (this.doubleCodingMode === 'absolute') {
      return this.translateService.instant('coding-job-definition-dialog.double-coding.labels.absolute');
    }
    return this.translateService.instant('coding-job-definition-dialog.double-coding.labels.percentage');
  }

  getDoubleCodingPlaceholder(): string {
    if (this.doubleCodingMode === 'absolute') {
      return this.translateService.instant('coding-job-definition-dialog.double-coding.placeholders.absolute');
    }
    return this.translateService.instant('coding-job-definition-dialog.double-coding.placeholders.percentage');
  }

  private submitDefinitionCreate(): void {
    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const selectedCoderIds = this.selectedCoders.selected.map(c => c.id);

    const jobDefinition: JobDefinition = {
      status: 'draft',
      assignedVariables: this.selectedVariables.selected,
      assignedVariableBundles: this.selectedVariableBundles.selected,
      assignedCoders: selectedCoderIds,
      durationSeconds: this.codingJobForm.value.durationSeconds,
      maxCodingCases: this.codingJobForm.value.maxCodingCases,
      doubleCodingAbsolute: this.codingJobForm.value.doubleCodingAbsolute,
      doubleCodingPercentage: this.codingJobForm.value.doubleCodingPercentage,
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode
    };

    this.backendService.createJobDefinition(workspaceId, jobDefinition).subscribe({
      next: createdDefinition => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-created-success'), this.translateService.instant('common.close'), { duration: 3000 });
        this.dialogRef.close(createdDefinition);
      },
      error: error => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-creating-definition', { error: error.message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  private submitDefinitionUpdate(): void {
    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const selectedCoderIds = this.selectedCoders.selected.map(c => c.id);

    const jobDefinition: Partial<JobDefinition> = {
      assignedVariables: this.selectedVariables.selected,
      assignedVariableBundles: this.selectedVariableBundles.selected,
      assignedCoders: selectedCoderIds,
      durationSeconds: this.codingJobForm.value.durationSeconds,
      maxCodingCases: this.codingJobForm.value.maxCodingCases,
      doubleCodingAbsolute: this.codingJobForm.value.doubleCodingAbsolute,
      doubleCodingPercentage: this.codingJobForm.value.doubleCodingPercentage,
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode
    };

    if (this.codingJobForm.get('status')) {
      jobDefinition.status = this.codingJobForm.value.status;
    }

    this.backendService.updateJobDefinition(workspaceId, this.data.jobDefinitionId!, jobDefinition).subscribe({
      next: updatedDefinition => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-updated-success'), this.translateService.instant('common.close'), { duration: 3000 });
        this.dialogRef.close(updatedDefinition);
      },
      error: error => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-updating-definition', { error: error.message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  onSubmitForReview(): void {
    if (this.codingJobForm.invalid) {
      return;
    }

    // Validate that at least one coder is selected
    if (this.selectedCoders.selected.length === 0) {
      this.snackBar.open(
        this.translateService.instant('coding-job-definition-dialog.validation.coder-required'),
        this.translateService.instant('common.close'),
        { duration: 5000 }
      );
      return;
    }

    // Validate that at least one variable or variable bundle is selected
    if (this.selectedVariables.selected.length === 0 && this.selectedVariableBundles.selected.length === 0) {
      this.snackBar.open(
        this.translateService.instant('coding-job-definition-dialog.validation.variable-or-bundle-required'),
        this.translateService.instant('common.close'),
        { duration: 5000 }
      );
      return;
    }

    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const selectedCoderIds = this.selectedCoders.selected.map(c => c.id);

    const jobDefinition: JobDefinition = {
      status: 'pending_review', // Submit for review
      assignedVariables: this.selectedVariables.selected,
      assignedVariableBundles: this.selectedVariableBundles.selected,
      assignedCoders: selectedCoderIds,
      durationSeconds: this.codingJobForm.value.durationSeconds,
      maxCodingCases: this.codingJobForm.value.maxCodingCases,
      doubleCodingAbsolute: this.codingJobForm.value.doubleCodingAbsolute,
      doubleCodingPercentage: this.codingJobForm.value.doubleCodingPercentage,
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode
    };

    this.backendService.createJobDefinition(workspaceId, jobDefinition).subscribe({
      next: createdDefinition => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-submitted-review'), this.translateService.instant('common.close'), { duration: 3000 });
        this.dialogRef.close(createdDefinition);
      },
      error: error => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-submitting-review', { error: error.message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
