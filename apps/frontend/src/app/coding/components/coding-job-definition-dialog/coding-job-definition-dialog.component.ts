import {
  ChangeDetectorRef, Component, OnInit, OnDestroy, computed, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTableDataSource } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { SelectionChange, SelectionModel } from '@angular/cdk/collections';
import {
  catchError, defer, EMPTY, finalize, firstValueFrom, merge, Observable, of, Subject, Subscription,
  switchMap, takeUntil, tap, timer
} from 'rxjs';
import { JobCoderCapacityComponent } from './job-coder-capacity.component';
import { JobVariableSelectionComponent, JobVariableFilters, JobVariableRow } from './job-variable-selection.component';
import { JobBundleSelectionComponent, JobBundleRow } from './job-bundle-selection.component';
import { JobDistributionPreviewComponent } from './job-distribution-preview.component';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import {
  CodingWorkload, CodingWorkloadInput, DistributionPreviewSummary, WorkloadVariable
} from './coding-workload';
import { activateOnKeyboard } from '../../../shared/utils/keyboard-activation.util';
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
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { JobDefinitionRefreshDialogComponent } from '../coding-job-definitions/job-definition-refresh-dialog.component';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { CodingJobForm, createCodingJobForm } from './coding-job-definition-form';

import {
  CODING_JOB_DEFINITION_RECOVERY_KEY, CodingJobDefinitionDialogData, CodingJobDefinitionRecoveryDraft,
  CodingJobDefinitionRecoveryVariable, CodingJobDefinitionRecoveryBundle, CreationResults, JobDefinition
} from './coding-job-definition.models';
import { CodingJobDefinitionRules } from './coding-job-definition-rules';
import { CodingJobDefinitionPersistence } from './coding-job-definition-persistence.service';

export {
  CODING_JOB_DEFINITION_RECOVERY_KEY, CodingJobDefinitionDialogData, CodingJobDefinitionRecoveryDraft, JobDefinition
} from './coding-job-definition.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-job-definition-dialog',
  templateUrl: './coding-job-definition-dialog.component.html',
  styleUrls: ['./coding-job-definition-dialog.component.scss'],
  standalone: true,
  providers: [CodingJobDefinitionPersistence],
  imports: [
    JobDistributionPreviewComponent,
    JobBundleSelectionComponent,
    JobVariableSelectionComponent,
    JobCoderCapacityComponent,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatIconModule,
    MatCheckboxModule,
    MatDividerModule,
    MatTabsModule,
    MatRadioModule,
    TranslateModule]
})
export class CodingJobDefinitionDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject<MatDialogRef<CodingJobDefinitionDialogComponent>>(MatDialogRef);
  data = inject<CodingJobDefinitionDialogData>(MAT_DIALOG_DATA);

  protected readonly onActionKeydown = activateOnKeyboard;

  private readonly destroyRef = inject(DestroyRef);

  private changeDetectorRef = inject(ChangeDetectorRef);
  private codingJobBackendService = inject(CodingJobBackendService);
  private distributedCodingService = inject(DistributedCodingService);
  private appService = inject(AppService);
  private coderService = inject(CoderService);
  private snackBar = inject(MatSnackBar);
  private readonly codingJobService = inject(CodingJobService);
  private readonly persistence = inject(CodingJobDefinitionPersistence);
  private readonly definitionRules = new CodingJobDefinitionRules();
  private testPersonCodingService = inject(TestPersonCodingService);
  private missingsProfileService = inject(MissingsProfileService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private matDialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  private sessionRecoveryService = inject(SessionRecoveryService);

  private destroy$ = new Subject<void>();
  private unregisterRecoveryProvider?: () => void;
  private hasRestoredRecoveryDraft = false;
  private variablesLoadedForRecovery = false;
  private variableBundlesLoadedForRecovery = false;
  private availableCodersLoadedForRecovery = false;
  private existingJobDefinitionsLoadedForRecovery = false;
  private missingsProfilesLoadedForRecovery = false;

  codingJobForm!: CodingJobForm;
  readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);

  get isReadOnly(): boolean {
    return this.data.readOnly === true;
  }

  get hasExistingDefinitionJobs(): boolean {
    return this.data.mode === 'definition' &&
      this.data.isEdit &&
      (this.data.createdJobsCount ?? 0) > 0;
  }

  // Double coding configuration
  readonly doubleCodingMode = signal<'absolute' | 'percentage'>('absolute');

  // Variables
  readonly variables = signal<Variable[]>([]);
  readonly selectedVariables = signal(this.createVariableSelectionModel());
  private readonly variableSelectionChanges = new Subject<SelectionChange<Variable>>();
  private readonly variableSelectionChange = toSignal(this.variableSelectionChanges, { initialValue: null });
  // SelectionModel changes its collection in place. Bridge those changes before
  // reading the collection lazily so computed consumers and templates stay current.
  readonly selectedVariableValues = computed(() => {
    this.variableSelectionChange();
    return [...this.selectedVariables().selected];
  });

  displayedColumns: string[] = ['select', 'unitName', 'variableId'];
  dataSource = new MatTableDataSource<Variable>([]);

  // Coders
  readonly coders = signal<Coder[]>([]);
  readonly isLoadingCoders = signal(false);
  readonly availableCoders = signal<Coder[]>([]);
  selectedCoders = this.createCoderSelectionModel();
  protected readonly isLoadingAvailableCoders = signal(false);

  // Variable bundles
  readonly variableBundles = signal<VariableBundle[]>([]);
  selectedVariableBundles = this.createBundleSelectionModel();
  protected bundlesDataSource = new MatTableDataSource<VariableBundle>([]);
  protected readonly isLoadingBundles = signal(false);

  // Variable analysis items
  protected readonly isLoadingVariableAnalysis = signal(false);
  readonly totalVariableAnalysisRecords = signal(0);

  // Missing profiles
  protected readonly missingsProfiles = signal<{
    label: string;
    id: number;
  }[]>([{ id: 0, label: 'IQB-Standard' }]);

  protected readonly isLoadingMissingsProfiles = signal(false);

  // Filters
  readonly unitNameFilter = signal('');
  readonly variableIdFilter = signal('');
  readonly bundleNameFilter = signal('');
  readonly availabilityFilter = signal<'all' | 'full' | 'partial' | 'none'>('all');
  readonly trainingRequiredFilter = signal<'all' | 'true' | 'false'>('all');

  private disabledVariableKeys = new Set<string>();
  private baseAvailableCasesByVariable = new Map<string, number>();
  private baseAvailableCasesWithDeriveErrorByVariable = new Map<string, number>();
  private definitionDistributionSeed?: string;
  private readonly distributionPreviewSummary = signal<DistributionPreviewSummary | null>(null);
  // Form and SelectionModel events invalidate one shared, memoized calculation.
  private readonly workloadRevision = signal(0);
  private readonly durationRevision = signal(0);
  private variableLoadRequestId = 0;
  private readonly variableLoadRequests = new Subject<{
    workspaceId: number;
    unitName?: string;
    trainingRequired?: boolean;
    includeDeriveError?: boolean;
    preloadedVariables?: Variable[];
  }>();

  private readonly estimatedVariableCaseCounts = computed(() => {
    this.workloadRevision();
    return this.getSelectedDistributionVariableCaseCountsAfterLimit();
  });

  protected readonly workloadSummary = computed(() => {
    this.workloadRevision();
    this.durationRevision();
    return new CodingWorkload(this.workloadInput(this.distributionPreviewSummary())).summarize(() => this.estimatedVariableCaseCounts());
  });

  private readonly distributionPreviewRefresh$ = new Subject<void>();
  private readonly distributionPreviewDebounceMs = 300;
  private selectionPreviewSubscription = new Subscription();
  readonly existingJobDefinitions = signal<JobDefinition[]>([]);
  protected readonly manualCodingScopeSummary = signal<ManualCodingScopeSummary | null>(null);
  readonly includeDeriveErrorInManualCoding = signal(false);

  protected get variableSelectionFilters(): JobVariableFilters {
    return {
      unitName: this.unitNameFilter(),
      variableId: this.variableIdFilter(),
      trainingRequired: this.trainingRequiredFilter(),
      availability: this.availabilityFilter()
    };
  }

  protected updateVariableSelectionFilters(filters: Partial<JobVariableFilters>): void {
    if (filters.unitName !== undefined) this.unitNameFilter.set(filters.unitName);
    if (filters.variableId !== undefined) this.variableIdFilter.set(filters.variableId);
    if (filters.trainingRequired !== undefined) this.trainingRequiredFilter.set(filters.trainingRequired);
  }

  protected get variableSelectionRows(): JobVariableRow[] {
    return this.dataSource.data.map(variable => ({
      variable,
      selected: this.isVariableSelected(variable),
      disabled: this.isVariableDisabled(variable),
      disabledReason: this.getVariableDisabledReason(variable),
      availabilityClass: this.getAvailabilityClass(variable),
      availabilityText: this.getAvailabilityText(variable),
      hasDeriveError: this.hasDeriveErrorResponses(variable),
      includeDeriveError: this.isDeriveErrorIncluded(variable)
    }));
  }

  protected get bundleSelectionRows(): JobBundleRow[] {
    return this.bundlesDataSource.filteredData.map(bundle => ({
      bundle,
      selected: this.selectedVariableBundles.isSelected(bundle),
      variables: this.getBundlePreviewVariables(bundle).map(variable => ({
        variable,
        hasDeriveError: this.hasDeriveErrorResponses(variable),
        includeDeriveError: this.isBundleVariableDeriveErrorIncluded(variable)
      }))
    }));
  }

  constructor() {
    // A new filter replaces both queries, including an outstanding scope summary.
    this.variableLoadRequests.pipe(
      switchMap(request => defer(() => {
        this.variableLoadRequestId += 1;
        const requestId = this.variableLoadRequestId;
        this.isLoadingVariableAnalysis.set(true);
        if (!request.workspaceId) {
          this.manualCodingScopeSummary.set(null);
          this.finishVariableLoad();
          this.isLoadingVariableAnalysis.set(false);
          return EMPTY;
        }
        const variables: Observable<Variable[]> = request.preloadedVariables ? of(request.preloadedVariables) :
          defer(() => this.codingJobBackendService.getCodingIncompleteVariables(
            request.workspaceId,
            request.unitName,
            request.trainingRequired,
            request.includeDeriveError,
            this.data.mode === 'definition' && this.data.isEdit ? this.data.jobDefinitionId : undefined
          ));
        const summary = defer(() => this.codingJobBackendService.getManualCodingScopeSummary(
          request.workspaceId, request.unitName, request.trainingRequired
        )).pipe(
          tap(value => this.manualCodingScopeSummary.set(value)),
          catchError(() => { this.manualCodingScopeSummary.set(null); return EMPTY; })
        );
        return merge(summary, variables.pipe(
          tap(value => {
            this.variables.set(value);
            this.snapshotBaseAvailability(value);
            this.applyJobDefinitionUsage();
            this.applyAvailabilityFilter();
            this.processVariableSelection();
            this.totalVariableAnalysisRecords.set(value.length);
            this.isLoadingVariableAnalysis.set(false);
            this.finishVariableLoad();
          }),
          catchError(() => { this.finishVariableLoad(); return EMPTY; }),
          finalize(() => {
            // Recovery can start another load before synchronous preloaded rows finish.
            if (requestId === this.variableLoadRequestId) this.isLoadingVariableAnalysis.set(false);
          })
        )).pipe(takeUntilWorkspaceChanged(this.appService, request.workspaceId));
      })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private finishVariableLoad(): void {
    this.variablesLoadedForRecovery = true;
    this.restoreDefinitionRecoveryDraft();
  }

  ngOnInit(): void {
    if (this.data.codingJob?.doubleCodingAbsolute !== null && this.data.codingJob?.doubleCodingAbsolute !== undefined && this.data.codingJob.doubleCodingAbsolute > 0) {
      this.doubleCodingMode.set('absolute');
    } else if (this.data.codingJob?.doubleCodingPercentage !== null && this.data.codingJob?.doubleCodingPercentage !== undefined && this.data.codingJob.doubleCodingPercentage > 0) {
      this.doubleCodingMode.set('percentage');
    } else {
      this.doubleCodingMode.set('absolute'); // default
    }

    this.initForm();
    this.registerRecoveryProvider();
    this.sessionRecoveryService.restore$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.restoreDefinitionRecoveryDraft());
    this.bindSelectionPreviewRefresh();
    this.codingJobForm.controls.durationSeconds.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.durationRevision.update(revision => revision + 1));
    merge(
      this.codingJobForm.get('doubleCodingAbsolute')!.valueChanges,
      this.codingJobForm.get('doubleCodingPercentage')!.valueChanges,
      this.codingJobForm.get('caseOrderingMode')!.valueChanges,
      this.codingJobForm.get('maxCodingCases')!.valueChanges
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.queueDistributionPreviewRefresh());
    this.distributionPreviewRefresh$
      .pipe(
        switchMap(() => timer(this.distributionPreviewDebounceMs).pipe(
          switchMap(() => this.loadDistributionPreview())
        )),
        takeUntil(this.destroy$)
      )
      .subscribe(preview => {
        this.distributionPreviewSummary.set(preview ? this.buildDistributionPreviewSummary(preview) : null);
        this.changeDetectorRef.markForCheck();
      });
    this.loadIncludeDeriveErrorSetting();
    this.loadVariableBundles();
    this.loadAvailableCoders();
    if (this.data.isEdit && this.data.mode === 'job' && this.data.codingJob?.id) {
      this.loadCoders(this.data.codingJob.id);
    }

    if (this.data.mode === 'definition') {
      this.loadExistingJobDefinitions();
      this.loadMissingsProfiles();
    } else {
      this.existingJobDefinitionsLoadedForRecovery = true;
      this.missingsProfilesLoadedForRecovery = true;
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
        this.loadCodingIncompleteVariables(this.unitNameFilter() || undefined, true);
      });
  }

  ngOnDestroy(): void {
    this.unregisterRecoveryProvider?.();
    this.unregisterRecoveryProvider = undefined;
    this.selectionPreviewSubscription.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private registerRecoveryProvider(): void {
    if (this.data.mode !== 'definition') {
      return;
    }

    this.unregisterRecoveryProvider = this.sessionRecoveryService.registerProvider({
      key: CODING_JOB_DEFINITION_RECOVERY_KEY,
      capture: () => this.createDefinitionRecoveryDraft()
    });
  }

  private createDefinitionRecoveryDraft(): CodingJobDefinitionRecoveryDraft | null {
    if (
      this.data.mode !== 'definition' ||
      this.isReadOnly ||
      !this.codingJobForm ||
      !this.hasRecoverableDefinitionState()
    ) {
      return null;
    }

    return {
      workspaceId: this.appService.selectedWorkspaceId,
      mode: 'definition',
      isEdit: this.data.isEdit,
      jobDefinitionId: this.data.jobDefinitionId,
      codingJob: this.data.codingJob ? { ...this.data.codingJob } : undefined,
      readOnly: this.data.readOnly,
      createdJobsCount: this.data.createdJobsCount,
      formValue: this.codingJobForm.getRawValue(),
      doubleCodingMode: this.doubleCodingMode(),
      selectedVariables: this.getSelectedDefinitionVariables(),
      selectedVariableBundles: this.getSelectedDefinitionVariableBundles().map(bundle => ({
        id: bundle.id,
        name: bundle.name,
        caseOrderingMode: bundle.caseOrderingMode,
        variables: bundle.variables.map(variable => ({
          unitName: variable.unitName,
          variableId: variable.variableId,
          ...(variable.includeDeriveError === true ? { includeDeriveError: true } : {})
        }))
      })),
      selectedCoderConfigs: this.getSelectedCoderConfigs(),
      unitNameFilter: this.unitNameFilter(),
      variableIdFilter: this.variableIdFilter(),
      bundleNameFilter: this.bundleNameFilter(),
      availabilityFilter: this.availabilityFilter(),
      trainingRequiredFilter: this.trainingRequiredFilter(),
      distributionSeed: this.getDistributionSeed()
    };
  }

  private hasRecoverableDefinitionState(): boolean {
    if (this.data.isEdit) {
      return true;
    }

    const formValue = this.codingJobForm.getRawValue();
    const hasFormChanges = this.codingJobForm.dirty && (
      (formValue.name?.trim().length ?? 0) > 0 ||
      (formValue.description?.trim().length ?? 0) > 0 ||
      formValue.durationSeconds !== 1 ||
      formValue.maxCodingCases !== null ||
      (formValue.doubleCodingAbsolute ?? 0) !== 0 ||
      (formValue.doubleCodingPercentage ?? 0) !== 0 ||
      formValue.caseOrderingMode !== 'continuous' ||
      formValue.showScore !== false ||
      formValue.allowComments !== true ||
      formValue.suppressGeneralInstructions === true ||
      (formValue.missingsProfileId ?? 0) !== 0
    );

    return this.selectedVariableValues().length > 0 ||
      this.selectedVariableBundles.selected.length > 0 ||
      this.selectedCoders.selected.length > 0 ||
      this.unitNameFilter().trim().length > 0 ||
      this.variableIdFilter().trim().length > 0 ||
      this.bundleNameFilter().trim().length > 0 ||
      this.availabilityFilter() !== 'all' ||
      this.trainingRequiredFilter() !== 'all' ||
      hasFormChanges;
  }

  private restoreDefinitionRecoveryDraft(): boolean {
    if (this.hasRestoredRecoveryDraft || !this.areDefinitionRecoveryDependenciesLoaded()) {
      return false;
    }

    const draft = this.sessionRecoveryService.peekDraft<CodingJobDefinitionRecoveryDraft>(
      CODING_JOB_DEFINITION_RECOVERY_KEY
    );
    if (!draft || !this.isDefinitionRecoveryDraftForCurrentContext(draft)) {
      return false;
    }

    this.hasRestoredRecoveryDraft = true;
    this.applyDefinitionRecoveryDraft(draft);
    return true;
  }

  private areDefinitionRecoveryDependenciesLoaded(): boolean {
    return this.variablesLoadedForRecovery &&
      this.variableBundlesLoadedForRecovery &&
      this.availableCodersLoadedForRecovery &&
      this.existingJobDefinitionsLoadedForRecovery &&
      this.missingsProfilesLoadedForRecovery;
  }

  private isDefinitionRecoveryDraftForCurrentContext(
    draft: CodingJobDefinitionRecoveryDraft
  ): boolean {
    if (this.data.mode !== 'definition' || this.isReadOnly) {
      return false;
    }
    if (draft.workspaceId !== this.appService.selectedWorkspaceId) {
      return false;
    }
    if (draft.mode !== this.data.mode || draft.isEdit !== this.data.isEdit) {
      return false;
    }
    if (draft.isEdit) {
      return draft.jobDefinitionId === this.data.jobDefinitionId;
    }

    return true;
  }

  private applyDefinitionRecoveryDraft(draft: CodingJobDefinitionRecoveryDraft): void {
    this.codingJobForm.patchValue(draft.formValue, { emitEvent: false });
    this.doubleCodingMode.set(draft.doubleCodingMode);
    this.definitionDistributionSeed = draft.distributionSeed;
    this.unitNameFilter.set(draft.unitNameFilter);
    this.variableIdFilter.set(draft.variableIdFilter);
    this.bundleNameFilter.set(draft.bundleNameFilter);
    this.availabilityFilter.set(draft.availabilityFilter);
    this.trainingRequiredFilter.set(draft.trainingRequiredFilter);

    this.restoreRecoveredCoders(draft.selectedCoderConfigs);
    this.selectedVariables.set(this.createVariableSelectionModel(draft.selectedVariables.map(variable => this.findRecoveredVariable(variable))));
    this.selectedVariableBundles = this.createBundleSelectionModel(
      draft.selectedVariableBundles.map(bundle => this.findRecoveredBundle(bundle))
    );
    this.bindSelectionPreviewRefresh();
    this.applyBundleFilter();
    if (this.unitNameFilter().trim().length > 0 || this.trainingRequiredFilter() !== 'all') {
      this.loadCodingIncompleteVariables(this.unitNameFilter() || undefined, true);
    } else {
      this.applyAvailabilityFilter();
    }
    this.queueDistributionPreviewRefresh();
  }

  private restoreRecoveredCoders(coderConfigs: JobDefinitionCoderConfig[]): void {
    const configByCoderId = new Map(
      coderConfigs.map(config => [config.coderId, this.normalizeCoderCapacityPercent(config.capacityPercent)])
    );
    this.availableCoders.set(this.availableCoders().map(coder => ({
      ...coder,
      capacityPercent: configByCoderId.get(coder.id) ?? this.getCoderCapacityPercent(coder)
    })));
    this.selectedCoders = this.createCoderSelectionModel(
      this.availableCoders().filter(coder => configByCoderId.has(coder.id))
    );
  }

  private findRecoveredVariable(savedVariable: CodingJobDefinitionRecoveryVariable): Variable {
    const variable = this.variables().find(candidate => (
      candidate.unitName === savedVariable.unitName &&
      candidate.variableId === savedVariable.variableId
    ));
    if (variable) {
      const recovered = { ...variable, includeDeriveError: savedVariable.includeDeriveError === true };
      this.variables.update(variables => variables.map(candidate => (candidate === variable ? recovered : candidate)));
      this.applyAvailabilityFilter();
      return recovered;
    }

    return {
      unitName: savedVariable.unitName,
      variableId: savedVariable.variableId,
      includeDeriveError: savedVariable.includeDeriveError === true
    };
  }

  private findRecoveredBundle(savedBundle: CodingJobDefinitionRecoveryBundle): VariableBundle {
    const bundle = this.variableBundles().find(candidate => candidate.id === savedBundle.id);
    if (!bundle) {
      return {
        ...savedBundle,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }

    const savedVariablesByKey = new Map(
      savedBundle.variables.map(variable => [
        this.getVariableUsageKey(variable.unitName, variable.variableId),
        variable
      ])
    );
    return this.replaceBundleRow({
      ...bundle,
      caseOrderingMode: savedBundle.caseOrderingMode,
      variables: bundle.variables.map(variable => ({
        ...variable,
        includeDeriveError: savedVariablesByKey.get(
          this.getVariableUsageKey(variable.unitName, variable.variableId)
        )?.includeDeriveError === true
      }))
    });
  }

  private clearDefinitionRecoveryDraft(): void {
    this.sessionRecoveryService.clearDraft(CODING_JOB_DEFINITION_RECOVERY_KEY);
  }

  private bindSelectionPreviewRefresh(): void {
    this.selectionPreviewSubscription.unsubscribe();
    this.selectionPreviewSubscription = new Subscription();

    this.selectionPreviewSubscription.add(
      this.selectedVariables().changed.subscribe(change => {
        this.variableSelectionChanges.next(change);
        this.queueDistributionPreviewRefresh();
      })
    );
    this.selectionPreviewSubscription.add(
      this.selectedVariableBundles.changed.subscribe(() => this.queueDistributionPreviewRefresh())
    );
    this.selectionPreviewSubscription.add(
      this.selectedCoders.changed.subscribe(() => this.queueDistributionPreviewRefresh())
    );
  }

  private queueDistributionPreviewRefresh(): void {
    this.workloadRevision.update(revision => revision + 1);
    if (this.data.mode !== 'definition' || this.isReadOnly) {
      return;
    }

    this.distributionPreviewSummary.set(null);
    this.changeDetectorRef.markForCheck();
    this.distributionPreviewRefresh$.next();
  }

  private loadDistributionPreview(): Observable<DistributionCalculationResponse | null> {
    if (
      this.data.mode !== 'definition' ||
      this.hasInvalidDistributionPreviewControls() ||
      this.selectedCoders.selected.length === 0 ||
      (
        this.selectedVariableValues().length === 0 &&
        this.selectedVariableBundles.selected.length === 0
      )
    ) {
      return of(null);
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(null);
    }

    return this.distributedCodingService.calculateDistribution(
      workspaceId,
      this.getSelectedDefinitionVariables(),
      this.mapCodersForDistribution(this.getSelectedCodersForDistribution()),
      this.sanitizeNumber(this.codingJobForm.getRawValue().doubleCodingAbsolute),
      this.sanitizeNumber(this.codingJobForm.getRawValue().doubleCodingPercentage),
      this.getSelectedDefinitionVariableBundles(),
      this.codingJobForm.getRawValue().caseOrderingMode,
      this.sanitizeNumber(this.codingJobForm.getRawValue().maxCodingCases),
      this.getDistributionSeed()
    )
      .pipe(catchError(() => of(null)));
  }

  private hasInvalidDistributionPreviewControls(): boolean {
    return [
      'doubleCodingAbsolute',
      'doubleCodingPercentage',
      'caseOrderingMode',
      'maxCodingCases'
    ].some(controlName => this.codingJobForm.get(controlName)?.invalid);
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
      this.includeDeriveErrorInManualCoding.set(false);
      this.loadCodingIncompleteVariables();
      return;
    }

    this.workspaceSettingsService
      .getIncludeDeriveErrorInManualCoding(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: enabled => {
          this.includeDeriveErrorInManualCoding.set(enabled);
          this.loadCodingIncompleteVariables();
        },
        error: () => {
          this.includeDeriveErrorInManualCoding.set(false);
          this.loadCodingIncompleteVariables();
        }
      });
  }

  loadAvailableCoders(): void {
    this.isLoadingAvailableCoders.set(true);

    this.coderService.getCoders().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: coders => {
        this.availableCoders.set(coders.map(coder => ({
          ...coder,
          capacityPercent: this.getInitialCoderCapacityPercent(coder.id)
        })));
        this.isLoadingAvailableCoders.set(false);
        let assignedIds: number[] = [];
        if (this.data.isEdit && this.data.codingJob?.assignedCoders) {
          assignedIds = this.data.codingJob.assignedCoders;
        } else if (this.coders() && this.coders().length > 0) {
          assignedIds = this.coders().map(c => c.id);
        }

        if (assignedIds.length > 0) {
          const preSelectedCoders = this.availableCoders().filter(c => assignedIds.includes(c.id));
          this.selectedCoders = this.createCoderSelectionModel(preSelectedCoders);
        } else {
          this.selectedCoders = this.createCoderSelectionModel();
        }
        this.bindSelectionPreviewRefresh();
        this.queueDistributionPreviewRefresh();
        this.availableCodersLoadedForRecovery = true;
        this.restoreDefinitionRecoveryDraft();
      },
      error: () => {
        this.isLoadingAvailableCoders.set(false);
        this.availableCodersLoadedForRecovery = true;
        this.restoreDefinitionRecoveryDraft();
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
    return this.definitionRules.normalizeCoderCapacityPercent(value);
  }

  getCoderCapacityPercent(coder: Coder): number {
    return this.normalizeCoderCapacityPercent(coder.capacityPercent);
  }

  updateCoderCapacityPercent(coder: Coder, value: unknown): void {
    if (this.isReadOnly) {
      return;
    }

    const capacityPercent = this.normalizeCoderCapacityPercent(value);
    this.availableCoders.update(coders => coders.map(candidate => (candidate.id === coder.id ?
      { ...candidate, capacityPercent } : candidate)));
    const updatedCoder = this.availableCoders().find(candidate => candidate.id === coder.id);
    this.selectedCoders = this.createCoderSelectionModel(this.selectedCoders.selected.map(candidate => (candidate.id === coder.id ?
      updatedCoder || { ...candidate, capacityPercent } : candidate)));
    this.bindSelectionPreviewRefresh();
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
      this.existingJobDefinitionsLoadedForRecovery = true;
      this.restoreDefinitionRecoveryDraft();
      return;
    }

    this.codingJobBackendService.getJobDefinitions(
      workspaceId,
      { includePlannedUsage: true }
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: definitions => {
        // When editing an existing job definition, exclude the current job definition
        // from the list to prevent its variables from being incorrectly disabled
        if (this.data.isEdit && this.data.jobDefinitionId) {
          this.existingJobDefinitions.set(definitions.filter(def => def.id !== this.data.jobDefinitionId));
        } else {
          this.existingJobDefinitions.set(definitions);
        }
        this.buildDisabledVariablesSet();
        this.applyJobDefinitionUsage();
        this.applyAvailabilityFilter();
        this.existingJobDefinitionsLoadedForRecovery = true;
        this.restoreDefinitionRecoveryDraft();
      },
      error: () => {
        // Silently fail - disabled variables will just not be disabled
        this.existingJobDefinitionsLoadedForRecovery = true;
        this.restoreDefinitionRecoveryDraft();
      }
    });
  }

  private buildDisabledVariablesSet(): void {
    this.disabledVariableKeys.clear();
  }

  loadCoders(jobId: number): void {
    this.isLoadingCoders.set(true);

    this.coderService.getCodersByJobId(jobId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: coders => {
        this.coders.set(coders);
        this.isLoadingCoders.set(false);
        const assignedIds = coders.map(c => c.id);
        const preSelectedCoders = this.availableCoders().filter(c => assignedIds.includes(c.id));
        this.selectedCoders = this.createCoderSelectionModel(preSelectedCoders);
        this.bindSelectionPreviewRefresh();
        this.queueDistributionPreviewRefresh();
      },
      error: () => {
        this.isLoadingCoders.set(false);
      }
    });
  }

  initForm(): void {
    this.codingJobForm = createCodingJobForm({
      mode: this.data.mode,
      isEdit: this.data.isEdit,
      job: this.data.codingJob,
      readOnly: this.isReadOnly,
      lockStatus: this.hasExistingDefinitionJobs
    });

    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;

    if (originallyAssigned && originallyAssigned.length > 0) {
      this.selectedVariables.set(this.createVariableSelectionModel([...originallyAssigned]));
      this.bindSelectionPreviewRefresh();
    }
  }

  private loadMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.missingsProfilesLoadedForRecovery = true;
      this.restoreDefinitionRecoveryDraft();
      return;
    }

    this.isLoadingMissingsProfiles.set(true);
    this.missingsProfileService.getMissingsProfiles(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: profiles => {
          this.missingsProfiles.set(profiles.length > 0 ? profiles : [{ id: 0, label: 'IQB-Standard' }]);
          this.isLoadingMissingsProfiles.set(false);

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
          this.missingsProfilesLoadedForRecovery = true;
          this.restoreDefinitionRecoveryDraft();
        },
        error: () => {
          this.isLoadingMissingsProfiles.set(false);
          this.missingsProfilesLoadedForRecovery = true;
          this.restoreDefinitionRecoveryDraft();
        }
      });
  }

  loadCodingIncompleteVariables(unitNameFilter?: string, forceReload = false): void {
    const trainingRequired = this.trainingRequiredFilter() === 'all' ? undefined : this.trainingRequiredFilter() === 'true';
    this.variableLoadRequests.next({
      workspaceId: this.appService.selectedWorkspaceId,
      unitName: unitNameFilter || undefined,
      trainingRequired,
      includeDeriveError: this.includeDeriveErrorInManualCoding() ? true : undefined,
      preloadedVariables: !forceReload && !unitNameFilter && trainingRequired === undefined ?
        this.data.preloadedVariables : undefined
    });
  }

  private processVariableSelection(): void {
    const originallyAssigned = this.data.codingJob?.assignedVariables ?? this.data.codingJob?.variables;

    const selectedByKey = new Map(this.selectedVariableValues().map(variable => [
      this.getVariableSelectionKey(variable),
      variable
    ]));
    const assignedByKey = new Map((originallyAssigned ?? []).map(variable => [
      this.getVariableSelectionKey(variable),
      variable
    ]));
    const selectedKeys = new Set([...selectedByKey.keys(), ...assignedByKey.keys()]);
    const currentVariableKeys = new Set(
      this.variables().map(variable => this.getVariableSelectionKey(variable))
    );
    const nextSelectedVariables = this.selectedVariableValues().filter(
      variable => !currentVariableKeys.has(this.getVariableSelectionKey(variable))
    );

    const variables = this.variables().map(rowVar => {
      const rowKey = this.getVariableSelectionKey(rowVar);
      const selectedVariable = selectedByKey.get(rowKey);
      const assignedVariable = assignedByKey.get(rowKey);

      const nextRow = {
        ...rowVar,
        includeDeriveError: this.includeDeriveErrorInManualCoding() &&
          (selectedVariable?.includeDeriveError === true || assignedVariable?.includeDeriveError === true)
      };

      if (selectedKeys.has(rowKey)) {
        nextSelectedVariables.push(nextRow);
      }
      return nextRow;
    });

    this.variables.set(variables);
    this.applyAvailabilityFilter();
    this.selectedVariables.set(this.createVariableSelectionModel(nextSelectedVariables));
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

  private createCoderSelectionModel(initiallySelectedValues: Coder[] = []): SelectionModel<Coder> {
    return new SelectionModel<Coder>(true, initiallySelectedValues, true, (first, second) => first.id === second.id);
  }

  private createBundleSelectionModel(initiallySelectedValues: VariableBundle[] = []): SelectionModel<VariableBundle> {
    return new SelectionModel<VariableBundle>(true, initiallySelectedValues, true, (first, second) => first.id === second.id);
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
    this.isLoadingBundles.set(true);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.codingJobBackendService.getVariableBundles(workspaceId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: bundles => {
          const assignedBundles = this.data.isEdit && this.data.codingJob ?
            this.data.codingJob.variableBundles || this.data.codingJob.assignedVariableBundles || [] : [];
          const selectedBundlesById = new Map(this.selectedVariableBundles.selected.map(bundle => [bundle.id, bundle]));
          const enrichedBundles = bundles.map(bundle => {
            const savedBundle = selectedBundlesById.get(bundle.id) || assignedBundles.find(assigned => assigned.id === bundle.id);
            const savedVariablesByKey = new Map((savedBundle?.variables || []).map(variable => [
              this.getVariableSelectionKey(variable), variable
            ]));
            return {
              ...bundle,
              ...(savedBundle?.caseOrderingMode ? { caseOrderingMode: savedBundle.caseOrderingMode } : {}),
              variables: bundle.variables.map((bundleVar: Variable) => ({
                ...bundleVar,
                ...this.getVariableMetrics(bundleVar),
                ...(savedBundle ? { includeDeriveError: savedVariablesByKey.get(this.getVariableSelectionKey(bundleVar))?.includeDeriveError === true } : {})
              }))
            };
          });

          this.replaceBundleRows(enrichedBundles);
          this.isLoadingBundles.set(false);
          if (assignedBundles.length > 0) {
            const ids = assignedBundles.map(bundle => bundle.id);
            this.selectedVariableBundles.select(...enrichedBundles.filter(bundle => ids.includes(bundle.id)));
          }
          this.variableBundlesLoadedForRecovery = true;
          this.restoreDefinitionRecoveryDraft();
        },
        error: () => {
          this.isLoadingBundles.set(false);
          this.variableBundlesLoadedForRecovery = true;
          this.restoreDefinitionRecoveryDraft();
        }
      });
    } else {
      this.isLoadingBundles.set(false);
      this.variableBundlesLoadedForRecovery = true;
      this.restoreDefinitionRecoveryDraft();
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
    if (!this.variables() || this.variables().length === 0) return;

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
    if (this.existingJobDefinitions() && this.existingJobDefinitions().length > 0) {
      this.existingJobDefinitions().forEach(def => {
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
    const variables = this.variables().map(v => {
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
      return {
        ...v,
        availableCases: Math.max(0, originalAvailable - regularCasesUsed),
        availableCasesWithDeriveError: Math.max(0, originalAvailableWithDeriveError - totalCasesUsed)
      };
    });

    this.replaceVariableRows(variables);
    this.syncBundleVariablesWithAvailability();
    this.syncSelectionWithAvailability();
  }

  private replaceVariableRows(variables: Variable[]): void {
    const selectedByKey = new Map(this.selectedVariableValues().map(variable => [this.getVariableSelectionKey(variable), variable]));
    const nextRows = variables.map(variable => (variable.includeDeriveError === undefined &&
      selectedByKey.get(this.getVariableSelectionKey(variable))?.includeDeriveError === true ?
      { ...variable, includeDeriveError: true } : variable));
    const variablesByKey = new Map(nextRows.map(variable => [this.getVariableSelectionKey(variable), variable]));
    const selected = this.selectedVariableValues().map(variable => variablesByKey.get(this.getVariableSelectionKey(variable)) || variable);
    this.variables.set(nextRows);
    this.selectedVariables.set(this.createVariableSelectionModel(selected));
    this.bindSelectionPreviewRefresh();
    this.applyAvailabilityFilter();
  }

  private replaceBundleRow(bundle: VariableBundle): VariableBundle {
    this.replaceBundleRows(this.variableBundles().map(candidate => (candidate.id === bundle.id ? bundle : candidate)));
    return bundle;
  }

  private replaceBundleRows(bundles: VariableBundle[]): void {
    const bundlesById = new Map(bundles.map(bundle => [bundle.id, bundle]));
    this.variableBundles.set(bundles);
    this.bundlesDataSource.data = bundles;
    this.selectedVariableBundles = this.createBundleSelectionModel(
      this.selectedVariableBundles.selected.map(bundle => bundlesById.get(bundle.id) || bundle)
    );
    this.bindSelectionPreviewRefresh();
    this.queueDistributionPreviewRefresh();
  }

  private getVariableMetrics(variable: Pick<Variable, 'unitName' | 'variableId'>): Pick<Variable, 'responseCount' | 'deriveErrorResponseCount' | 'availableCases' | 'uniqueCasesAfterAggregation' | 'availableCasesWithDeriveError' | 'uniqueCasesAfterAggregationWithDeriveError' | 'casesInJobs' | 'isDerived' | 'coderTrainingRequired'> {
    const matchingVar = this.variables().find(
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
    if (!this.variableBundles() || this.variableBundles().length === 0) {
      return;
    }

    this.replaceBundleRows(this.variableBundles().map(bundle => ({
      ...bundle,
      variables: bundle.variables.map(bundleVar => {
        const metrics = this.getVariableMetrics(bundleVar);
        return { ...bundleVar, ...metrics };
      })
    })));
  }

  private syncSelectionWithAvailability(): void {
    const toDeselect = this.selectedVariableValues().filter(v => this.getVariableSelectableAvailableCases(v) === 0 &&
      !(this.data.isEdit && this.isVariableOriginallyAssigned(v))
    );

    toDeselect.forEach(v => this.selectedVariables().deselect(v));

    if (toDeselect.length > 0) {
      this.queueDistributionPreviewRefresh();
    }
  }

  applyFilter(): void {
    this.loadCodingIncompleteVariables(this.unitNameFilter());
    this.applyAvailabilityFilter();
  }

  applyAvailabilityFilter(): void {
    let filteredData = this.variables();
    if (this.unitNameFilter() || this.variableIdFilter()) {
      filteredData = filteredData.filter(v => {
        const matchesUnit = !this.unitNameFilter() ||
          v.unitName?.toLowerCase().includes(this.unitNameFilter().toLowerCase());
        const matchesVariable = !this.variableIdFilter() ||
          v.variableId?.toLowerCase().includes(this.variableIdFilter().toLowerCase());
        return matchesUnit && matchesVariable;
      });
    }

    if (this.availabilityFilter() !== 'all') {
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
          return this.availabilityFilter() === 'none';
        }

        const isFull = available >= total;
        const isNone = available <= 0;
        const isPartial = !isFull && !isNone;

        switch (this.availabilityFilter()) {
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

  protected applyBundleFilter(): void {
    if (this.bundleNameFilter()) {
      this.bundlesDataSource.filter = this.bundleNameFilter().trim().toLowerCase();
    } else {
      this.bundlesDataSource.filter = '';
    }
  }

  clearFilters(): void {
    this.unitNameFilter.set('');
    this.variableIdFilter.set('');
    this.availabilityFilter.set('all');
    this.trainingRequiredFilter.set('all');
    this.loadCodingIncompleteVariables();
  }

  protected clearBundleFilter(): void {
    this.bundleNameFilter.set('');
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

  protected getVariableDisabledReason(variable: Variable): string {
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

  protected getVariableCount(bundle: VariableBundle): number {
    return bundle.variables.length;
  }

  getCodingJobCount(): number {
    return this.workloadSummary().jobCount;
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

    if (this.includeDeriveErrorInManualCoding() && this.hasDeriveErrorResponses(variable)) {
      return Math.max(
        regularAvailable,
        variable.availableCasesWithDeriveError ?? regularAvailable
      );
    }

    return regularAvailable;
  }

  private requiresExplicitDeriveErrorSelection(variable: Variable): boolean {
    return this.includeDeriveErrorInManualCoding() &&
      this.hasDeriveErrorResponses(variable) &&
      variable.includeDeriveError !== true &&
      this.getVariableRegularAvailableCases(variable) === 0 &&
      (variable.availableCasesWithDeriveError ?? 0) > 0;
  }

  private hasSelectedVariablesRequiringDeriveErrorSelection(): boolean {
    return this.selectedVariableValues().some(variable => this.requiresExplicitDeriveErrorSelection(variable)) ||
      this.selectedVariableBundles.selected.some(bundle => bundle.variables.some(
        variable => this.requiresExplicitDeriveErrorSelection(variable as Variable)
      ));
  }

  private getVariableSelectableEffectiveCases(variable: Variable): number {
    const regularEffective = this.getVariableRegularEffectiveCases(variable);

    if (this.includeDeriveErrorInManualCoding() && this.hasDeriveErrorResponses(variable)) {
      return Math.max(
        regularEffective,
        this.getVariableEffectiveCasesWithDeriveError(variable)
      );
    }

    return regularEffective;
  }

  private shouldUseDeriveErrorAvailability(variable: Variable): boolean {
    return this.includeDeriveErrorInManualCoding() &&
      variable.includeDeriveError === true &&
      this.hasDeriveErrorResponses(variable);
  }

  getSelectedEffectiveCodingCases(): number {
    return this.workloadSummary().selectedCases;
  }

  getDistributableCodingCasesBeforeLimit(): number {
    return this.workloadSummary().distributableCases;
  }

  getUnavailableSelectedCodingCases(): number {
    return this.workloadSummary().unavailableCases;
  }

  getMaxCasesLimitReduction(): number {
    return this.workloadSummary().limitReduction;
  }

  getTotalCodingCases(): number {
    return this.workloadSummary().totalCases;
  }

  private workloadInput(preview: DistributionPreviewSummary | null): CodingWorkloadInput {
    const asWorkloadVariable = (variable: Variable): WorkloadVariable => ({
      unitName: variable.unitName,
      variableId: variable.variableId,
      effectiveCases: this.getVariableEffectiveCases(variable),
      availableCases: this.getVariableAvailableCases(variable)
    });
    return {
      ...this.codingJobForm.getRawValue(),
      mode: this.data.mode,
      variables: this.selectedVariableValues().map(asWorkloadVariable),
      bundles: this.selectedVariableBundles.selected.map(bundle => ({
        id: bundle.id, caseOrderingMode: bundle.caseOrderingMode, variables: bundle.variables.map(asWorkloadVariable)
      })),
      distributionSeed: this.getDistributionSeed(),
      doubleCodingMode: this.doubleCodingMode(),
      coderCapacityPercent: this.selectedCoders.selected.map(coder => this.getCoderCapacityPercent(coder)),
      preview
    };
  }

  private getSelectedDistributionVariableCaseCountsAfterLimit(): number[] {
    return new CodingWorkload(this.workloadInput(null)).estimateVariableCaseCounts();
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

  getTotalDoubleCodedCases(): number {
    return this.workloadSummary().doubleCodedCases;
  }

  getTotalCodingTasks(): number {
    return this.workloadSummary().totalCodingTasks;
  }

  getTotalTimeInSeconds(): number {
    return this.workloadSummary().totalTimeSeconds;
  }

  getTimePerCoderInSeconds(): number {
    return this.workloadSummary().timePerCoderSeconds;
  }

  getFormattedTotalTime(): string {
    return this.workloadSummary().formattedTotalTime;
  }

  getFormattedTimePerCoder(): string {
    return this.workloadSummary().formattedTimePerCoder;
  }

  protected onAvailabilityChange(event: { value: 'all' | 'full' | 'partial' | 'none' }): void {
    this.availabilityFilter.set(event.value);
    this.applyAvailabilityFilter();
  }

  protected getAvailabilityClass(variable: Variable): string {
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
    const numSelected = selectableRows.filter(v => this.isVariableSelected(v)).length;
    const numRows = selectableRows.length;
    return numSelected === numRows && numRows > 0;
  }

  isVariableSelected(variable: Variable): boolean {
    this.variableSelectionChange();
    return this.selectedVariables().isSelected(variable);
  }

  masterToggle(): void {
    if (this.isReadOnly) {
      return;
    }

    const selectableRows = this.getMasterToggleRows();
    if (this.isAllSelected()) {
      selectableRows.forEach(row => this.selectedVariables().deselect(row));
    } else {
      selectableRows.forEach(row => this.selectedVariables().select(row));
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
    return this.includeDeriveErrorInManualCoding() &&
      ((variable.deriveErrorResponseCount ?? 0) > 0 || variable.includeDeriveError === true);
  }

  setDeriveErrorIncluded(variable: Variable, includeDeriveError: boolean): void {
    if (this.isReadOnly || this.data.mode !== 'definition' || !this.hasDeriveErrorResponses(variable)) {
      return;
    }

    const key = this.getVariableSelectionKey(variable);
    this.replaceVariableRows(this.variables().map(candidate => (this.getVariableSelectionKey(candidate) === key ?
      { ...candidate, includeDeriveError } : candidate)));
    this.queueDistributionPreviewRefresh();
  }

  protected isBundleVariableDeriveErrorIncluded(variable: Variable): boolean {
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

    const currentBundle = this.variableBundles().find(candidate => candidate.id === bundle.id) || bundle;
    this.replaceBundleRow({
      ...currentBundle,
      variables: currentBundle.variables.map(candidate => (this.getVariableSelectionKey(candidate) === this.getVariableSelectionKey(variable) ?
        { ...candidate, includeDeriveError } : candidate))
    });
    this.queueDistributionPreviewRefresh();
  }

  protected getBundlePreviewVariables(bundle: VariableBundle): Variable[] {
    if (this.selectedVariableBundles.isSelected(bundle)) {
      return bundle.variables;
    }

    return bundle.variables.slice(0, 3);
  }

  private getSelectedDefinitionVariables(): Variable[] {
    return this.selectedVariableValues().map(variable => ({
      unitName: variable.unitName,
      variableId: variable.variableId,
      ...(this.includeDeriveErrorInManualCoding() &&
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
        ...(this.includeDeriveErrorInManualCoding() &&
          variable.includeDeriveError === true &&
          this.hasDeriveErrorResponses(variable as Variable) ? { includeDeriveError: true } : {})
      }))
    })) as VariableBundle[];
  }

  protected isAllCodersSelected(): boolean {
    const numSelected = this.selectedCoders.selected.length;
    const numRows = this.availableCoders().length;
    return numSelected === numRows && numRows > 0;
  }

  masterCoderToggle(): void {
    if (this.isReadOnly) {
      return;
    }

    if (this.isAllCodersSelected()) {
      this.selectedCoders.clear();
    } else {
      this.availableCoders().forEach(coder => this.selectedCoders.select(coder));
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isReadOnly) {
      this.dialogRef.close();
      return;
    }

    if (this.isSaving()) {
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

      if (this.selectedVariableValues().length === 0 && this.selectedVariableBundles.selected.length === 0) {
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

      if (this.selectedVariableValues().length === 0 && this.selectedVariableBundles.selected.length === 0) {
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

  private submitEdit(): void { this.submitJob(true); }

  private submitCreate(): void { this.submitJob(false); }

  private submitJob(isEdit: boolean): void {
    this.isSaving.set(true);
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving.set(false);
      return;
    }
    const selectedCoderIds = this.selectedCoders.selected.map(coder => coder.id);
    const codingJob: CodingJob = {
      id: isEdit ? this.data.codingJob?.id || 0 : 0,
      ...this.codingJobForm.getRawValue(),
      workspace_id: workspaceId,
      name: this.data.codingJob?.name ?? '',
      status: this.codingJobForm.controls.status?.value ?? 'pending',
      created_at: isEdit ? this.data.codingJob?.created_at || new Date() : new Date(),
      updated_at: new Date(),
      assignedCoders: selectedCoderIds,
      variables: this.selectedVariableValues(),
      variableBundles: this.selectedVariableBundles.selected,
      assignedVariables: this.selectedVariableValues(),
      assignedVariableBundles: this.selectedVariableBundles.selected
    };

    const request = isEdit ?
      this.persistence.updateJob(workspaceId, this.data.codingJob!.id!, codingJob, selectedCoderIds) :
      this.persistence.createJob(workspaceId, codingJob, selectedCoderIds);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ job, assignmentFailed }) => {
        this.isSaving.set(false);
        const action = isEdit ? 'updated' : 'created';
        const result = assignmentFailed ? 'coder-failed' : 'success';
        this.snackBar.open(this.translateService.instant(
          `coding-job-definition-dialog.snackbars.job-${action}-${result}`
        ), this.translateService.instant('common.close'), { duration: assignmentFailed ? 5000 : 3000 });
        this.dialogRef.close(job);
      },
      error: error => {
        this.isSaving.set(false);
        this.snackBar.open(this.translateService.instant(
          isEdit ? 'coding-job-definition-dialog.snackbars.error-updating-job' : 'coding-job-definition-dialog.snackbars.error-creating-job',
          { error: error.message }
        ), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  private buildBulkCreationData(creationResults?: CreationResults): BulkCreationData {
    const baseData: BulkCreationData = {
      selectedVariables: this.selectedVariableValues(),
      selectedVariableBundles: this.selectedVariableBundles.selected,
      selectedCoders: this.getSelectedCodersForDistribution(),
      doubleCodingAbsolute: this.codingJobForm.getRawValue().doubleCodingAbsolute,
      doubleCodingPercentage: this.codingJobForm.getRawValue().doubleCodingPercentage,
      caseOrderingMode: this.codingJobForm.getRawValue().caseOrderingMode,
      maxCodingCases: this.codingJobForm.getRawValue().maxCodingCases,
      distributionSeed: this.data.codingJob?.distributionSeed,
      displayOptions: {
        showScore: this.codingJobForm.getRawValue().showScore ?? true,
        allowComments: this.codingJobForm.getRawValue().allowComments ?? true,
        suppressGeneralInstructions: this.codingJobForm.getRawValue().suppressGeneralInstructions ?? false
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
    this.isSaving.set(true);
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving.set(false);
      return;
    }

    try {
      const mappedCoders = this.mapCodersForDistribution(data.selectedCoders);
      const result = await firstValueFrom(this.distributedCodingService.createDistributedCodingJobs(
        workspaceId,
        data.selectedVariables,
        mappedCoders,
        this.codingJobForm.getRawValue().doubleCodingAbsolute,
        this.codingJobForm.getRawValue().doubleCodingPercentage,
        data.selectedVariableBundles,
        this.codingJobForm.getRawValue().caseOrderingMode,
        this.codingJobForm.getRawValue().maxCodingCases ?? undefined,
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

    this.isSaving.set(false);
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
        this.replaceBundleRow({ ...bundle, caseOrderingMode: this.codingJobForm.getRawValue().caseOrderingMode || 'continuous' });
      }
      this.removeConflictingIndividualSelections(bundle);
    }
  }

  setBundleOrderingMode(bundle: VariableBundle, mode: 'continuous' | 'alternating'): void {
    if (this.isReadOnly) {
      return;
    }

    const currentBundle = this.variableBundles().find(candidate => candidate.id === bundle.id) || bundle;
    this.replaceBundleRow({ ...currentBundle, caseOrderingMode: mode });
    this.queueDistributionPreviewRefresh();
  }

  private removeConflictingIndividualSelections(bundle: VariableBundle): void {
    const variablesToRemove = this.selectedVariableValues().filter(variable => bundle.variables.some(bundleVar => bundleVar.unitName === variable.unitName && bundleVar.variableId === variable.variableId
    )
    );

    variablesToRemove.forEach(variable => {
      this.selectedVariables().deselect(variable);
    });
  }

  setDoubleCodingMode(mode: 'absolute' | 'percentage'): void {
    if (this.isReadOnly) {
      return;
    }

    if (this.doubleCodingMode() === mode) {
      return;
    }

    this.doubleCodingMode.set(mode);

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
    this.setDoubleCodingMode(this.doubleCodingMode() === 'absolute' ? 'percentage' : 'absolute');
  }

  protected get currentDoubleCodingControl(): FormControl<number> {
    const controlName = this.doubleCodingMode() === 'absolute' ? 'doubleCodingAbsolute' : 'doubleCodingPercentage';
    return this.codingJobForm.controls[controlName];
  }

  protected getDoubleCodingLabel(): string {
    if (this.doubleCodingMode() === 'absolute') {
      return this.translateService.instant('coding-job-definition-dialog.double-coding.labels.absolute');
    }
    return this.translateService.instant('coding-job-definition-dialog.double-coding.labels.percentage');
  }

  protected getDoubleCodingPlaceholder(): string {
    if (this.doubleCodingMode() === 'absolute') {
      return this.translateService.instant('coding-job-definition-dialog.double-coding.placeholders.absolute');
    }
    return this.translateService.instant('coding-job-definition-dialog.double-coding.placeholders.percentage');
  }

  private submitDefinitionCreate(): void {
    this.isSaving.set(true);

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving.set(false);
      return;
    }

    const jobDefinition: JobDefinition = {
      ...this.buildDefinitionUpdatePayload(),
      status: 'draft',
      distributionSeed: this.getDistributionSeed()
    };

    this.codingJobBackendService.createJobDefinition(workspaceId, jobDefinition).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: createdDefinition => {
        this.isSaving.set(false);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-created-success'), this.translateService.instant('common.close'), { duration: 3000 });
        this.clearDefinitionRecoveryDraft();
        this.dialogRef.close(createdDefinition);
      },
      error: error => {
        this.isSaving.set(false);
        const message = this.getErrorMessage(error);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-creating-definition', { error: message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  private buildDefinitionUpdatePayload(): Partial<JobDefinition> {
    const jobDefinition = this.definitionRules.buildDefinitionPayload(this.codingJobForm.getRawValue(), {
      assignedVariables: this.getSelectedDefinitionVariables(),
      assignedVariableBundles: this.getSelectedDefinitionVariableBundles(),
      assignedCoders: this.selectedCoders.selected.map(coder => coder.id),
      assignedCoderConfigs: this.getSelectedCoderConfigs()
    });

    const statusControl = this.codingJobForm.get('status');
    if (statusControl?.enabled) {
      const status = statusControl.value;
      if (status === 'draft' || status === 'pending_review' || status === 'approved') {
        jobDefinition.status = status;
      }
    }

    return jobDefinition;
  }

  private buildExistingJobsDirectUpdatePayload(
    jobDefinition: Partial<JobDefinition>
  ): Partial<JobDefinition> {
    return this.definitionRules.buildExistingJobsDirectUpdatePayload(jobDefinition);
  }

  private hasRefreshRelevantDefinitionChanges(
    jobDefinition: Partial<JobDefinition>
  ): boolean {
    return this.definitionRules.hasRefreshRelevantDefinitionChanges(this.data.codingJob, jobDefinition);
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
          definitionLabel: getJobDefinitionDisplayLabel({
            id: jobDefinitionId,
            name: jobDefinition.name
          }),
          preview,
          mode: 'update'
        },
        autoFocus: false
      });
      const confirmed = await firstValueFrom(dialogRef.afterClosed());

      if (!confirmed) {
        this.isSaving.set(false);
        return;
      }

      const result = await firstValueFrom(
        this.codingJobBackendService.applyJobDefinitionUpdateRefresh(
          workspaceId,
          jobDefinitionId,
          jobDefinition
        )
      );

      this.isSaving.set(false);
      this.snackBar.open(
        this.translateService.instant(
          'coding-job-definition-dialog.snackbars.definition-update-refresh-applied',
          { count: result.jobsCreated }
        ),
        this.translateService.instant('common.close'),
        { duration: 4000 }
      );
      this.clearDefinitionRecoveryDraft();
      this.dialogRef.close(result);
    } catch (error) {
      this.isSaving.set(false);
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
    this.isSaving.set(true);

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving.set(false);
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

    this.codingJobBackendService.updateJobDefinition(workspaceId, this.data.jobDefinitionId!, directUpdatePayload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: updatedDefinition => {
        this.isSaving.set(false);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-updated-success'), this.translateService.instant('common.close'), { duration: 3000 });
        this.clearDefinitionRecoveryDraft();
        this.dialogRef.close(updatedDefinition);
      },
      error: error => {
        this.isSaving.set(false);
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

    if (this.isSaving()) {
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
    if (this.selectedVariableValues().length === 0 && this.selectedVariableBundles.selected.length === 0) {
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

    this.isSaving.set(true);

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.no-workspace-selected'), this.translateService.instant('common.close'), { duration: 3000 });
      this.isSaving.set(false);
      return;
    }

    const jobDefinition: JobDefinition = {
      ...this.buildDefinitionUpdatePayload(),
      status: 'pending_review',
      distributionSeed: this.getDistributionSeed()
    };

    this.codingJobBackendService.createJobDefinition(workspaceId, jobDefinition).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: createdDefinition => {
        this.isSaving.set(false);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.definition-submitted-review'), this.translateService.instant('common.close'), { duration: 3000 });
        this.clearDefinitionRecoveryDraft();
        this.dialogRef.close(createdDefinition);
      },
      error: error => {
        this.isSaving.set(false);
        const message = this.getErrorMessage(error);
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.error-submitting-review', { error: message }), this.translateService.instant('common.close'), { duration: 5000 });
      }
    });
  }

  protected onCancel(): void {
    if (this.isSaving()) {
      return;
    }

    this.clearDefinitionRecoveryDraft();
    this.dialogRef.close();
  }

  private sanitizeNumber(value: unknown): number | undefined {
    return this.definitionRules.sanitizeNumber(value);
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
