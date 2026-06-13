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
  debounceTime, forkJoin, Subject, Subscription, takeUntil, firstValueFrom
} from 'rxjs';
import {
  CodingJob,
  DistributionVariableUsageByStatus,
  JobDefinitionCoderConfig,
  VariableBundle,
  Variable
} from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';
import {
  CodingJobBackendService,
  ManualCodingScopeSummary
} from '../../services/coding-job-backend.service';
import {
  DistributedCodingService,
  DistributionCalculationResponse
} from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { CodingJobBulkCreationDialogComponent, BulkCreationData, BulkCreationResult } from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import { JobDefinitionRefreshDialogComponent } from '../coding-job-definitions/job-definition-refresh-dialog.component';

export interface CodingJobDefinitionDialogData {
  codingJob?: CodingJob;
  isEdit: boolean;
  mode: 'definition' | 'job';
  jobDefinitionId?: number;
  preloadedVariables?: Variable[];
  readOnly?: boolean;
  createdJobsCount?: number;
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
  plannedVariableUsageByStatus?: Record<string, DistributionVariableUsageByStatus>;
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

interface EstimatedDistributionGroup {
  variableKey: string;
  remaining: number;
}

interface EstimatedDistributionItem {
  groups: EstimatedDistributionGroup[];
  nextGroupIndex: number;
  remaining: number;
}

interface DistributionPreviewSummary {
  totalCases: number;
  doubleCodedCases: number;
  totalCodingTasks: number;
  tasksPerCoder?: Record<string, number>;
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
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private matDialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();

  codingJobForm!: FormGroup;
  isLoading = false;
  isSaving = false;

  get isReadOnly(): boolean {
    return this.data.readOnly === true;
  }

  get hasExistingDefinitionJobs(): boolean {
    return this.data.mode === 'definition' &&
      this.data.isEdit &&
      (this.data.createdJobsCount ?? 0) > 0;
  }

  // Double coding configuration
  doubleCodingMode: 'absolute' | 'percentage' = 'absolute';

  // Variables
  variables: Variable[] = [];
  selectedVariables = this.createVariableSelectionModel();
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
  private baseAvailableCasesWithDeriveErrorByVariable = new Map<string, number>();
  private definitionDistributionSeed?: string;
  private distributionPreviewSummary: DistributionPreviewSummary | null = null;
  private readonly distributionPreviewRefresh$ = new Subject<void>();
  private distributionPreviewRequestId = 0;
  private selectionPreviewSubscription = new Subscription();
  existingJobDefinitions: JobDefinition[] = [];
  manualCodingScopeSummary: ManualCodingScopeSummary | null = null;
  includeDeriveErrorInManualCoding = false;

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
    this.bindSelectionPreviewRefresh();
    this.codingJobForm.valueChanges
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(() => this.queueDistributionPreviewRefresh());
    this.distributionPreviewRefresh$
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(() => this.loadDistributionPreview());
    this.loadIncludeDeriveErrorSetting();
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
    this.selectionPreviewSubscription.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindSelectionPreviewRefresh(): void {
    this.selectionPreviewSubscription.unsubscribe();
    this.selectionPreviewSubscription = new Subscription();

    this.selectionPreviewSubscription.add(
      this.selectedVariables.changed.subscribe(() => this.queueDistributionPreviewRefresh())
    );
    this.selectionPreviewSubscription.add(
      this.selectedVariableBundles.changed.subscribe(() => this.queueDistributionPreviewRefresh())
    );
    this.selectionPreviewSubscription.add(
      this.selectedCoders.changed.subscribe(() => this.queueDistributionPreviewRefresh())
    );
  }

  private queueDistributionPreviewRefresh(): void {
    if (this.data.mode !== 'definition' || this.isReadOnly) {
      return;
    }

    this.distributionPreviewSummary = null;
    this.distributionPreviewRefresh$.next();
  }

  private loadDistributionPreview(): void {
    if (
      this.data.mode !== 'definition' ||
      this.codingJobForm.invalid ||
      this.selectedCoders.selected.length === 0 ||
      (
        this.selectedVariables.selected.length === 0 &&
        this.selectedVariableBundles.selected.length === 0
      )
    ) {
      this.distributionPreviewSummary = null;
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.distributionPreviewSummary = null;
      return;
    }

    const requestId = this.distributionPreviewRequestId + 1;
    this.distributionPreviewRequestId = requestId;

    this.distributedCodingService.calculateDistribution(
      workspaceId,
      this.getSelectedDefinitionVariables(),
      this.mapCodersForDistribution(this.getSelectedCodersForDistribution()),
      this.sanitizeNumber(this.codingJobForm.value.doubleCodingAbsolute),
      this.sanitizeNumber(this.codingJobForm.value.doubleCodingPercentage),
      this.getSelectedDefinitionVariableBundles(),
      this.codingJobForm.value.caseOrderingMode,
      this.sanitizeNumber(this.codingJobForm.value.maxCodingCases),
      this.getDistributionSeed()
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: preview => {
          if (requestId !== this.distributionPreviewRequestId) {
            return;
          }

          this.distributionPreviewSummary = this.buildDistributionPreviewSummary(preview);
        },
        error: () => {
          if (requestId === this.distributionPreviewRequestId) {
            this.distributionPreviewSummary = null;
          }
        }
      });
  }

  private buildDistributionPreviewSummary(
    preview: DistributionCalculationResponse
  ): DistributionPreviewSummary {
    return Object.values(preview.doubleCodingInfo || {}).reduce(
      (summary, info) => {
        const distinctCases = Number(info.distinctCases);
        const doubleCodedCases = Number(info.doubleCodedCases || 0);
        const singleCodedCasesAssigned = Number(info.singleCodedCasesAssigned);
        const totalCases = Number.isFinite(distinctCases) ?
          distinctCases :
          doubleCodedCases + (Number.isFinite(singleCodedCasesAssigned) ? singleCodedCasesAssigned : 0);
        const codingTasksTotal = Number(info.codingTasksTotal);

        summary.totalCases += totalCases;
        summary.doubleCodedCases += doubleCodedCases;
        summary.totalCodingTasks += Number.isFinite(codingTasksTotal) ?
          codingTasksTotal :
          totalCases + doubleCodedCases;

        return summary;
      },
      {
        totalCases: 0,
        doubleCodedCases: 0,
        totalCodingTasks: 0,
        tasksPerCoder: preview.tasksPerCoder
      } as DistributionPreviewSummary
    );
  }

  private loadIncludeDeriveErrorSetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.data.mode !== 'definition') {
      this.includeDeriveErrorInManualCoding = false;
      this.loadCodingIncompleteVariables();
      return;
    }

    this.workspaceSettingsService
      .getIncludeDeriveErrorInManualCoding(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: enabled => {
          this.includeDeriveErrorInManualCoding = enabled;
          this.loadCodingIncompleteVariables();
        },
        error: () => {
          this.includeDeriveErrorInManualCoding = false;
          this.loadCodingIncompleteVariables();
        }
      });
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
        this.bindSelectionPreviewRefresh();
        this.queueDistributionPreviewRefresh();
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
    this.queueDistributionPreviewRefresh();
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
        this.bindSelectionPreviewRefresh();
        this.queueDistributionPreviewRefresh();
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

    if (this.hasExistingDefinitionJobs) {
      this.codingJobForm.get('status')?.disable({ emitEvent: false });
    }

    if (this.isReadOnly) {
      this.codingJobForm.disable({ emitEvent: false });
    }

    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;

    if (originallyAssigned && originallyAssigned.length > 0) {
      this.selectedVariables = this.createVariableSelectionModel([...originallyAssigned]);
      this.bindSelectionPreviewRefresh();
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
    const excludeJobDefinitionId = this.data.mode === 'definition' &&
      this.data.isEdit ?
      this.data.jobDefinitionId :
      undefined;
    this.codingJobBackendService.getCodingIncompleteVariables(
      workspaceId,
      unitNameFilter || undefined,
      trainingRequired,
      this.includeDeriveErrorInManualCoding ? true : undefined,
      excludeJobDefinitionId
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

    const selectedByKey = new Map(this.selectedVariables.selected.map(variable => [
      this.getVariableSelectionKey(variable),
      variable
    ]));
    const assignedByKey = new Map((originallyAssigned ?? []).map(variable => [
      this.getVariableSelectionKey(variable),
      variable
    ]));
    const selectedKeys = new Set([...selectedByKey.keys(), ...assignedByKey.keys()]);
    const currentVariableKeys = new Set(
      this.variables.map(variable => this.getVariableSelectionKey(variable))
    );
    const nextSelectedVariables = this.selectedVariables.selected.filter(
      variable => !currentVariableKeys.has(this.getVariableSelectionKey(variable))
    );

    this.variables.forEach(rowVar => {
      const rowKey = this.getVariableSelectionKey(rowVar);
      const selectedVariable = selectedByKey.get(rowKey);
      const assignedVariable = assignedByKey.get(rowKey);

      rowVar.includeDeriveError =
        this.includeDeriveErrorInManualCoding &&
        (selectedVariable?.includeDeriveError === true || assignedVariable?.includeDeriveError === true);

      if (selectedKeys.has(rowKey)) {
        nextSelectedVariables.push(rowVar);
      }
    });

    this.selectedVariables = this.createVariableSelectionModel(nextSelectedVariables);
    this.bindSelectionPreviewRefresh();
    this.syncSelectionWithAvailability();
    this.queueDistributionPreviewRefresh();
  }

  private createVariableSelectionModel(initiallySelectedValues: Variable[] = []): SelectionModel<Variable> {
    return new SelectionModel<Variable>(
      true,
      initiallySelectedValues,
      true,
      (first, second) => this.getVariableSelectionKey(first) === this.getVariableSelectionKey(second)
    );
  }

  private getVariableSelectionKey(variable: unknown): string {
    if (variable && typeof variable === 'object') {
      const record = variable as Record<string, unknown>;
      const unitName = typeof record.unitName === 'string' ? record.unitName : '';
      const variableIdCandidate = record.variableId ?? record.variableid ?? record.variableID;
      const variableId = typeof variableIdCandidate === 'string' ? variableIdCandidate : '';

      return this.getVariableUsageKey(unitName, variableId);
    }

    return this.getVariableUsageKey('', '');
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
                const savedVariablesByKey = new Map(
                  (savedBundle?.variables || []).map(variable => [
                    this.getVariableUsageKey(variable.unitName, variable.variableId),
                    variable
                  ])
                );
                bundle.variables.forEach(variable => {
                  const savedVariable = savedVariablesByKey.get(
                    this.getVariableUsageKey(variable.unitName, variable.variableId)
                  );
                  variable.includeDeriveError = savedVariable?.includeDeriveError === true;
                });
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
    this.baseAvailableCasesWithDeriveErrorByVariable = new Map(
      variables.map(variable => [
        this.getVariableUsageKey(variable.unitName, variable.variableId),
        variable.availableCasesWithDeriveError ??
          variable.uniqueCasesAfterAggregationWithDeriveError ??
          variable.availableCases ??
          variable.uniqueCasesAfterAggregation ??
          variable.responseCount ??
          0
      ])
    );
  }

  applyJobDefinitionUsage(): void {
    if (!this.variables || this.variables.length === 0) return;

    const regularCasesUsedInDefinitions = new Map<string, number>();
    const totalCasesUsedInDefinitions = new Map<string, number>();
    const makeKey = (u?: string | null, v?: string | null) => this.getVariableUsageKey(u, v);
    const makeKeyFromUsageKey = (variableKey: string): string => {
      const [unitName, variableId] = variableKey.split('::');
      return variableId === undefined ?
        variableKey.trim().toLowerCase() :
        makeKey(unitName, variableId);
    };
    const addUsage = (
      target: Map<string, number>,
      variableKey: string,
      usage: number
    ): void => {
      if (!Number.isFinite(usage) || usage <= 0) {
        return;
      }

      target.set(variableKey, (target.get(variableKey) || 0) + usage);
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

        const plannedUsageByStatus = def.plannedVariableUsageByStatus || {};
        Object.entries(plannedUsageByStatus).forEach(([variableKey, usage]) => {
          const normalizedKey = makeKeyFromUsageKey(variableKey);
          addUsage(regularCasesUsedInDefinitions, normalizedKey, usage.regular);
          addUsage(totalCasesUsedInDefinitions, normalizedKey, usage.total);
        });

        if (Object.keys(plannedUsageByStatus).length === 0) {
          Object.entries(def.plannedVariableUsage || {}).forEach(([variableKey, usage]) => {
            const normalizedKey = makeKeyFromUsageKey(variableKey);
            addUsage(regularCasesUsedInDefinitions, normalizedKey, usage);
            addUsage(totalCasesUsedInDefinitions, normalizedKey, usage);
          });
        }
      });
    }

    // Adjust available cases based on cases used in definitions.
    // Start with backend availability so already created coding jobs remain reserved.
    this.variables.forEach(v => {
      const key = makeKey(v.unitName, v.variableId);
      const regularCasesUsed = regularCasesUsedInDefinitions.get(key) || 0;
      const totalCasesUsed = totalCasesUsedInDefinitions.get(key) || 0;
      const originalAvailable = this.baseAvailableCasesByVariable.get(key) ??
        v.availableCases ??
        v.uniqueCasesAfterAggregation ??
        v.responseCount ??
        0;
      const originalAvailableWithDeriveError =
        this.baseAvailableCasesWithDeriveErrorByVariable.get(key) ??
        v.availableCasesWithDeriveError ??
        originalAvailable;
      v.availableCases = Math.max(0, originalAvailable - regularCasesUsed);
      v.availableCasesWithDeriveError = Math.max(
        0,
        originalAvailableWithDeriveError - totalCasesUsed
      );
    });

    this.syncBundleVariablesWithAvailability();
    this.syncSelectionWithAvailability();
  }

  private getVariableMetrics(variable: Pick<Variable, 'unitName' | 'variableId'>): Pick<Variable, 'responseCount' | 'deriveErrorResponseCount' | 'availableCases' | 'uniqueCasesAfterAggregation' | 'availableCasesWithDeriveError' | 'uniqueCasesAfterAggregationWithDeriveError' | 'casesInJobs' | 'isDerived' | 'coderTrainingRequired'> {
    const matchingVar = this.variables.find(
      v => v.unitName === variable.unitName && v.variableId === variable.variableId
    );

    return {
      responseCount: matchingVar?.responseCount ?? 0,
      deriveErrorResponseCount: matchingVar?.deriveErrorResponseCount ?? 0,
      availableCases: matchingVar?.availableCases,
      uniqueCasesAfterAggregation: matchingVar?.uniqueCasesAfterAggregation,
      availableCasesWithDeriveError: matchingVar?.availableCasesWithDeriveError,
      uniqueCasesAfterAggregationWithDeriveError: matchingVar?.uniqueCasesAfterAggregationWithDeriveError,
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
    const toDeselect = this.selectedVariables.selected.filter(v => this.getVariableSelectableAvailableCases(v) === 0 &&
      !(this.data.isEdit && this.isVariableOriginallyAssigned(v))
    );

    toDeselect.forEach(v => this.selectedVariables.deselect(v));

    if (toDeselect.length > 0) {
      this.queueDistributionPreviewRefresh();
    }
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
        const effectiveTotal = this.getVariableSelectableEffectiveCases(v);
        const availableRaw = this.getVariableSelectableAvailableCases(v);
        const totalRaw = effectiveTotal !== undefined ?
          effectiveTotal :
          availableRaw;

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

    // Allow variables that were originally assigned to the current job definition being edited
    if (this.data.isEdit && this.isVariableOriginallyAssigned(variable)) {
      return false;
    }

    if (this.getVariableSelectableAvailableCases(variable) === 0) {
      return true;
    }

    // Disable variables that are included in currently selected variable bundles
    return this.selectedVariableBundles.selected.some(bundle => bundle.variables.some(bundleVar => bundleVar.unitName === variable.unitName && bundleVar.variableId === variable.variableId
    )
    );
  }

  getVariableDisabledReason(variable: Variable): string {
    if (this.getVariableSelectableAvailableCases(variable) === 0) {
      const effectiveTotal = this.getVariableSelectableEffectiveCases(variable);
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
    if (this.shouldUseDeriveErrorAvailability(variable)) {
      return this.getVariableEffectiveCasesWithDeriveError(variable);
    }

    return this.getVariableRegularEffectiveCases(variable);
  }

  private getVariableRegularEffectiveCases(variable: Variable): number {
    return variable.uniqueCasesAfterAggregation ?? variable.responseCount ?? variable.availableCases ?? 0;
  }

  private getVariableEffectiveCasesWithDeriveError(variable: Variable): number {
    return variable.uniqueCasesAfterAggregationWithDeriveError ??
      Math.max(
        this.getVariableRegularEffectiveCases(variable),
        variable.availableCasesWithDeriveError ?? 0
      );
  }

  private getVariableAvailableCases(variable: Variable): number {
    if (this.shouldUseDeriveErrorAvailability(variable)) {
      return variable.availableCasesWithDeriveError ??
        this.getVariableRegularAvailableCases(variable);
    }

    return this.getVariableRegularAvailableCases(variable);
  }

  private getVariableRegularAvailableCases(variable: Variable): number {
    return variable.availableCases ?? this.getVariableRegularEffectiveCases(variable);
  }

  private getVariableSelectableAvailableCases(variable: Variable): number {
    const regularAvailable = this.getVariableRegularAvailableCases(variable);

    if (this.includeDeriveErrorInManualCoding && this.hasDeriveErrorResponses(variable)) {
      return Math.max(
        regularAvailable,
        variable.availableCasesWithDeriveError ?? regularAvailable
      );
    }

    return regularAvailable;
  }

  private requiresExplicitDeriveErrorSelection(variable: Variable): boolean {
    return this.includeDeriveErrorInManualCoding &&
      this.hasDeriveErrorResponses(variable) &&
      variable.includeDeriveError !== true &&
      this.getVariableRegularAvailableCases(variable) === 0 &&
      (variable.availableCasesWithDeriveError ?? 0) > 0;
  }

  private hasSelectedVariablesRequiringDeriveErrorSelection(): boolean {
    return this.selectedVariables.selected.some(variable => this.requiresExplicitDeriveErrorSelection(variable)) ||
      this.selectedVariableBundles.selected.some(bundle => bundle.variables.some(
        variable => this.requiresExplicitDeriveErrorSelection(variable as Variable)
      ));
  }

  private getVariableSelectableEffectiveCases(variable: Variable): number {
    const regularEffective = this.getVariableRegularEffectiveCases(variable);

    if (this.includeDeriveErrorInManualCoding && this.hasDeriveErrorResponses(variable)) {
      return Math.max(
        regularEffective,
        this.getVariableEffectiveCasesWithDeriveError(variable)
      );
    }

    return regularEffective;
  }

  private shouldUseDeriveErrorAvailability(variable: Variable): boolean {
    return this.includeDeriveErrorInManualCoding &&
      variable.includeDeriveError === true &&
      this.hasDeriveErrorResponses(variable);
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
    if (this.distributionPreviewSummary) {
      return this.distributionPreviewSummary.totalCases;
    }

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

  private getSelectedDistributionVariableCaseCountsAfterLimit(): number[] {
    const items = this.getSelectedDistributionItems();
    const maxCases = this.codingJobForm.getRawValue().maxCodingCases;
    const total = items.reduce((sum, item) => sum + item.remaining, 0);
    const targetCases =
      this.data.mode === 'definition' &&
      typeof maxCases === 'number' &&
      maxCases > 0 ?
        Math.min(total, maxCases) :
        total;
    const selectedCaseCountsByVariable = new Map<string, number>();
    let selectedCases = 0;

    while (selectedCases < targetCases) {
      let progressed = false;

      for (const item of items) {
        if (selectedCases >= targetCases) {
          break;
        }

        const variableKey = this.takeNextEstimatedItemCase(item);
        if (!variableKey) {
          continue;
        }

        selectedCaseCountsByVariable.set(
          variableKey,
          (selectedCaseCountsByVariable.get(variableKey) || 0) + 1
        );
        selectedCases += 1;
        progressed = true;
      }

      if (!progressed) {
        break;
      }
    }

    return Array.from(selectedCaseCountsByVariable.values());
  }

  private takeNextEstimatedItemCase(item: EstimatedDistributionItem): string | undefined {
    if (item.remaining <= 0 || item.groups.length === 0) {
      return undefined;
    }

    for (let attempts = 0; attempts < item.groups.length; attempts += 1) {
      const group = item.groups[item.nextGroupIndex % item.groups.length];
      item.nextGroupIndex = (item.nextGroupIndex + 1) % item.groups.length;

      if (group.remaining <= 0) {
        continue;
      }

      group.remaining -= 1;
      item.remaining -= 1;
      return group.variableKey;
    }

    return undefined;
  }

  private getSelectedDistributionItems(): EstimatedDistributionItem[] {
    const caseOrderingMode = this.codingJobForm.getRawValue().caseOrderingMode || 'continuous';
    const items: EstimatedDistributionItem[] = [];

    this.selectedVariableBundles.selected.forEach(bundle => {
      const itemKey = `bundle:${bundle.id}`;
      const itemCaseOrderingMode = bundle.caseOrderingMode || caseOrderingMode;
      const cases = this.getEstimatedItemCases(
        bundle.variables as Variable[],
        itemCaseOrderingMode,
        itemKey
      );

      if (cases.remaining > 0) {
        items.push(cases);
      }
    });

    this.selectedVariables.selected.forEach(variable => {
      const itemKey = `${variable.unitName}::${variable.variableId}`;
      const cases = this.getEstimatedItemCases([variable], caseOrderingMode, itemKey);

      if (cases.remaining > 0) {
        items.push(cases);
      }
    });

    return items;
  }

  private getEstimatedItemCases(
    variables: Variable[],
    mode: 'continuous' | 'alternating',
    itemKey: string
  ): EstimatedDistributionItem {
    const distributionSeed = this.getDistributionSeed();
    const variableGroups = variables
      .map(variable => ({
        variableKey: this.getVariableUsageKey(variable.unitName, variable.variableId),
        stratumKey: this.getEstimatedResponseStratumKey(variable, mode),
        remaining: this.getVariableAvailableCases(variable)
      }))
      .filter(group => group.remaining > 0)
      .sort((a, b) => {
        const hashA = this.stableHash(`${distributionSeed}:${itemKey}:stratum:${a.stratumKey}`);
        const hashB = this.stableHash(`${distributionSeed}:${itemKey}:stratum:${b.stratumKey}`);
        return hashA - hashB || a.stratumKey.localeCompare(b.stratumKey);
      });

    return {
      groups: variableGroups.map(group => ({
        variableKey: group.variableKey,
        remaining: group.remaining
      })),
      nextGroupIndex: 0,
      remaining: variableGroups.reduce((sum, group) => sum + group.remaining, 0)
    };
  }

  private getDistributionSeed(): string {
    const existingSeed = this.data.codingJob?.distributionSeed;
    if (existingSeed !== undefined && existingSeed !== null && existingSeed !== '') {
      return String(existingSeed);
    }

    if (this.data.jobDefinitionId !== undefined && this.data.jobDefinitionId !== null) {
      return `job-definition:${this.data.jobDefinitionId}`;
    }

    if (!this.definitionDistributionSeed) {
      this.definitionDistributionSeed =
        `job-definition:${this.appService.selectedWorkspaceId}:${this.createDistributionSeedId()}`;
    }

    return this.definitionDistributionSeed;
  }

  private createDistributionSeedId(): string {
    return globalThis.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  private getEstimatedResponseStratumKey(
    variable: Pick<Variable, 'unitName' | 'variableId'>,
    mode: 'continuous' | 'alternating'
  ): string {
    if (mode === 'alternating') {
      return `::::${variable.unitName}::${variable.variableId}`;
    }

    return `${variable.unitName}::${variable.variableId}::::`;
  }

  private stableHash(value: string): number {
    let hash = 0;

    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) % 4294967291;
    }

    return hash;
  }

  private getDoubleCodedCasesForVariable(totalCases: number): number {
    const { doubleCodingAbsolute, doubleCodingPercentage } = this.codingJobForm.getRawValue();

    if (this.doubleCodingMode === 'absolute') {
      return Math.min(doubleCodingAbsolute || 0, totalCases);
    }

    return Math.min(
      Math.ceil(((doubleCodingPercentage || 0) / 100) * totalCases),
      totalCases
    );
  }

  getTotalDoubleCodedCases(): number {
    if (this.distributionPreviewSummary) {
      return this.distributionPreviewSummary.doubleCodedCases;
    }

    return this.getSelectedDistributionVariableCaseCountsAfterLimit()
      .reduce(
        (sum, totalCases) => sum + this.getDoubleCodedCasesForVariable(totalCases),
        0
      );
  }

  getTotalCodingTasks(): number {
    if (this.distributionPreviewSummary) {
      return this.distributionPreviewSummary.totalCodingTasks;
    }

    return this.getTotalCodingCases() + this.getTotalDoubleCodedCases();
  }

  getTotalTimeInSeconds(): number {
    const durationPerCase = this.codingJobForm.getRawValue().durationSeconds || 1;
    return this.getTotalCodingTasks() * durationPerCase;
  }

  getTimePerCoderInSeconds(): number {
    if (this.distributionPreviewSummary?.tasksPerCoder) {
      const durationPerCase = this.codingJobForm.getRawValue().durationSeconds || 1;
      const taskCounts = Object.values(this.distributionPreviewSummary.tasksPerCoder)
        .map(tasks => Number(tasks))
        .filter(tasks => Number.isFinite(tasks));

      if (taskCounts.length > 0) {
        return Math.max(...taskCounts) * durationPerCase;
      }
    }

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
    const effectiveTotal = this.getVariableEffectiveCases(variable);
    const availableCases = this.getVariableAvailableCases(variable);
    if (effectiveTotal === undefined) {
      return '';
    }

    const availabilityPercentage = (availableCases / effectiveTotal) * 100;

    if (availabilityPercentage === 100) {
      return 'availability-full';
    } if (availabilityPercentage > 0) {
      return 'availability-partial';
    }
    return 'availability-none';
  }

  getAvailabilityText(variable: Variable): string {
    const effectiveTotal = this.getVariableEffectiveCases(variable);
    const availableCases = this.getVariableAvailableCases(variable);
    if (effectiveTotal === undefined) {
      return `${effectiveTotal || 0}`;
    }

    return `${availableCases}/${effectiveTotal}`;
  }

  isAllSelected(): boolean {
    const selectableRows = this.getMasterToggleRows();
    const numSelected = selectableRows.filter(v => this.selectedVariables.isSelected(v)).length;
    const numRows = selectableRows.length;
    return numSelected === numRows && numRows > 0;
  }

  masterToggle(): void {
    if (this.isReadOnly) {
      return;
    }

    const selectableRows = this.getMasterToggleRows();
    if (this.isAllSelected()) {
      selectableRows.forEach(row => this.selectedVariables.deselect(row));
    } else {
      selectableRows.forEach(row => this.selectedVariables.select(row));
    }
  }

  private getMasterToggleRows(): Variable[] {
    return this.dataSource.data.filter(variable => (
      !this.isVariableDisabled(variable) &&
      !this.requiresExplicitDeriveErrorSelection(variable)
    ));
  }

  isDeriveErrorIncluded(variable: Variable): boolean {
    return variable.includeDeriveError === true;
  }

  hasDeriveErrorResponses(variable: Variable): boolean {
    return this.includeDeriveErrorInManualCoding &&
      ((variable.deriveErrorResponseCount ?? 0) > 0 || variable.includeDeriveError === true);
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
    this.queueDistributionPreviewRefresh();
  }

  isBundleVariableDeriveErrorIncluded(variable: Variable): boolean {
    return variable.includeDeriveError === true;
  }

  setBundleVariableDeriveErrorIncluded(
    bundle: VariableBundle,
    variable: Variable,
    includeDeriveError: boolean
  ): void {
    if (this.isReadOnly || this.data.mode !== 'definition' || !this.hasDeriveErrorResponses(variable)) {
      return;
    }

    const bundleVariable = bundle.variables.find(currentVariable => (
      currentVariable.unitName === variable.unitName &&
      currentVariable.variableId === variable.variableId
    ));
    if (bundleVariable) {
      bundleVariable.includeDeriveError = includeDeriveError;
    }
    variable.includeDeriveError = includeDeriveError;
    this.queueDistributionPreviewRefresh();
  }

  getBundlePreviewVariables(bundle: VariableBundle): Variable[] {
    if (this.selectedVariableBundles.isSelected(bundle)) {
      return bundle.variables;
    }

    return bundle.variables.slice(0, 3);
  }

  private getSelectedDefinitionVariables(): Variable[] {
    return this.selectedVariables.selected.map(variable => ({
      unitName: variable.unitName,
      variableId: variable.variableId,
      ...(this.includeDeriveErrorInManualCoding &&
        variable.includeDeriveError === true &&
        this.hasDeriveErrorResponses(variable) ? { includeDeriveError: true } : {})
    }));
  }

  private getSelectedDefinitionVariableBundles(): VariableBundle[] {
    return this.selectedVariableBundles.selected.map(bundle => ({
      id: bundle.id,
      name: bundle.name,
      caseOrderingMode: bundle.caseOrderingMode,
      variables: bundle.variables.map(variable => ({
        unitName: variable.unitName,
        variableId: variable.variableId,
        ...(this.includeDeriveErrorInManualCoding &&
          variable.includeDeriveError === true &&
          this.hasDeriveErrorResponses(variable as Variable) ? { includeDeriveError: true } : {})
      }))
    })) as VariableBundle[];
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

      if (this.hasSelectedVariablesRequiringDeriveErrorSelection()) {
        this.snackBar.open(
          this.translateService.instant('coding-job-definition-dialog.validation.derive-error-required'),
          this.translateService.instant('common.close'),
          { duration: 5000 }
        );
        return;
      }

      if (this.data.isEdit && this.data.jobDefinitionId) {
        await this.submitDefinitionUpdate();
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
    this.queueDistributionPreviewRefresh();
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
    this.queueDistributionPreviewRefresh();
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
      assignedVariableBundles: this.getSelectedDefinitionVariableBundles(),
      assignedCoders: selectedCoderIds,
      assignedCoderConfigs: selectedCoderConfigs,
      durationSeconds: this.sanitizeNumber(this.codingJobForm.value.durationSeconds),
      maxCodingCases: this.sanitizeNumber(this.codingJobForm.value.maxCodingCases),
      doubleCodingAbsolute: this.sanitizeNumber(this.codingJobForm.value.doubleCodingAbsolute),
      doubleCodingPercentage: this.sanitizeNumber(this.codingJobForm.value.doubleCodingPercentage),
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode,
      distributionSeed: this.getDistributionSeed(),
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

  private buildDefinitionUpdatePayload(): Partial<JobDefinition> {
    const selectedCoderIds = this.selectedCoders.selected.map(c => c.id);
    const selectedCoderConfigs = this.getSelectedCoderConfigs();

    const jobDefinition: Partial<JobDefinition> = {
      assignedVariables: this.getSelectedDefinitionVariables(),
      assignedVariableBundles: this.getSelectedDefinitionVariableBundles(),
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

    const statusControl = this.codingJobForm.get('status');
    if (statusControl?.enabled) {
      jobDefinition.status = statusControl.value;
    }

    return jobDefinition;
  }

  private buildExistingJobsDirectUpdatePayload(
    jobDefinition: Partial<JobDefinition>
  ): Partial<JobDefinition> {
    return {
      durationSeconds: jobDefinition.durationSeconds,
      showScore: jobDefinition.showScore,
      allowComments: jobDefinition.allowComments,
      suppressGeneralInstructions: jobDefinition.suppressGeneralInstructions
    };
  }

  private normalizeVariablesForComparison(variables?: Variable[]): Array<{
    unitName: string;
    variableId: string;
    includeDeriveError: boolean;
  }> {
    return (variables || [])
      .map(variable => ({
        unitName: variable.unitName || '',
        variableId: variable.variableId || '',
        includeDeriveError: variable.includeDeriveError === true
      }))
      .sort((left, right) => `${left.unitName}::${left.variableId}`
        .localeCompare(`${right.unitName}::${right.variableId}`));
  }

  private normalizeBundlesForComparison(bundles?: VariableBundle[]): Array<{
    id: number;
    caseOrderingMode?: 'continuous' | 'alternating';
    variables: Array<{
      unitName: string;
      variableId: string;
      includeDeriveError: boolean;
    }>;
  }> {
    return (bundles || [])
      .map(bundle => ({
        id: Number(bundle.id),
        caseOrderingMode: bundle.caseOrderingMode,
        variables: this.normalizeVariablesForComparison(
          (bundle.variables || []).filter(variable => variable.includeDeriveError === true)
        )
      }))
      .sort((left, right) => left.id - right.id);
  }

  private normalizeCoderIdsForComparison(coderIds?: number[]): number[] {
    return [...(coderIds || [])].sort((left, right) => left - right);
  }

  private normalizeCoderConfigsForComparison(
    coderConfigs?: JobDefinitionCoderConfig[],
    fallbackCoderIds?: number[]
  ): JobDefinitionCoderConfig[] {
    const configs = coderConfigs && coderConfigs.length > 0 ?
      coderConfigs :
      (fallbackCoderIds || []).map(coderId => ({
        coderId,
        capacityPercent: this.defaultCoderCapacityPercent
      }));

    return configs
      .map(config => ({
        coderId: Number(config.coderId),
        capacityPercent: this.normalizeCoderCapacityPercent(config.capacityPercent)
      }))
      .sort((left, right) => left.coderId - right.coderId);
  }

  private valuesDiffer(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) !== JSON.stringify(right);
  }

  private normalizedOptionalNumber(value: unknown): number | undefined {
    return this.sanitizeNumber(value);
  }

  private normalizedDoubleCodingNumber(value: unknown): number {
    return this.sanitizeNumber(value) ?? 0;
  }

  private hasRefreshRelevantDefinitionChanges(
    jobDefinition: Partial<JobDefinition>
  ): boolean {
    const existingDefinition = this.data.codingJob;
    if (!existingDefinition) {
      return false;
    }

    const existingVariables = existingDefinition.assignedVariables ??
      existingDefinition.variables;
    const existingBundles = existingDefinition.assignedVariableBundles ??
      existingDefinition.variableBundles;
    const existingMissingProfileId =
      existingDefinition.missingsProfileId ??
      existingDefinition.missings_profile_id;

    return [
      this.valuesDiffer(
        this.normalizeVariablesForComparison(jobDefinition.assignedVariables),
        this.normalizeVariablesForComparison(existingVariables)
      ),
      this.valuesDiffer(
        this.normalizeBundlesForComparison(jobDefinition.assignedVariableBundles),
        this.normalizeBundlesForComparison(existingBundles)
      ),
      this.valuesDiffer(
        this.normalizeCoderIdsForComparison(jobDefinition.assignedCoders),
        this.normalizeCoderIdsForComparison(existingDefinition.assignedCoders)
      ),
      this.valuesDiffer(
        this.normalizeCoderConfigsForComparison(
          jobDefinition.assignedCoderConfigs,
          jobDefinition.assignedCoders
        ),
        this.normalizeCoderConfigsForComparison(
          existingDefinition.assignedCoderConfigs,
          existingDefinition.assignedCoders
        )
      ),
      this.normalizedOptionalNumber(jobDefinition.missingsProfileId) !==
        this.normalizedOptionalNumber(existingMissingProfileId),
      this.normalizedOptionalNumber(jobDefinition.maxCodingCases) !==
        this.normalizedOptionalNumber(existingDefinition.maxCodingCases),
      this.normalizedDoubleCodingNumber(jobDefinition.doubleCodingAbsolute) !==
        this.normalizedDoubleCodingNumber(existingDefinition.doubleCodingAbsolute),
      this.normalizedDoubleCodingNumber(jobDefinition.doubleCodingPercentage) !==
        this.normalizedDoubleCodingNumber(existingDefinition.doubleCodingPercentage),
      (jobDefinition.caseOrderingMode || 'continuous') !==
        (existingDefinition.caseOrderingMode || 'continuous')
    ].some(Boolean);
  }

  private async previewAndApplyDefinitionUpdateRefresh(
    workspaceId: number,
    jobDefinitionId: number,
    jobDefinition: Partial<JobDefinition>
  ): Promise<void> {
    try {
      const preview = await firstValueFrom(
        this.codingJobBackendService.previewJobDefinitionUpdateRefresh(
          workspaceId,
          jobDefinitionId,
          jobDefinition
        )
      );
      const dialogRef = this.matDialog.open(JobDefinitionRefreshDialogComponent, {
        width: '640px',
        maxWidth: '95vw',
        data: {
          definitionId: jobDefinitionId,
          preview,
          mode: 'update'
        },
        autoFocus: false
      });
      const confirmed = await firstValueFrom(dialogRef.afterClosed());

      if (!confirmed) {
        this.isSaving = false;
        return;
      }

      const result = await firstValueFrom(
        this.codingJobBackendService.applyJobDefinitionUpdateRefresh(
          workspaceId,
          jobDefinitionId,
          jobDefinition
        )
      );

      this.isSaving = false;
      this.snackBar.open(
        this.translateService.instant(
          'coding-job-definition-dialog.snackbars.definition-update-refresh-applied',
          { count: result.jobsCreated }
        ),
        this.translateService.instant('common.close'),
        { duration: 4000 }
      );
      this.dialogRef.close(result);
    } catch (error) {
      this.isSaving = false;
      const message = this.getErrorMessage(error);
      this.snackBar.open(
        this.translateService.instant(
          'coding-job-definition-dialog.snackbars.update-refresh-failed',
          { error: message }
        ),
        this.translateService.instant('common.close'),
        { duration: 5000 }
      );
    }
  }

  private async submitDefinitionUpdate(): Promise<void> {
    this.isSaving = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const jobDefinition = this.buildDefinitionUpdatePayload();

    if (
      this.hasExistingDefinitionJobs &&
      this.hasRefreshRelevantDefinitionChanges(jobDefinition)
    ) {
      await this.previewAndApplyDefinitionUpdateRefresh(
        workspaceId,
        this.data.jobDefinitionId!,
        jobDefinition
      );
      return;
    }

    const directUpdatePayload = this.hasExistingDefinitionJobs ?
      this.buildExistingJobsDirectUpdatePayload(jobDefinition) :
      jobDefinition;

    this.codingJobBackendService.updateJobDefinition(workspaceId, this.data.jobDefinitionId!, directUpdatePayload).subscribe({
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

    if (this.hasSelectedVariablesRequiringDeriveErrorSelection()) {
      this.snackBar.open(
        this.translateService.instant('coding-job-definition-dialog.validation.derive-error-required'),
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
      assignedVariableBundles: this.getSelectedDefinitionVariableBundles(),
      assignedCoders: selectedCoderIds,
      assignedCoderConfigs: selectedCoderConfigs,
      durationSeconds: this.sanitizeNumber(this.codingJobForm.value.durationSeconds),
      maxCodingCases: this.sanitizeNumber(this.codingJobForm.value.maxCodingCases),
      doubleCodingAbsolute: this.sanitizeNumber(this.codingJobForm.value.doubleCodingAbsolute),
      doubleCodingPercentage: this.sanitizeNumber(this.codingJobForm.value.doubleCodingPercentage),
      caseOrderingMode: this.codingJobForm.value.caseOrderingMode,
      distributionSeed: this.getDistributionSeed(),
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
