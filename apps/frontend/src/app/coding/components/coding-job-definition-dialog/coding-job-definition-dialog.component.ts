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
import {
  CodingJob,
  JobDefinitionCoderConfig,
  VariableBundle,
  Variable
} from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import {
  CodingJobBackendService,
  ManualCodingScopeSummary
} from '../../services/coding-job-backend.service';
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { CodingJobBulkCreationDialogComponent, BulkCreationData, BulkCreationResult } from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';

export interface CodingJobDefinitionDialogData {
  codingJob?: CodingJob;
  isEdit: boolean;
  mode: 'definition' | 'job';
  jobDefinitionId?: number;
  preloadedVariables?: Variable[];
  readOnly?: boolean;
}

export interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  assignedCoders?: number[];
  assignedCoderConfigs?: JobDefinitionCoderConfig[];
  missingsProfileId?: number | null;
  distributionSeed?: string;
  plannedVariableUsage?: Record<string, number>;
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  createdJobsCount?: number;
  created_at?: Date;
  updated_at?: Date;
}

interface CreationResults {
  doubleCodingInfo: Record<string, {
    totalCases: number;
    distinctCases?: number;
    codingTasksTotal?: number;
    doubleCodedCases: number;
    singleCodedCasesAssigned: number;
    doubleCodedCasesPerCoder: Record<string, number>;
  }>;
  distributionByCoderId?: Record<string, Record<string, number>>;
  jobs: {
    itemKey?: string;
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
  private codingJobBackendService = inject(CodingJobBackendService);
  private distributedCodingService = inject(DistributedCodingService);
  private appService = inject(AppService);
  private coderService = inject(CoderService);
  private snackBar = inject(MatSnackBar);
  private codingJobService = inject(CodingJobService);
  private testPersonCodingService = inject(TestPersonCodingService);
  private missingsProfileService = inject(MissingsProfileService);
  private matDialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();

  codingJobForm!: FormGroup;
  isLoading = false;
  isSaving = false;

  get isReadOnly(): boolean {
    return this.data.readOnly === true;
  }

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
  private readonly defaultCoderCapacityPercent = 100;
  private readonly minCoderCapacityPercent = 10;
  private readonly maxCoderCapacityPercent = 300;

  // Variable bundles
  variableBundles: VariableBundle[] = [];
  selectedVariableBundles = new SelectionModel<VariableBundle>(true, []);
  bundlesDataSource = new MatTableDataSource<VariableBundle>([]);
  isLoadingBundles = false;

  // Variable analysis items
  isLoadingVariableAnalysis = false;
  totalVariableAnalysisRecords = 0;

  // Missing profiles
  missingsProfiles: { label: string; id: number }[] = [{ id: 0, label: 'IQB-Standard' }];
  isLoadingMissingsProfiles = false;

  // Filters
  unitNameFilter = '';
  variableIdFilter = '';
  bundleNameFilter = '';
  availabilityFilter: 'all' | 'full' | 'partial' | 'none' = 'all';
  trainingRequiredFilter: 'all' | 'true' | 'false' = 'all';

  private disabledVariableKeys = new Set<string>();
  private baseAvailableCasesByVariable = new Map<string, number>();
  existingJobDefinitions: JobDefinition[] = [];
  manualCodingScopeSummary: ManualCodingScopeSummary | null = null;

  constructor(
    public dialogRef: MatDialogRef<CodingJobDefinitionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CodingJobDefinitionDialogData
  ) { }

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
    if (this.data.isEdit && this.data.mode === 'job' && this.data.codingJob?.id) {
      this.loadCoders(this.data.codingJob.id);
    }

    if (this.data.mode === 'definition') {
      this.loadExistingJobDefinitions();
      this.loadMissingsProfiles();
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

    this.testPersonCodingService.autoCodingCompleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadCodingIncompleteVariables(this.unitNameFilter || undefined, true);
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
        this.availableCoders = coders.map(coder => ({
          ...coder,
          capacityPercent: this.getInitialCoderCapacityPercent(coder.id)
        }));
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

  private getInitialCoderCapacityPercent(coderId: number): number {
    const configuredCapacity = this.data.codingJob?.assignedCoderConfigs
      ?.find(config => config.coderId === coderId)
      ?.capacityPercent;

    return this.normalizeCoderCapacityPercent(configuredCapacity);
  }

  private normalizeCoderCapacityPercent(value: unknown): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return this.defaultCoderCapacityPercent;
    }

    return Math.min(
      this.maxCoderCapacityPercent,
      Math.max(this.minCoderCapacityPercent, numericValue)
    );
  }

  getCoderCapacityPercent(coder: Coder): number {
    return this.normalizeCoderCapacityPercent(coder.capacityPercent);
  }

  updateCoderCapacityPercent(coder: Coder, value: unknown): void {
    if (this.isReadOnly) {
      return;
    }

    coder.capacityPercent = this.normalizeCoderCapacityPercent(value);
  }

  getSelectedCoderConfigs(): JobDefinitionCoderConfig[] {
    return this.selectedCoders.selected.map(coder => ({
      coderId: coder.id,
      capacityPercent: this.getCoderCapacityPercent(coder)
    }));
  }

  private getSelectedCodersForDistribution(): Coder[] {
    return this.selectedCoders.selected.map(coder => ({
      ...coder,
      capacityPercent: this.getCoderCapacityPercent(coder)
    }));
  }

  private mapCodersForDistribution(coders: Coder[]): {
    id: number;
    name: string;
    username: string;
    capacityPercent: number;
  }[] {
    return coders.map(coder => ({
      id: coder.id,
      name: coder.name,
      username: coder.name,
      capacityPercent: this.normalizeCoderCapacityPercent(coder.capacityPercent)
    }));
  }

  loadExistingJobDefinitions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.codingJobBackendService.getJobDefinitions(workspaceId).subscribe({
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
      doubleCodingAbsolute: [this.data.codingJob?.doubleCodingAbsolute ?? 0, [Validators.min(0)]],
      doubleCodingPercentage: [this.data.codingJob?.doubleCodingPercentage ?? 0, [Validators.min(0), Validators.max(100)]],
      caseOrderingMode: [this.data.codingJob?.caseOrderingMode || 'continuous', [Validators.required]],
      showScore: [this.data.codingJob?.showScore ?? this.data.mode !== 'definition', []],
      allowComments: [this.data.codingJob?.allowComments ?? true, []],
      suppressGeneralInstructions: [this.data.codingJob?.suppressGeneralInstructions ?? false, []]
    };

    if (this.data.mode === 'definition') {
      formFields.missingsProfileId = [
        this.data.codingJob?.missingsProfileId ?? this.data.codingJob?.missings_profile_id ?? 0,
        [Validators.min(0)]
      ];
    }

    if (this.data.mode === 'job') {
      formFields.suppressGeneralInstructions = [this.data.codingJob?.suppressGeneralInstructions ?? false, []];
    }

    if (this.data.isEdit) {
      const defaultStatus = this.data.mode === 'definition' ? 'draft' : 'pending';
      formFields.status = [this.data.codingJob?.status || defaultStatus, [Validators.required]];
    }

    this.codingJobForm = this.fb.group(formFields);

    if (this.isReadOnly) {
      this.codingJobForm.disable({ emitEvent: false });
    }

    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;

    if (originallyAssigned && originallyAssigned.length > 0) {
      this.selectedVariables = new SelectionModel<Variable>(true, [...originallyAssigned]);
    }
  }

  private loadMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.isLoadingMissingsProfiles = true;
    this.missingsProfileService.getMissingsProfiles(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: profiles => {
          this.missingsProfiles = profiles.length > 0 ? profiles : [{ id: 0, label: 'IQB-Standard' }];
          this.isLoadingMissingsProfiles = false;

          const control = this.codingJobForm.get('missingsProfileId');
          const currentValue = control?.value;
          if (
            control &&
            (currentValue === null || currentValue === undefined || currentValue === 0) &&
            profiles.length > 0
          ) {
            const defaultProfile = profiles.find(profile => profile.label === 'IQB-Standard') ?? profiles[0];
            control.setValue(defaultProfile.id, { emitEvent: false });
          }
        },
        error: () => {
          this.isLoadingMissingsProfiles = false;
        }
      });
  }

  loadCodingIncompleteVariables(unitNameFilter?: string, forceReload: boolean = false): void {
    this.isLoadingVariableAnalysis = true;
    const trainingRequired = this.trainingRequiredFilter === 'all' ? undefined : this.trainingRequiredFilter === 'true';

    if (this.data.preloadedVariables && !forceReload && !unitNameFilter && trainingRequired === undefined) {
      this.variables = this.data.preloadedVariables;
      this.loadManualCodingScopeSummary(undefined, undefined);
      this.snapshotBaseAvailability(this.variables);
      this.applyJobDefinitionUsage();
      this.applyAvailabilityFilter();
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

    this.loadManualCodingScopeSummary(unitNameFilter || undefined, trainingRequired);
    this.codingJobBackendService.getCodingIncompleteVariables(
      workspaceId,
      unitNameFilter || undefined,
      trainingRequired
    ).subscribe({
      next: variables => {
        this.variables = variables;
        this.snapshotBaseAvailability(this.variables);
        this.applyJobDefinitionUsage();
        this.applyAvailabilityFilter();
        this.processVariableSelection();
        this.totalVariableAnalysisRecords = variables.length;
        this.isLoadingVariableAnalysis = false;
      },
      error: () => {
        this.isLoadingVariableAnalysis = false;
      }
    });
  }

  private loadManualCodingScopeSummary(
    unitNameFilter?: string,
    trainingRequired?: boolean
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.manualCodingScopeSummary = null;
      return;
    }

    this.codingJobBackendService.getManualCodingScopeSummary(
      workspaceId,
      unitNameFilter,
      trainingRequired
    ).subscribe({
      next: summary => {
        this.manualCodingScopeSummary = summary;
      },
      error: () => {
        this.manualCodingScopeSummary = null;
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
      const assignedByKey = new Map(originallyAssigned.map(variable => [
        toKey(variable),
        variable
      ]));

      this.selectedVariables.clear();
      this.variables.forEach(rowVar => {
        const rowKey = makeKey(rowVar.unitName ?? '', rowVar.variableId ?? '');
        rowVar.includeDeriveError = assignedByKey.get(rowKey)?.includeDeriveError === true;
        if (assignedKeySet.has(rowKey)) {
          this.selectedVariables.select(rowVar);
        }
      });
    } else {
      this.variables.forEach(rowVar => {
        rowVar.includeDeriveError = false;
      });
    }
  }

  loadVariableBundles(): void {
    this.isLoadingBundles = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.codingJobBackendService.getVariableBundles(workspaceId).subscribe({
        next: bundles => {
          const enrichedBundles = bundles.map(bundle => ({
            ...bundle,
            variables: bundle.variables.map((bundleVar: Variable) => {
              const metrics = this.getVariableMetrics(bundleVar);
              return { ...bundleVar, ...metrics };
            })
          }));

          this.variableBundles = enrichedBundles;
          this.bundlesDataSource.data = enrichedBundles;
          this.isLoadingBundles = false;
          if (this.data.isEdit && this.data.codingJob) {
            const assignedBundles = this.data.codingJob.variableBundles || this.data.codingJob.assignedVariableBundles;
            if (assignedBundles && assignedBundles.length > 0) {
              const ids = assignedBundles.map(b => b.id);
              const preSelected = this.variableBundles.filter(b => ids.includes(b.id));
              preSelected.forEach(bundle => {
                const savedBundle = assignedBundles.find(ab => ab.id === bundle.id);
                if (savedBundle?.caseOrderingMode) {
                  bundle.caseOrderingMode = savedBundle.caseOrderingMode;
                }
              });
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

  private getVariableUsageKey(unitName?: string | null, variableId?: string | null): string {
    return `${(unitName || '').trim().toLowerCase()}::${(variableId || '').trim().toLowerCase()}`;
  }

  private snapshotBaseAvailability(variables: Variable[]): void {
    this.baseAvailableCasesByVariable = new Map(
      variables.map(variable => [
        this.getVariableUsageKey(variable.unitName, variable.variableId),
        variable.availableCases ?? variable.uniqueCasesAfterAggregation ?? variable.responseCount ?? 0
      ])
    );
  }

  applyJobDefinitionUsage(): void {
    if (!this.variables || this.variables.length === 0) return;

    const casesUsedInDefinitions = new Map<string, number>();
    const makeKey = (u?: string | null, v?: string | null) => this.getVariableUsageKey(u, v);
    const makeKeyFromUsageKey = (variableKey: string): string => {
      const [unitName, variableId] = variableKey.split('::');
      return variableId === undefined ?
        variableKey.trim().toLowerCase() :
        makeKey(unitName, variableId);
    };

    // Count cases used in each job definition (excluding the current one being edited)
    if (this.existingJobDefinitions && this.existingJobDefinitions.length > 0) {
      this.existingJobDefinitions.forEach(def => {
        // Skip the current definition being edited
        if (this.data.isEdit && this.data.jobDefinitionId && def.id === this.data.jobDefinitionId) {
          return;
        }

        if ((def.createdJobsCount ?? 0) > 0) {
          return;
        }

        Object.entries(def.plannedVariableUsage || {}).forEach(([variableKey, usage]) => {
          if (!Number.isFinite(usage) || usage <= 0) {
            return;
          }

          const normalizedKey = makeKeyFromUsageKey(variableKey);
          casesUsedInDefinitions.set(
            normalizedKey,
            (casesUsedInDefinitions.get(normalizedKey) || 0) + usage
          );
        });
      });
    }

    // Adjust available cases based on cases used in definitions.
    // Start with backend availability so already created coding jobs remain reserved.
    this.variables.forEach(v => {
      const key = makeKey(v.unitName, v.variableId);
      const casesUsed = casesUsedInDefinitions.get(key) || 0;
      const originalAvailable = this.baseAvailableCasesByVariable.get(key) ??
        v.availableCases ??
        v.uniqueCasesAfterAggregation ??
        v.responseCount ??
        0;
      v.availableCases = Math.max(0, originalAvailable - casesUsed);
    });

    this.syncBundleVariablesWithAvailability();
    this.syncSelectionWithAvailability();
  }

  private getVariableMetrics(variable: Pick<Variable, 'unitName' | 'variableId'>): Pick<Variable, 'responseCount' | 'deriveErrorResponseCount' | 'availableCases' | 'uniqueCasesAfterAggregation' | 'casesInJobs' | 'isDerived' | 'coderTrainingRequired'> {
    const matchingVar = this.variables.find(
      v => v.unitName === variable.unitName && v.variableId === variable.variableId
    );

    return {
      responseCount: matchingVar?.responseCount ?? 0,
      deriveErrorResponseCount: matchingVar?.deriveErrorResponseCount ?? 0,
      availableCases: matchingVar?.availableCases,
      uniqueCasesAfterAggregation: matchingVar?.uniqueCasesAfterAggregation,
      casesInJobs: matchingVar?.casesInJobs,
      isDerived: matchingVar?.isDerived,
      coderTrainingRequired: matchingVar?.coderTrainingRequired
    };
  }

  private syncBundleVariablesWithAvailability(): void {
    if (!this.variableBundles || this.variableBundles.length === 0) {
      return;
    }

    this.variableBundles = this.variableBundles.map(bundle => ({
      ...bundle,
      variables: bundle.variables.map(bundleVar => {
        const metrics = this.getVariableMetrics(bundleVar);
        return { ...bundleVar, ...metrics };
      })
    }));

    this.bundlesDataSource.data = this.variableBundles;
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
    let filteredData = this.variables;
    if (this.unitNameFilter || this.variableIdFilter) {
      filteredData = filteredData.filter(v => {
        const matchesUnit = !this.unitNameFilter ||
          v.unitName?.toLowerCase().includes(this.unitNameFilter.toLowerCase());
        const matchesVariable = !this.variableIdFilter ||
          v.variableId?.toLowerCase().includes(this.variableIdFilter.toLowerCase());
        return matchesUnit && matchesVariable;
      });
    }

    if (this.availabilityFilter !== 'all') {
      filteredData = filteredData.filter(v => {
        const effectiveTotal = v.uniqueCasesAfterAggregation ?? v.responseCount;
        const availableRaw = v.availableCases !== undefined ?
          v.availableCases :
          effectiveTotal ?? 0;
        const totalRaw = effectiveTotal !== undefined ?
          effectiveTotal :
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
    this.trainingRequiredFilter = 'all';
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
    if (variable.availableCases !== undefined && variable.availableCases === 0) {
      const effectiveTotal = variable.uniqueCasesAfterAggregation ?? variable.responseCount ?? 0;
      return `Alle ${effectiveTotal} Fälle bereits verteilt`;
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
    const itemCount = this.selectedVariables.selected.length + this.selectedVariableBundles.selected.length;
    const coderCount = this.selectedCoders.selected.length;

    if (itemCount === 0 || coderCount === 0) {
      return 0;
    }

    return itemCount * coderCount;
  }

  private getVariableEffectiveCases(variable: Variable): number {
    return variable.uniqueCasesAfterAggregation ?? variable.responseCount ?? variable.availableCases ?? 0;
  }

  private getVariableAvailableCases(variable: Variable): number {
    return variable.availableCases ?? this.getVariableEffectiveCases(variable);
  }

  getSelectedEffectiveCodingCases(): number {
    let total = this.selectedVariables.selected
      .reduce((sum, variable) => sum + this.getVariableEffectiveCases(variable), 0);

    this.selectedVariableBundles.selected.forEach(bundle => {
      bundle.variables.forEach(variable => {
        total += this.getVariableEffectiveCases(variable as unknown as Variable);
      });
    });

    return total;
  }

  getDistributableCodingCasesBeforeLimit(): number {
    let total = this.selectedVariables.selected
      .reduce((sum, variable) => sum + this.getVariableAvailableCases(variable), 0);

    this.selectedVariableBundles.selected.forEach(bundle => {
      bundle.variables.forEach(variable => {
        total += this.getVariableAvailableCases(variable as unknown as Variable);
      });
    });

    return total;
  }

  getUnavailableSelectedCodingCases(): number {
    return Math.max(
      0,
      this.getSelectedEffectiveCodingCases() - this.getDistributableCodingCasesBeforeLimit()
    );
  }

  getMaxCasesLimitReduction(): number {
    const maxCases = this.codingJobForm.getRawValue().maxCodingCases;
    const total = this.getDistributableCodingCasesBeforeLimit();

    if (
      this.data.mode === 'definition' &&
      typeof maxCases === 'number' &&
      maxCases > 0
    ) {
      return Math.max(0, total - Math.min(total, maxCases));
    }

    return 0;
  }

  getTotalCodingCases(): number {
    const maxCases = this.codingJobForm.getRawValue().maxCodingCases;
    const isDefinitionMode = this.data.mode === 'definition';
    let total = this.getDistributableCodingCasesBeforeLimit();

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

  getTotalDoubleCodedCases(): number {
    const totalCases = this.getTotalCodingCases();
    if (totalCases === 0) return 0;

    const { doubleCodingAbsolute, doubleCodingPercentage } = this.codingJobForm.getRawValue();

    if (this.doubleCodingMode === 'absolute') {
      return Math.min(doubleCodingAbsolute || 0, totalCases);
    }

    return Math.floor(((doubleCodingPercentage || 0) / 100) * totalCases);
  }

  getTotalCodingTasks(): number {
    return this.getTotalCodingCases() + this.getTotalDoubleCodedCases();
  }

  getTotalTimeInSeconds(): number {
    const durationPerCase = this.codingJobForm.getRawValue().durationSeconds || 1;
    return this.getTotalCodingTasks() * durationPerCase;
  }

  getTimePerCoderInSeconds(): number {
    const totalTime = this.getTotalTimeInSeconds();
    const capacityWeights = this.selectedCoders.selected.map(
      coder => this.getCoderCapacityPercent(coder) / 100
    );
    if (capacityWeights.length === 0) return totalTime;

    const totalCapacityWeight = capacityWeights.reduce((sum, weight) => sum + weight, 0);
    if (totalCapacityWeight <= 0) return totalTime;

    const normalizedLoadSeconds = totalTime / totalCapacityWeight;
    const highestCapacityWeight = Math.max(...capacityWeights);
    return Math.ceil(normalizedLoadSeconds * highestCapacityWeight);
  }

  getFormattedTotalTime(): string {
    return this.formatTime(this.getTotalTimeInSeconds());
  }

  getFormattedTimePerCoder(): string {
    return this.formatTime(this.getTimePerCoderInSeconds());
  }

  private formatTime(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  onAvailabilityChange(event: { value: 'all' | 'full' | 'partial' | 'none' }): void {
    this.availabilityFilter = event.value;
    this.applyAvailabilityFilter();
  }

  getAvailabilityClass(variable: Variable): string {
    const effectiveTotal = variable.uniqueCasesAfterAggregation ?? variable.responseCount;
    if (variable.availableCases === undefined || effectiveTotal === undefined) {
      return '';
    }

    const availabilityPercentage = (variable.availableCases / effectiveTotal) * 100;

    if (availabilityPercentage === 100) {
      return 'availability-full';
    } if (availabilityPercentage > 0) {
      return 'availability-partial';
    }
    return 'availability-none';
  }

  getAvailabilityText(variable: Variable): string {
    const effectiveTotal = variable.uniqueCasesAfterAggregation ?? variable.responseCount;
    if (variable.availableCases === undefined || effectiveTotal === undefined) {
      return `${effectiveTotal || 0}`;
    }

    return `${variable.availableCases}/${effectiveTotal}`;
  }

  isAllSelected(): boolean {
    const selectableRows = this.dataSource.data.filter(v => !this.isVariableDisabled(v));
    const numSelected = this.selectedVariables.selected.filter(v => !this.isVariableDisabled(v)).length;
    const numRows = selectableRows.length;
    return numSelected === numRows && numRows > 0;
  }

  masterToggle(): void {
    if (this.isReadOnly) {
      return;
    }

    const selectableRows = this.dataSource.data.filter(v => !this.isVariableDisabled(v));
    if (this.isAllSelected()) {
      selectableRows.forEach(row => this.selectedVariables.deselect(row));
    } else {
      selectableRows.forEach(row => this.selectedVariables.select(row));
    }
  }

  isDeriveErrorIncluded(variable: Variable): boolean {
    return variable.includeDeriveError === true;
  }

  hasDeriveErrorResponses(variable: Variable): boolean {
    return (variable.deriveErrorResponseCount ?? 0) > 0 || variable.includeDeriveError === true;
  }

  setDeriveErrorIncluded(variable: Variable, includeDeriveError: boolean): void {
    if (this.isReadOnly || this.data.mode !== 'definition' || !this.hasDeriveErrorResponses(variable)) {
      return;
    }

    variable.includeDeriveError = includeDeriveError;
    const selectedVariable = this.selectedVariables.selected.find(
      selected => selected.unitName === variable.unitName && selected.variableId === variable.variableId
    );
    if (selectedVariable) {
      selectedVariable.includeDeriveError = includeDeriveError;
    }
  }

  private getSelectedDefinitionVariables(): Variable[] {
    return this.selectedVariables.selected.map(variable => ({
      unitName: variable.unitName,
      variableId: variable.variableId,
      ...(variable.includeDeriveError === true && this.hasDeriveErrorResponses(variable) ? { includeDeriveError: true } : {})
    }));
  }

  isAllCodersSelected(): boolean {
    const numSelected = this.selectedCoders.selected.length;
    const numRows = this.availableCoders.length;
    return numSelected === numRows && numRows > 0;
  }

  masterCoderToggle(): void {
    if (this.isReadOnly) {
      return;
    }

    if (this.isAllCodersSelected()) {
      this.selectedCoders.clear();
    } else {
      this.availableCoders.forEach(coder => this.selectedCoders.select(coder));
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isReadOnly) {
      this.dialogRef.close();
      return;
    }

    if (this.isSaving) {
      return;
    }

    if (this.codingJobForm.invalid) {
      this.codingJobForm.markAllAsTouched();
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

      if (this.getCodingJobCount() > 1) {
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

    this.codingJobBackendService.updateCodingJob(workspaceId, this.data.codingJob!.id!, codingJob).subscribe({
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

    this.codingJobBackendService.createCodingJob(workspaceId, codingJob).subscribe({
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
      selectedCoders: this.getSelectedCodersForDistribution(),
      doubleCodingAbsolute: this.codingJobForm.value.doubleCodingAbsolute,
      doubleCodingPercentage: this.codingJobForm.value.doubleCodingPercentage,
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode,
      maxCodingCases: this.codingJobForm.value.maxCodingCases,
      distributionSeed: this.data.codingJob?.distributionSeed,
      displayOptions: {
        showScore: this.codingJobForm.value.showScore ?? true,
        allowComments: this.codingJobForm.value.allowComments ?? true,
        suppressGeneralInstructions: this.codingJobForm.value.suppressGeneralInstructions ?? false
      }
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

  private async createBulkJobs(data: BulkCreationData, displayOptions: BulkCreationResult): Promise<void> {
    this.isSaving = true;
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    try {
      const mappedCoders = this.mapCodersForDistribution(data.selectedCoders);
      const result = await firstValueFrom(this.distributedCodingService.createDistributedCodingJobs(
        workspaceId,
        data.selectedVariables,
        mappedCoders,
        this.codingJobForm.value.doubleCodingAbsolute,
        this.codingJobForm.value.doubleCodingPercentage,
        data.selectedVariableBundles,
        this.codingJobForm.value.caseOrderingMode,
        this.codingJobForm.value.maxCodingCases,
        {
          showScore: displayOptions.showScore,
          allowComments: displayOptions.allowComments,
          suppressGeneralInstructions: displayOptions.suppressGeneralInstructions
        },
        data.distributionSeed
      ));

      if (result && result.success) {
        this.snackBar.open(result.message, this.translateService.instant('common.close'), { duration: 3000 });

        await this.openBulkCreationResultsDialog({
          doubleCodingInfo: result.doubleCodingInfo,
          distributionByCoderId: result.distributionByCoderId,
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
    if (this.isReadOnly) {
      return;
    }

    const wasSelected = this.selectedVariableBundles.isSelected(bundle);
    this.selectedVariableBundles.toggle(bundle);
    const isNowSelected = this.selectedVariableBundles.isSelected(bundle);

    if (!wasSelected && isNowSelected) {
      if (!bundle.caseOrderingMode) {
        bundle.caseOrderingMode = this.codingJobForm.value.caseOrderingMode || 'continuous';
      }
      this.removeConflictingIndividualSelections(bundle);
    }
  }

  setBundleOrderingMode(bundle: VariableBundle, mode: 'continuous' | 'alternating'): void {
    if (this.isReadOnly) {
      return;
    }

    bundle.caseOrderingMode = mode;
    const selectedBundle = this.selectedVariableBundles.selected.find(b => b.id === bundle.id);
    if (selectedBundle && selectedBundle !== bundle) {
      selectedBundle.caseOrderingMode = mode;
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

  setDoubleCodingMode(mode: 'absolute' | 'percentage'): void {
    if (this.isReadOnly) {
      return;
    }

    if (this.doubleCodingMode === mode) {
      return;
    }

    this.doubleCodingMode = mode;

    if (mode === 'percentage') {
      this.codingJobForm.get('doubleCodingAbsolute')?.setValue(0);
    } else {
      this.codingJobForm.get('doubleCodingPercentage')?.setValue(0);
    }

    this.codingJobForm.get('doubleCodingAbsolute')?.updateValueAndValidity();
    this.codingJobForm.get('doubleCodingPercentage')?.updateValueAndValidity();
  }

  toggleDoubleCodingMode(): void {
    this.setDoubleCodingMode(this.doubleCodingMode === 'absolute' ? 'percentage' : 'absolute');
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
    const selectedCoderConfigs = this.getSelectedCoderConfigs();

    const jobDefinition: JobDefinition = {
      status: 'draft',
      assignedVariables: this.getSelectedDefinitionVariables(),
      assignedVariableBundles: this.selectedVariableBundles.selected.map(b => ({ id: b.id, name: b.name, caseOrderingMode: b.caseOrderingMode })) as unknown as VariableBundle[],
      assignedCoders: selectedCoderIds,
      assignedCoderConfigs: selectedCoderConfigs,
      durationSeconds: this.sanitizeNumber(this.codingJobForm.value.durationSeconds),
      maxCodingCases: this.sanitizeNumber(this.codingJobForm.value.maxCodingCases),
      doubleCodingAbsolute: this.sanitizeNumber(this.codingJobForm.value.doubleCodingAbsolute),
      doubleCodingPercentage: this.sanitizeNumber(this.codingJobForm.value.doubleCodingPercentage),
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode,
      missingsProfileId: this.sanitizeNumber(this.codingJobForm.value.missingsProfileId),
      showScore: this.codingJobForm.value.showScore,
      allowComments: this.codingJobForm.value.allowComments,
      suppressGeneralInstructions: this.codingJobForm.value.suppressGeneralInstructions
    };

    this.codingJobBackendService.createJobDefinition(workspaceId, jobDefinition).subscribe({
      next: createdDefinition => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-created-success'), this.translateService.instant('common.close'), { duration: 3000 });
        this.dialogRef.close(createdDefinition);
      },
      error: error => {
        this.isSaving = false;
        const message = this.getErrorMessage(error);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-creating-definition', { error: message }), this.translateService.instant('common.close'), { duration: 5000 });
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
    const selectedCoderConfigs = this.getSelectedCoderConfigs();

    const jobDefinition: Partial<JobDefinition> = {
      assignedVariables: this.getSelectedDefinitionVariables(),
      assignedVariableBundles: this.selectedVariableBundles.selected.map(b => ({ id: b.id, name: b.name, caseOrderingMode: b.caseOrderingMode })) as unknown as VariableBundle[],
      assignedCoders: selectedCoderIds,
      assignedCoderConfigs: selectedCoderConfigs,
      durationSeconds: this.sanitizeNumber(this.codingJobForm.value.durationSeconds),
      maxCodingCases: this.sanitizeNumber(this.codingJobForm.value.maxCodingCases),
      doubleCodingAbsolute: this.sanitizeNumber(this.codingJobForm.value.doubleCodingAbsolute),
      doubleCodingPercentage: this.sanitizeNumber(this.codingJobForm.value.doubleCodingPercentage),
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode,
      missingsProfileId: this.sanitizeNumber(this.codingJobForm.value.missingsProfileId),
      showScore: this.codingJobForm.value.showScore,
      allowComments: this.codingJobForm.value.allowComments,
      suppressGeneralInstructions: this.codingJobForm.value.suppressGeneralInstructions
    };

    if (this.codingJobForm.get('status')) {
      jobDefinition.status = this.codingJobForm.value.status;
    }

    this.codingJobBackendService.updateJobDefinition(workspaceId, this.data.jobDefinitionId!, jobDefinition).subscribe({
      next: updatedDefinition => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-updated-success'), this.translateService.instant('common.close'), { duration: 3000 });
        this.dialogRef.close(updatedDefinition);
      },
      error: error => {
        this.isSaving = false;
        const message = this.getErrorMessage(error);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-updating-definition', { error: message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  onSubmitForReview(): void {
    if (this.isReadOnly) {
      this.dialogRef.close();
      return;
    }

    if (this.isSaving) {
      return;
    }

    if (this.codingJobForm.invalid) {
      this.codingJobForm.markAllAsTouched();
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
    const selectedCoderConfigs = this.getSelectedCoderConfigs();

    const jobDefinition: JobDefinition = {
      status: 'pending_review', // Submit for review
      assignedVariables: this.getSelectedDefinitionVariables(),
      assignedVariableBundles: this.selectedVariableBundles.selected.map(b => ({ id: b.id, name: b.name, caseOrderingMode: b.caseOrderingMode })) as unknown as VariableBundle[],
      assignedCoders: selectedCoderIds,
      assignedCoderConfigs: selectedCoderConfigs,
      durationSeconds: this.sanitizeNumber(this.codingJobForm.value.durationSeconds),
      maxCodingCases: this.sanitizeNumber(this.codingJobForm.value.maxCodingCases),
      doubleCodingAbsolute: this.sanitizeNumber(this.codingJobForm.value.doubleCodingAbsolute),
      doubleCodingPercentage: this.sanitizeNumber(this.codingJobForm.value.doubleCodingPercentage),
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode,
      missingsProfileId: this.sanitizeNumber(this.codingJobForm.value.missingsProfileId),
      showScore: this.codingJobForm.value.showScore,
      allowComments: this.codingJobForm.value.allowComments,
      suppressGeneralInstructions: this.codingJobForm.value.suppressGeneralInstructions
    };

    this.codingJobBackendService.createJobDefinition(workspaceId, jobDefinition).subscribe({
      next: createdDefinition => {
        this.isSaving = false;
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-submitted-review'), this.translateService.instant('common.close'), { duration: 3000 });
        this.dialogRef.close(createdDefinition);
      },
      error: error => {
        this.isSaving = false;
        const message = this.getErrorMessage(error);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-submitting-review', { error: message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  onCancel(): void {
    if (this.isSaving) {
      return;
    }

    this.dialogRef.close();
  }

  private sanitizeNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
  }

  private getErrorMessage(error: unknown): string {
    const err = error as { error?: { message?: string } | string; message?: string };
    if (err.error) {
      if (typeof err.error === 'object') {
        return err.error.message || JSON.stringify(err.error);
      }
      return err.error;
    }
    if (err.message) {
      return err.message;
    }
    return 'Unknown error';
  }
}
