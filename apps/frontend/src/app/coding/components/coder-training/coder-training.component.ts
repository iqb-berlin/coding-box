import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  Output,
  Input,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDivider } from '@angular/material/divider';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormArray,
  FormControl
} from '@angular/forms';
import {
  Subject, takeUntil, map, startWith, Observable, combineLatest, BehaviorSubject
} from 'rxjs';
import { JobDefinitionSelectionDialogComponent } from './job-definition-selection-dialog.component';
import { CoderService } from '../../services/coder.service';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { Coder } from '../../models/coder.model';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { CodingJobBackendService, JobDefinition } from '../../services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { AppService } from '../../../core/services/app.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { CoderTraining, CaseSelectionMode, ReferenceMode } from '../../models/coder-training.model';
import {
  getDuplicateTrainingLabelMatches,
  getTrainingOptionMeta,
  getTrainingOptionTitle
} from '../../utils/coder-training-display';

export interface VariableConfig {
  variableId: string;
  unitId: string;
  sampleCount: number;
}

export interface VariableGrouping {
  manual: { control: FormGroup; index: number }[];
  bundles: { bundle: VariableBundle; variables: { control: FormGroup; index: number }[] }[];
}

interface ValidationItem {
  label: string;
  valid: boolean;
}

interface BundleOrderingOverride {
  name: string;
  label: string;
}

@Component({
  selector: 'coding-box-coder-training',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    TranslateModule,
    MatButton,
    MatIcon,
    MatDivider,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatInput,
    MatSelect,
    MatOption,
    MatChipsModule,
    MatProgressSpinner,
    ReactiveFormsModule,
    MatIconButton,
    MatTooltip,
    MatHint,
    MatDialogModule,
    MatRadioModule
  ],
  templateUrl: './coder-training.component.html',
  styleUrls: ['./coder-training.component.scss']
})
export class CoderTrainingComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() startTraining = new EventEmitter<{ selectedCoders: Coder[], variableConfigs: VariableConfig[] }>();
  @Input() editTraining: CoderTraining | null = null;

  private destroy$ = new Subject<void>();
  private changeDetectorRef = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private coderService = inject(CoderService);
  private variableBundleService = inject(VariableBundleService);
  private codingJobBackendService = inject(CodingJobBackendService);
  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private appService = inject(AppService);
  private fb = inject(FormBuilder);
  private backendMessageTranslator = inject(BackendMessageTranslatorService);

  // Cached grouped variables data
  private _groupedVariables: VariableGrouping = { manual: [], bundles: [] };

  // Public getters for template access
  get groupedVariables(): VariableGrouping {
    return this._groupedVariables;
  }

  get isEditMode(): boolean {
    return !!this.editTraining;
  }

  coders: Coder[] = [];
  selectedCoders: Set<number> = new Set();
  availableVariables: Variable[] = [];
  availableTrainings: CoderTraining[] = [];
  availableBundles: VariableBundle[] = [];
  selectedBundleIds: Set<number> = new Set();
  isLoading = false;
  isLoadingVariables = false;
  isLoadingBundles = false;

  private _availableVariables$ = new BehaviorSubject<Variable[]>([]);

  trainingForm: FormGroup;
  variableFilterCtrl = new FormControl('');
  bundleFilterCtrl = new FormControl('');
  bundleSelection$ = new BehaviorSubject<number[]>([]);
  manualVariablesSelectControl = new FormControl<string[]>([]); // Stable control for mat-select
  private isSyncing = false;

  filteredVariables$!: Observable<Variable[]>;
  filteredBundles$!: Observable<VariableBundle[]>;

  constructor() {
    this.trainingForm = this.fb.group({
      trainingLabel: ['', [Validators.required]],
      caseOrderingMode: ['continuous'],
      caseSelectionMode: ['oldest_first' as CaseSelectionMode],
      includeDerivedVariables: [true],
      referenceTrainingIds: [[] as number[]],
      referenceMode: [null as ReferenceMode | null],
      variables: this.fb.array([])
    });

    // Initialize grouped variables
    this.updateGroupedVariables();
    this.setupFilters();
    this.setupManualSelectSync();
    this.setupDerivedVariableSync();
    this.setupReferenceModeValidation();
  }

  private setupManualSelectSync(): void {
    // 1. Sync FormArray -> FormControl (Initial & External Changes)
    this.variablesFormArray.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.isSyncing) return;

        const manualVarKeys = this.variablesFormArray.controls
          .filter(c => !c.get('bundleId')?.value)
          .map(c => `${c.get('unitId')?.value}::${c.get('variableId')?.value}`)
          .filter(key => key !== '::');

        const currentSelectedKeys = this.manualVariablesSelectControl.value || [];
        const sortedManual = [...manualVarKeys].sort();
        const sortedCurrent = [...currentSelectedKeys].sort();

        if (JSON.stringify(sortedManual) !== JSON.stringify(sortedCurrent)) {
          this.manualVariablesSelectControl.setValue(manualVarKeys, { emitEvent: false });
        }
      });

    // 2. Sync FormControl -> FormArray (User Selection via UI)
    this.manualVariablesSelectControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(selectedVarIds => {
        if (this.isSyncing) return;

        if (selectedVarIds) {
          this.isSyncing = true;
          try {
            this.onVariablesSelectionChange(selectedVarIds);
          } finally {
            this.isSyncing = false;
          }
        }
      });
  }

  private setupFilters(): void {
    this.filteredVariables$ = combineLatest([
      this.variableFilterCtrl.valueChanges.pipe(startWith('')),
      this.bundleSelection$,
      this.manualVariablesSelectControl.valueChanges.pipe(startWith([])),
      this.trainingForm.get('includeDerivedVariables')!.valueChanges.pipe(startWith(true)),
      this._availableVariables$
    ]).pipe(
      map(([filter, selectedBundleIds, , includeDerivedVariables, availableVariables]) => this.getSelectableManualVariables(
        filter || '',
        selectedBundleIds,
        !!includeDerivedVariables,
        availableVariables
      ))
    );

    this.filteredBundles$ = this.bundleFilterCtrl.valueChanges.pipe(
      startWith(''),
      map(filter => {
        const search = (filter || '').toLowerCase();
        return this.availableBundles.filter(b => b.name.toLowerCase().includes(search) ||
          (b.description && b.description.toLowerCase().includes(search))
        );
      })
    );
  }

  private setupDerivedVariableSync(): void {
    this.trainingForm.get('includeDerivedVariables')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(includeDerivedVariables => {
        this.syncDerivedVariableSelection(!!includeDerivedVariables);
      });
  }

  private setupReferenceModeValidation(): void {
    const referenceTrainingIdsControl = this.trainingForm.get('referenceTrainingIds');
    const referenceModeControl = this.trainingForm.get('referenceMode');

    referenceTrainingIdsControl?.valueChanges
      .pipe(
        startWith(referenceTrainingIdsControl.value),
        takeUntil(this.destroy$)
      )
      .subscribe((referenceTrainingIds: number[]) => {
        const hasReferenceTrainings = (referenceTrainingIds || []).length > 0;
        referenceModeControl?.setValidators(hasReferenceTrainings ? [Validators.required] : []);
        if (!hasReferenceTrainings && referenceModeControl?.value) {
          referenceModeControl.setValue(null, { emitEvent: false });
        }
        referenceModeControl?.updateValueAndValidity({ emitEvent: false });
        this.changeDetectorRef.markForCheck();
      });
  }

  ngOnInit(): void {
    this.loadCoders();
    this.loadAvailableVariables();
    this.loadAvailableTrainings();

    // Population logic: wait for variables and bundles if in edit mode
    combineLatest([
      this._availableVariables$.pipe(startWith([])),
      this.variableBundleService.getBundles(1, 100).pipe(
        map(({ bundles }: { bundles: VariableBundle[] }) => bundles),
        startWith([])
      )
    ]).pipe(
      takeUntil(this.destroy$)
    ).subscribe(([variables, bundles]: [Variable[], VariableBundle[]]) => {
      this.availableVariables = variables;
      this.availableBundles = bundles;

      if ((variables.length > 0 || bundles.length > 0) && this.editTraining && this.trainingForm.get('variables')?.value.length === 0) {
        this.populateFormFromTraining();
      }

      this.isLoadingVariables = false;
      this.isLoadingBundles = false;
      this.changeDetectorRef.markForCheck();
    });
  }

  private populateFormFromTraining(): void {
    if (!this.editTraining) return;

    this.trainingForm.get('trainingLabel')?.setValue(this.editTraining.label);
    if (this.editTraining.case_ordering_mode) {
      this.trainingForm.get('caseOrderingMode')?.setValue(this.editTraining.case_ordering_mode);
    }
    if (this.editTraining.case_selection_mode) {
      this.trainingForm.get('caseSelectionMode')?.setValue(this.editTraining.case_selection_mode);
    }
    if (this.editTraining.reference_training_ids?.length) {
      this.trainingForm.get('referenceTrainingIds')?.setValue([...this.editTraining.reference_training_ids]);
    }
    if (this.editTraining.reference_mode) {
      this.trainingForm.get('referenceMode')?.setValue(this.editTraining.reference_mode);
    }

    if (this.editTraining.assigned_coders) {
      this.selectedCoders = new Set(this.editTraining.assigned_coders);
    }

    if (this.editTraining.assigned_variables) {
      this.editTraining.assigned_variables.forEach(v => {
        this.addVariable(v.variableId, v.unitName, v.sampleCount || 10, undefined, undefined, true);
      });
    }

    if (this.editTraining.assigned_variable_bundles) {
      this.editTraining.assigned_variable_bundles.forEach(b => {
        const bundle = this.availableBundles.find(avail => avail.id === b.id);
        if (bundle) {
          const firstVarInBundle = this.editTraining?.assigned_variables?.find(v => bundle.variables.some(bv => bv.variableId === v.variableId && bv.unitName === v.unitName)
          );
          const sampleCountByKey = firstVarInBundle?.sampleCount;
          const sampleCount = b.sampleCount || sampleCountByKey || 10;
          const caseOrderingMode =
            b.caseOrderingMode ||
            (b as { case_ordering_mode?: 'continuous' | 'alternating' }).case_ordering_mode ||
            this.editTraining?.case_ordering_mode ||
            'continuous';
          this.addBundleVariables(b.id, sampleCount, caseOrderingMode, true);
          if (this.variablesFormArray.controls.some(control => control.get('bundleId')?.value === b.id)) {
            this.selectedBundleIds.add(b.id);
          }
        }
      });
      this.bundleSelection$.next(Array.from(this.selectedBundleIds));
    }

    this.updateGroupedVariables();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get variablesFormArray(): FormArray {
    return this.trainingForm.get('variables') as FormArray;
  }

  private loadAvailableVariables(): void {
    this.isLoadingVariables = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError('Kein Arbeitsbereich ausgewählt');
      this.isLoadingVariables = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.codingJobBackendService.getCodingIncompleteVariables(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: variables => {
          this.availableVariables = variables;
          this._availableVariables$.next(variables);
          this.isLoadingVariables = false;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.showError('Fehler beim Laden der verfügbaren Variablen');
          this.isLoadingVariables = false;
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  private loadAvailableTrainings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.codingTrainingBackendService.getCoderTrainings(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: trainings => {
          this.availableTrainings = (trainings || []).filter(t => !this.editTraining || t.id !== this.editTraining!.id);
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.availableTrainings = [];
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  get includeDerivedVariables(): boolean {
    return !!this.trainingForm.get('includeDerivedVariables')?.value;
  }

  getDialogTitle(): string {
    return this.isEditMode ? 'Kodierer-Schulung bearbeiten' : 'Kodierer-Schulung erstellen';
  }

  getPrimaryActionLabel(): string {
    if (this.isLoading) {
      return this.isEditMode ? 'Schulung wird aktualisiert...' : 'Kodierungsaufträge werden erstellt...';
    }

    return this.isEditMode ? 'Schulung aktualisieren' : 'Kodierungsaufträge erstellen';
  }

  getDuplicateTrainingLabelMatches(): CoderTraining[] {
    return getDuplicateTrainingLabelMatches(
      this.availableTrainings,
      this.trainingForm.get('trainingLabel')?.value,
      this.editTraining?.id
    );
  }

  hasDuplicateTrainingLabel(): boolean {
    return this.getDuplicateTrainingLabelMatches().length > 0;
  }

  getDuplicateTrainingLabelWarning(): string {
    const matches = this.getDuplicateTrainingLabelMatches();
    if (matches.length === 0) {
      return '';
    }

    const ids = matches.slice(0, 3).map(training => `ID ${training.id}`).join(', ');
    const suffix = matches.length > 3 ? ` und ${matches.length - 3} weitere` : '';
    return `Diese Bezeichnung existiert bereits (${ids}${suffix}). Die Schulung kann trotzdem erstellt werden.`;
  }

  getTrainingOptionTitle(training: CoderTraining): string {
    return getTrainingOptionTitle(training);
  }

  getTrainingOptionMeta(training: CoderTraining): string {
    return getTrainingOptionMeta(training, 'Job', 'Jobs');
  }

  isVariableDerived(variable: Pick<Variable, 'unitName' | 'variableId' | 'isDerived'>): boolean {
    if (variable.isDerived !== undefined) {
      return !!variable.isDerived;
    }

    return this.isDerivedVariableKey(variable.unitName, variable.variableId);
  }

  isControlDerived(control: FormGroup): boolean {
    const unitId = control.get('unitId')?.value;
    const variableId = control.get('variableId')?.value;
    return this.isDerivedVariableKey(unitId, variableId);
  }

  getDerivedVariablesCount(): number {
    return this.availableVariables.filter(variable => this.isVariableDerived(variable)).length;
  }

  getSelectedDerivedVariablesCount(): number {
    return this.variablesFormArray.controls.filter(control => this.isControlDerived(control as FormGroup)).length;
  }

  getBundleDerivedVariablesCount(bundle: VariableBundle): number {
    return bundle.variables.filter(variable => this.isVariableDerived(variable)).length;
  }

  getBundleEffectiveVariableCount(bundle: VariableBundle): number {
    if (this.includeDerivedVariables) {
      return bundle.variables.length;
    }

    return bundle.variables.filter(variable => !this.isVariableDerived(variable)).length;
  }

  getCaseSelectionModeLabel(mode?: CaseSelectionMode | null): string {
    switch (mode || 'oldest_first') {
      case 'oldest_first':
        return 'Älteste Fälle zuerst';
      case 'newest_first':
        return 'Neueste Fälle zuerst';
      case 'random':
        return 'Zufällige Fälle';
      case 'random_per_testgroup':
        return 'Zufällig je Testgruppe';
      case 'random_testgroups':
        return 'Zufällige Testgruppen';
      default:
        return 'Älteste Fälle zuerst';
    }
  }

  getCaseSelectionModeDescription(mode?: CaseSelectionMode | null): string {
    switch (mode || 'oldest_first') {
      case 'oldest_first':
        return 'Nimmt pro Variable die ältesten verfügbaren Fälle nach Erfassungsreihenfolge.';
      case 'newest_first':
        return 'Nimmt pro Variable die neuesten verfügbaren Fälle nach Erfassungsreihenfolge.';
      case 'random':
        return 'Zieht die gewünschte Anzahl zufällig aus allen verfügbaren Fällen der Variable.';
      case 'random_per_testgroup':
        return 'Zieht zufällig und verteilt die Auswahl möglichst gleichmäßig über vorhandene Testgruppen.';
      case 'random_testgroups':
        return 'Wählt zunächst zufällige Testgruppen und zieht Fälle innerhalb dieser Gruppen.';
      default:
        return 'Nimmt pro Variable die ältesten verfügbaren Fälle nach Erfassungsreihenfolge.';
    }
  }

  getCaseOrderingModeLabel(mode?: 'continuous' | 'alternating' | null): string {
    return mode === 'alternating' ? 'Abwechselnd' : 'Fortlaufend';
  }

  private syncDerivedVariableSelection(includeDerivedVariables: boolean): void {
    if (includeDerivedVariables) {
      this.addMissingDerivedBundleVariables();
      return;
    }

    const removedCount = this.removeSelectedDerivedVariables();
    if (removedCount > 0) {
      this.showSuccess(`${removedCount} abgeleitete Variable(n) aus der Auswahl entfernt.`);
    }
  }

  private addMissingDerivedBundleVariables(): void {
    Array.from(this.selectedBundleIds).forEach(bundleId => {
      const bundle = this.availableBundles.find(b => b.id === bundleId);
      if (!bundle) return;

      const bundleSampleCount = this.getBundleSampleCount(bundleId);
      const bundleCaseOrderingMode = bundle.caseOrderingMode || this.trainingForm.get('caseOrderingMode')?.value || 'continuous';
      bundle.variables
        .filter(variable => this.isVariableDerived(variable))
        .forEach(variable => {
          if (!this.isVariableAlreadyAdded(variable)) {
            this.addVariable(
              variable.variableId,
              variable.unitName,
              bundleSampleCount,
              bundle.id,
              bundle.name,
              true,
              bundleCaseOrderingMode
            );
          }
        });
    });

    this.updateGroupedVariables();
    this.checkForOverlaps();
  }

  private removeSelectedDerivedVariables(): number {
    const indexesToRemove = this.variablesFormArray.controls
      .map((control, index) => ({ control: control as FormGroup, index }))
      .filter(item => this.isControlDerived(item.control))
      .map(item => item.index);

    indexesToRemove.reverse().forEach(index => this.variablesFormArray.removeAt(index));

    const manualSelection = this.manualVariablesSelectControl.value || [];
    const filteredManualSelection = manualSelection.filter(key => {
      const [unitId, variableId] = key.split('::');
      return !this.isDerivedVariableKey(unitId, variableId);
    });

    if (filteredManualSelection.length !== manualSelection.length) {
      this.manualVariablesSelectControl.setValue(filteredManualSelection, { emitEvent: false });
    }

    this.pruneSelectedBundlesWithoutVariables();
    this.updateGroupedVariables();
    this.checkForOverlaps();

    return indexesToRemove.length;
  }

  private pruneSelectedBundlesWithoutVariables(): void {
    const bundleIdsWithVariables = new Set(
      this.variablesFormArray.controls
        .map(control => control.get('bundleId')?.value as number | null)
        .filter((bundleId): bundleId is number => !!bundleId)
    );
    const selectedBundleIds = Array.from(this.selectedBundleIds);
    const prunedBundleIds = selectedBundleIds.filter(bundleId => bundleIdsWithVariables.has(bundleId));

    if (prunedBundleIds.length !== selectedBundleIds.length) {
      this.selectedBundleIds = new Set(prunedBundleIds);
      this.bundleSelection$.next(prunedBundleIds);
    }
  }

  private isDerivedVariableKey(unitId: string | undefined, variableId: string | undefined): boolean {
    return !!this.availableVariables.find(variable => (
      variable.unitName === unitId &&
      variable.variableId === variableId &&
      variable.isDerived
    ));
  }

  private getVariableKey(variable: Pick<Variable, 'unitName' | 'variableId'>): string {
    return `${variable.unitName}::${variable.variableId}`;
  }

  private getVariablesInSelectedBundles(selectedBundleIds: number[] = this.selectedBundleArray): Set<string> {
    const variablesInBundles = new Set<string>();
    selectedBundleIds.forEach(bundleId => {
      const bundle = this.availableBundles.find(b => b.id === bundleId);
      bundle?.variables.forEach(variable => {
        variablesInBundles.add(this.getVariableKey(variable));
      });
    });
    return variablesInBundles;
  }

  private getSelectableManualVariables(
    filter = this.variableFilterCtrl.value || '',
    selectedBundleIds: number[] = this.selectedBundleArray,
    includeDerivedVariables = this.includeDerivedVariables,
    availableVariables: Variable[] = this.availableVariables
  ): Variable[] {
    const search = filter.toLowerCase();
    const variablesInBundles = this.getVariablesInSelectedBundles(selectedBundleIds);

    return availableVariables.filter(variable => {
      const matchesSearch = variable.variableId.toLowerCase().includes(search) ||
        variable.unitName.toLowerCase().includes(search);
      const inBundle = variablesInBundles.has(this.getVariableKey(variable));
      const matchesDerivedFilter = includeDerivedVariables || !this.isVariableDerived(variable);
      return matchesSearch && !inBundle && matchesDerivedFilter;
    });
  }

  getSelectableManualVariableKeys(): string[] {
    return this.getSelectableManualVariables().map(variable => this.getVariableKey(variable));
  }

  hasSelectableManualVariables(): boolean {
    const selectedManualKeys = new Set(this.manualVariablesSelectControl.value || []);
    return this.getSelectableManualVariableKeys().some(key => !selectedManualKeys.has(key));
  }

  hasManualVariablesSelected(): boolean {
    return this.getManualVariablesCount() > 0;
  }

  selectAllManualVariables(): void {
    const selectedManualKeys = this.manualVariablesSelectControl.value || [];
    const selectableManualKeys = this.getSelectableManualVariableKeys();
    const nextSelection = Array.from(new Set([...selectedManualKeys, ...selectableManualKeys]));

    if (nextSelection.length !== selectedManualKeys.length) {
      this.manualVariablesSelectControl.setValue(nextSelection);
    }
  }

  clearManualVariables(): void {
    if (this.hasManualVariablesSelected()) {
      this.manualVariablesSelectControl.setValue([]);
    }
  }

  addVariable(variableId: string = '', unitId: string = '', sampleCount?: number, bundleId?: number, bundleName?: string, skipUpdate = false, bundleCaseOrderingMode?: 'continuous' | 'alternating'): void {
    const variableData = this.getAvailableVariable(unitId, variableId);
    const maxAvailable = variableData ? this.getEffectiveAvailableCount(unitId, variableId) : 1000;
    const defaultSampleCount = sampleCount !== undefined ? sampleCount : maxAvailable;

    const variableGroup = this.fb.group({
      variableId: [variableId, [Validators.required]],
      unitId: [unitId, [Validators.required]],
      sampleCount: [defaultSampleCount, [Validators.required, Validators.min(1), Validators.max(maxAvailable)]],
      bundleId: [bundleId],
      bundleName: [bundleName],
      overlapWarning: [false],
      bundleCaseOrderingMode: [bundleCaseOrderingMode || null]
    });

    this.variablesFormArray.push(variableGroup);
    if (!skipUpdate) {
      this.updateGroupedVariables();
    }
  }

  onVariableChange(variableId: string, index: number): void {
    const control = this.variablesFormArray.at(index);
    const selectedVariable = this.availableVariables.find(v => v.variableId === variableId);
    if (selectedVariable) {
      control.get('unitId')?.setValue(selectedVariable.unitName);
      control.get('unitId')?.updateValueAndValidity();
    }
    this.checkForOverlaps();
  }

  removeVariable(index: number, skipUpdate = false): void {
    this.variablesFormArray.removeAt(index);
    if (!skipUpdate) {
      this.updateGroupedVariables();
    }
  }

  loadCoders(): void {
    this.coderService.getCoders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (coders: Coder[]) => {
          this.coders = coders;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.showError('Fehler beim Laden der Kodierer');
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  addBundleVariables(bundleId: number, sampleCount?: number | string, caseOrderingMode?: 'continuous' | 'alternating', silent = false): void {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    if (!bundle) {
      this.showError('Variablenbündel nicht gefunden');
      return;
    }

    if (bundle.variables.length === 0) {
      this.showError('Das gewählte Variablenbündel enthält keine Variablen');
      return;
    }

    const sampleCountNum = sampleCount !== undefined ? Number(sampleCount) : undefined;
    if (sampleCountNum !== undefined && (Number.isNaN(sampleCountNum) || sampleCountNum < 1 || sampleCountNum > 1000)) {
      this.showError('Ungültige Stichprobenanzahl. Muss zwischen 1 und 1000 liegen.');
      return;
    }

    let addedCount = 0;
    const duplicateVariables: string[] = [];
    const effectiveCaseOrderingMode = caseOrderingMode || bundle.caseOrderingMode || this.trainingForm.get('caseOrderingMode')?.value || 'continuous';

    const variablesToAdd = this.includeDerivedVariables ?
      bundle.variables :
      bundle.variables.filter(variable => !this.isVariableDerived(variable));
    const skippedDerivedCount = bundle.variables.length - variablesToAdd.length;

    if (variablesToAdd.length === 0) {
      this.showError(`Das Variablenbündel "${bundle.name}" enthält nur abgeleitete Variablen. Aktivieren Sie „abgeleitete Variablen einbeziehen“, um es zu verwenden.`);
      return;
    }

    variablesToAdd.forEach(variable => {
      if (this.isVariableAlreadyAdded(variable)) {
        duplicateVariables.push(`${variable.unitName} - ${variable.variableId}`);
      } else {
        this.addVariable(variable.variableId, variable.unitName, sampleCountNum, bundle.id, bundle.name, false, effectiveCaseOrderingMode);
        addedCount += 1;
      }
    });

    if (addedCount > 0 && !silent) {
      const skippedText = skippedDerivedCount > 0 ? ` (${skippedDerivedCount} abgeleitete ausgelassen)` : '';
      this.showSuccess(`${addedCount} Variable(n) aus Variablenbündel "${bundle.name}" hinzugefügt${skippedText}`);
    }

    if (duplicateVariables.length > 0 && !silent) {
      this.showError(`${duplicateVariables.length} Variable(n) waren bereits hinzugefügt: ${duplicateVariables.join(', ')}`);
    }

    bundle.caseOrderingMode = effectiveCaseOrderingMode;

    this.checkForOverlaps();
  }

  private isVariableAlreadyAdded(variable: { unitName: string; variableId: string }): boolean {
    return this.variablesFormArray.controls.some(control => {
      const existingVariableId = control.get('variableId')?.value;
      const existingUnitId = control.get('unitId')?.value;
      return existingVariableId === variable.variableId && existingUnitId === variable.unitName;
    });
  }

  onBundleSelectionChange(selectedBundleIds: number[]): void {
    if (selectedBundleIds) {
      const currentSelectedIds = Array.from(this.selectedBundleIds);
      const newBundleIds = selectedBundleIds.filter(id => !this.selectedBundleIds.has(id));
      const removedBundleIds = currentSelectedIds.filter(id => !selectedBundleIds.includes(id));

      newBundleIds.forEach(bundleId => {
        const defaultMode = this.trainingForm.get('caseOrderingMode')?.value || 'continuous';
        this.addBundleVariables(bundleId, undefined, defaultMode);
        if (this.variablesFormArray.controls.some(control => control.get('bundleId')?.value === bundleId)) {
          this.selectedBundleIds.add(bundleId);
        }
      });

      removedBundleIds.forEach(bundleId => {
        this.removeBundle(bundleId);
      });

      this.bundleSelection$.next(Array.from(this.selectedBundleIds));
    }
  }

  onVariablesSelectionChange(selectedVarKeys: string[]): void {
    const currentManualKeys = this.variablesFormArray.controls
      .filter(c => !c.get('bundleId')?.value)
      .map(c => `${c.get('unitId')?.value}::${c.get('variableId')?.value}`)
      .filter(key => key !== '::');

    const newKeys = selectedVarKeys.filter(key => !currentManualKeys.includes(key));
    const removedKeys = currentManualKeys.filter(key => !selectedVarKeys.includes(key));

    if (newKeys.length === 0 && removedKeys.length === 0) {
      return;
    }

    newKeys.forEach(key => {
      const [unitId, variableId] = key.split('::');
      if (unitId && variableId && (this.includeDerivedVariables || !this.isDerivedVariableKey(unitId, variableId))) {
        this.addVariable(variableId, unitId, undefined, undefined, undefined, true);
      }
    });

    removedKeys.forEach(key => {
      const [unitId, variableId] = key.split('::');
      const index = this.variablesFormArray.controls.findIndex(c => !c.get('bundleId')?.value &&
        c.get('variableId')?.value === variableId &&
        c.get('unitId')?.value === unitId
      );
      if (index !== -1) {
        this.removeVariable(index, true);
      }
    });

    this.updateGroupedVariables();
    this.checkForOverlaps();
  }

  get selectedManualVariableIds(): string[] {
    return this.variablesFormArray.controls
      .filter(c => !c.get('bundleId')?.value)
      .map(c => c.get('variableId')?.value as string)
      .filter(id => !!id);
  }

  removeBundle(bundleId: number): void {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    if (!bundle) return;

    const variablesToRemove: number[] = [];
    this.variablesFormArray.controls.forEach((control, index) => {
      if (control.get('bundleId')?.value === bundleId) {
        variablesToRemove.push(index);
      }
    });

    variablesToRemove.reverse().forEach(index => {
      this.variablesFormArray.removeAt(index);
    });

    this.selectedBundleIds.delete(bundleId);
    this.bundleSelection$.next(Array.from(this.selectedBundleIds));
    this.updateGroupedVariables();
    this.showSuccess(`Variablenbündel "${bundle.name}" entfernt.`);
    this.checkForOverlaps();
  }

  toggleCoderSelection(coder: Coder): void {
    if (this.selectedCoders.has(coder.id)) {
      this.selectedCoders.delete(coder.id);
    } else {
      this.selectedCoders.add(coder.id);
    }
    this.changeDetectorRef.markForCheck();
  }

  isCoderSelected(coder: Coder): boolean {
    return this.selectedCoders.has(coder.id);
  }

  selectAllCoders(): void {
    this.coders.forEach(coder => this.selectedCoders.add(coder.id));
    this.changeDetectorRef.markForCheck();
  }

  deselectAllCoders(): void {
    this.selectedCoders.clear();
    this.changeDetectorRef.markForCheck();
  }

  getSelectedCoders(): Coder[] {
    return this.coders.filter(coder => this.selectedCoders.has(coder.id));
  }

  canStartTraining(): boolean {
    return this.hasTrainingLabel() &&
      this.hasSelectedCoders() &&
      this.trainingForm.valid &&
      this.hasVariableSelection() &&
      this.hasValidReferenceMode() &&
      this.hasValidCaseCounts();
  }

  hasTrainingLabel(): boolean {
    const trainingLabel = this.trainingForm.get('trainingLabel')?.value;
    return typeof trainingLabel === 'string' && trainingLabel.trim().length > 0;
  }

  hasSelectedCoders(): boolean {
    return this.selectedCoders.size > 0;
  }

  hasVariableSelection(): boolean {
    return this.getSelectedVariablesCount() > 0;
  }

  hasValidReferenceMode(): boolean {
    const referenceTrainingIds = (this.trainingForm.get('referenceTrainingIds')?.value as number[]) || [];
    return referenceTrainingIds.length === 0 || !!this.trainingForm.get('referenceMode')?.value;
  }

  hasValidCaseCounts(): boolean {
    return this.variablesFormArray.controls.every(control => control.get('sampleCount')?.valid !== false) &&
      !this.hasAnyInsufficientCases();
  }

  getValidationItems(): ValidationItem[] {
    return [
      { label: 'Schulungs-Bezeichnung ausgefüllt', valid: this.hasTrainingLabel() },
      { label: 'Mindestens ein Kodierer ausgewählt', valid: this.hasSelectedCoders() },
      { label: 'Mindestens eine Variable ausgewählt', valid: this.hasVariableSelection() },
      { label: 'Vergleichsmodus gewählt, wenn Vergleichsschulungen gesetzt sind', valid: this.hasValidReferenceMode() },
      { label: 'Stichproben pro Variable liegen innerhalb verfügbarer Fälle', valid: this.hasValidCaseCounts() }
    ];
  }

  getFirstValidationMessage(): string {
    const firstInvalidItem = this.getValidationItems().find(item => !item.valid);
    return firstInvalidItem ? firstInvalidItem.label : 'Bitte prüfen Sie die Schulungseinstellungen.';
  }

  private hasAnyInsufficientCases(): boolean {
    return this.variablesFormArray.controls.some(control => {
      const unitId = control.get('unitId')?.value;
      const variableId = control.get('variableId')?.value;
      const requestedCount = control.get('sampleCount')?.value || 0;
      const variableData = this.getAvailableVariable(unitId, variableId);
      const effectiveCount = this.getEffectiveAvailableCount(unitId, variableId);
      return !!variableData && effectiveCount < requestedCount;
    });
  }

  hasAtLeastOneVariableSelected(): boolean {
    return this.hasVariableSelection();
  }

  getManualVariablesCount(): number {
    return this.groupedVariables.manual.length;
  }

  getBundleVariablesCount(): number {
    return this.groupedVariables.bundles.reduce((total, bundleGroup) => total + bundleGroup.variables.length, 0);
  }

  getSelectedVariablesCount(): number {
    return this.variablesFormArray.controls.filter(control => {
      const variableId = control.get('variableId')?.value;
      return typeof variableId === 'string' && variableId.trim() !== '';
    }).length;
  }

  getSelectedBundleCount(): number {
    return this.groupedVariables.bundles.length;
  }

  getTotalSamples(): number {
    return this.variablesFormArray.controls.reduce((total, control) => total + (Number(control.get('sampleCount')?.value) || 0), 0);
  }

  isVariableSelected(variableId: string): boolean {
    return this.variablesFormArray.controls.some(control => control.get('variableId')?.value === variableId);
  }

  private checkForOverlaps(): void {
    const bundleVariables = new Set<string>();

    this.variablesFormArray.controls.forEach(control => {
      if (control.get('bundleId')?.value) {
        const varId = control.get('variableId')?.value;
        const unitId = control.get('unitId')?.value;
        if (varId && unitId) {
          bundleVariables.add(`${unitId}::${varId}`);
        }
      }
    });

    this.variablesFormArray.controls.forEach(control => {
      if (!control.get('bundleId')?.value) {
        const varId = control.get('variableId')?.value;
        const unitId = control.get('unitId')?.value;
        const key = `${unitId}::${varId}`;
        const isOverlapping = bundleVariables.has(key);

        const currentWarning = control.get('overlapWarning')?.value;
        if (currentWarning !== isOverlapping) {
          control.get('overlapWarning')?.setValue(isOverlapping);
        }
      }
    });

    this.updateGroupedVariables();
  }

  get selectedBundleArray(): number[] {
    return Array.from(this.selectedBundleIds);
  }

  getBundleName(bundleId: number): string {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    return bundle?.name || 'Unbekannt';
  }

  onBundleRemoved(bundleId: number): void {
    this.removeBundle(bundleId);
  }

  getVariablesGroupedByBundle(): VariableGrouping {
    const manualVariables: { control: FormGroup; index: number }[] = [];
    const bundleGroups: { [bundleId: number]: { bundle: VariableBundle; variables: { control: FormGroup; index: number }[] } } = {};

    this.variablesFormArray.controls.forEach((control, index) => {
      const bundleId = control.get('bundleId')?.value;
      const bundleName = control.get('bundleName')?.value;

      if (bundleId && bundleName) {
        const bundleModeFromControl = control.get('bundleCaseOrderingMode')?.value as 'continuous' | 'alternating' | null;
        if (!bundleGroups[bundleId]) {
          const bundle = this.availableBundles.find(b => b.id === bundleId);
          bundleGroups[bundleId] = {
            bundle: {
              id: bundleId,
              name: bundleName,
              createdAt: bundle?.createdAt || new Date(),
              updatedAt: bundle?.updatedAt || new Date(),
              description: bundle?.description,
              variables: bundle?.variables || [],
              caseOrderingMode: bundleModeFromControl || bundle?.caseOrderingMode || this.trainingForm.get('caseOrderingMode')?.value || 'continuous'
            },
            variables: []
          };
        }
        if (!bundleGroups[bundleId].bundle.caseOrderingMode && bundleModeFromControl) {
          bundleGroups[bundleId].bundle.caseOrderingMode = bundleModeFromControl;
        }
        bundleGroups[bundleId].variables.push({ control: control as FormGroup, index });
      } else {
        manualVariables.push({ control: control as FormGroup, index });
      }
    });

    return {
      manual: manualVariables,
      bundles: Object.values(bundleGroups)
    };
  }

  private updateGroupedVariables(): void {
    this._groupedVariables = this.getVariablesGroupedByBundle();
    this.changeDetectorRef.markForCheck();
  }

  updateBundleSampleCount(bundleId: number, newSampleCount: number | string): void {
    const parsedSampleCount = Number(newSampleCount);
    if (Number.isNaN(parsedSampleCount) || parsedSampleCount < 1 || parsedSampleCount > 1000) {
      this.showError('Ungültige Stichprobenanzahl. Muss zwischen 1 und 1000 liegen.');
      return;
    }

    this.variablesFormArray.controls.forEach(control => {
      if (control.get('bundleId')?.value === bundleId) {
        control.get('sampleCount')?.setValue(parsedSampleCount);
      }
    });

    this.updateGroupedVariables();
    this.changeDetectorRef.markForCheck();
  }

  getBundleSampleCount(bundleId: number): number {
    const firstVariable = this.variablesFormArray.controls.find(control => control.get('bundleId')?.value === bundleId);
    return firstVariable?.get('sampleCount')?.value || 10;
  }

  updateBundleCaseOrderingMode(bundleId: number, mode: 'continuous' | 'alternating'): void {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    if (bundle) {
      bundle.caseOrderingMode = mode;
    }
    this.variablesFormArray.controls.forEach(control => {
      if (control.get('bundleId')?.value === bundleId) {
        control.get('bundleCaseOrderingMode')?.setValue(mode, { emitEvent: false });
      }
    });
    this.updateGroupedVariables();
    this.changeDetectorRef.markForCheck();
  }

  hasInsufficientCases(bundleGroup: { variables: { control: FormGroup }[] }): boolean {
    if (bundleGroup.variables.length === 0) return false;
    const requestedCount = bundleGroup.variables[0].control.get('sampleCount')?.value || 0;

    return bundleGroup.variables.some(v => {
      const unitId = v.control.get('unitId')?.value;
      const variableId = v.control.get('variableId')?.value;
      const variableData = this.getAvailableVariable(unitId, variableId);
      const effectiveCount = this.getEffectiveAvailableCount(unitId, variableId);
      return !!variableData && effectiveCount < requestedCount;
    });
  }

  isManualVariableInsufficient(item: { control: FormGroup }): boolean {
    const unitId = item.control.get('unitId')?.value;
    const variableId = item.control.get('variableId')?.value;
    const requestedCount = item.control.get('sampleCount')?.value || 0;
    const variableData = this.getAvailableVariable(unitId, variableId);
    const effectiveCount = this.getEffectiveAvailableCount(unitId, variableId);
    return !!variableData && effectiveCount < requestedCount;
  }

  getAvailableCount(item: { control: FormGroup }): number {
    const unitId = item.control.get('unitId')?.value;
    const variableId = item.control.get('variableId')?.value;
    return this.getEffectiveAvailableCount(unitId, variableId);
  }

  private getEffectiveAvailableCount(unitId: string | undefined, variableId: string | undefined): number {
    const variableData = this.getAvailableVariable(unitId, variableId);
    return variableData?.uniqueCasesAfterAggregation ?? variableData?.responseCount ?? 0;
  }

  private getAvailableVariable(unitId: string | undefined, variableId: string | undefined): Variable | undefined {
    return this.availableVariables.find(avail => avail.unitName === unitId && avail.variableId === variableId);
  }

  getBundleOrderingOverrides(): BundleOrderingOverride[] {
    const globalMode = (this.trainingForm.get('caseOrderingMode')?.value || 'continuous') as 'continuous' | 'alternating';
    return this.groupedVariables.bundles
      .map(bundleGroup => ({
        name: bundleGroup.bundle.name,
        mode: (bundleGroup.bundle.caseOrderingMode || globalMode) as 'continuous' | 'alternating'
      }))
      .filter(bundle => bundle.mode !== globalMode)
      .map(bundle => ({
        name: bundle.name,
        label: this.getCaseOrderingModeLabel(bundle.mode)
      }));
  }

  hasBundleOrderingOverrides(): boolean {
    return this.getBundleOrderingOverrides().length > 0;
  }

  getBundleOrderingDetails(): string {
    return this.getBundleOrderingOverrides()
      .map(bundle => `${bundle.name}: ${bundle.label}`)
      .join(', ');
  }

  trackByCoderId(index: number, coder: Coder): number {
    return coder.id;
  }

  onStartTraining(): void {
    if (!this.canStartTraining()) {
      this.showError(this.getFirstValidationMessage());
      return;
    }

    this.isLoading = true;
    const selectedCoders = this.getSelectedCoders();
    const variableConfigs: VariableConfig[] = this.variablesFormArray.controls.map(control => {
      const variableId = control.get('variableId')?.value || '';
      return {
        variableId,
        unitId: control.get('unitId')?.value || '',
        sampleCount: control.get('sampleCount')?.value || 10
      };
    });

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('Kein Arbeitsbereich ausgewählt');
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    const trainingLabel = this.trainingForm.get('trainingLabel')?.value || '';

    const assignedVariables: { unitName: string; variableId: string; sampleCount: number }[] =
      this.variablesFormArray.controls
        .filter(c => !c.get('bundleId')?.value)
        .map(c => ({
          variableId: c.get('variableId')?.value,
          unitName: c.get('unitId')?.value,
          sampleCount: c.get('sampleCount')?.value
        }));

    const assignedVariableBundles: { id: number; name: string; sampleCount: number; caseOrderingMode?: 'continuous' | 'alternating' }[] = [];
    const seenBundleIds = new Set<number>();
    this.variablesFormArray.controls.forEach(c => {
      const bundleId = c.get('bundleId')?.value;
      if (bundleId && !seenBundleIds.has(bundleId)) {
        seenBundleIds.add(bundleId);
        const bundle = this.availableBundles.find(b => b.id === bundleId);
        const bundleCaseOrderingMode = c.get('bundleCaseOrderingMode')?.value || bundle?.caseOrderingMode;
        assignedVariableBundles.push({
          id: bundleId,
          name: c.get('bundleName')?.value,
          sampleCount: c.get('sampleCount')?.value || 10,
          caseOrderingMode: bundleCaseOrderingMode || this.trainingForm.get('caseOrderingMode')?.value || 'continuous'
        });
      }
    });

    const caseOrderingMode = this.trainingForm.get('caseOrderingMode')?.value || 'continuous';
    const caseSelectionMode = this.trainingForm.get('caseSelectionMode')?.value as CaseSelectionMode || 'oldest_first';
    const referenceTrainingIds = (this.trainingForm.get('referenceTrainingIds')?.value as number[]) || [];
    const referenceMode = this.trainingForm.get('referenceMode')?.value as ReferenceMode | null;

    const request$ = this.isEditMode ?
      this.codingTrainingBackendService.updateCoderTraining(
        workspaceId,
        this.editTraining!.id,
        trainingLabel,
        selectedCoders,
        variableConfigs,
        undefined,
        assignedVariables,
        assignedVariableBundles,
        caseOrderingMode,
        caseSelectionMode,
        referenceTrainingIds.length ? referenceTrainingIds : undefined,
        referenceMode ?? undefined
      ) :
      this.codingTrainingBackendService.createCoderTrainingJobs(
        workspaceId,
        selectedCoders,
        variableConfigs,
        trainingLabel,
        undefined,
        assignedVariables,
        assignedVariableBundles,
        caseOrderingMode,
        caseSelectionMode,
        referenceTrainingIds.length ? referenceTrainingIds : undefined,
        referenceMode ?? undefined
      );

    request$.subscribe({
      next: (result: { success: boolean; message: string; jobsCreated?: number; jobs?: unknown[] }) => {
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
        if (result.success) {
          let translatedMessage: string;
          if (result.message) {
            translatedMessage = this.backendMessageTranslator.translateMessage(result.message);
          } else if (this.isEditMode) {
            translatedMessage = 'Training erfolgreich aktualisiert';
          } else {
            translatedMessage = `Erfolgreich ${result.jobsCreated} Kodierungsaufträge für ${selectedCoders.length} Kodierer erstellt`;
          }

          this.showSuccess(translatedMessage);
          this.startTraining.emit({ selectedCoders, variableConfigs });
          this.onClose();
        } else {
          const translatedError = result.message ?
            this.backendMessageTranslator.translateMessage(result.message) :
            'Fehler beim Speichern der Kodierungsaufträge';
          this.showError(translatedError);
        }
      },
      error: () => {
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
        this.showError('Fehler beim Speichern der Kodierungsaufträge');
      }
    });
  }

  onClose(): void {
    this.close.emit();
  }

  openImportDialog(): void {
    const dialogRef = this.dialog.open(JobDefinitionSelectionDialogComponent, {
      width: '1200px',
      height: '80vh',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.jobDefinition) {
        this.importJobDefinitionSelections(result.jobDefinition, result.defaultSampleCount);
      }
    });
  }

  private importJobDefinitionSelections(jobDef: JobDefinition, defaultSampleCount: number): void {
    let varsAdded = 0;
    let bundlesAdded = 0;

    if (jobDef.assignedVariables && jobDef.assignedVariables.length > 0) {
      jobDef.assignedVariables.forEach((v: Variable) => {
        if (!this.includeDerivedVariables && this.isVariableDerived(v)) {
          return;
        }

        const isAlreadyAdded = this.variablesFormArray.controls.some(c => !c.get('bundleId')?.value &&
          c.get('variableId')?.value === v.variableId &&
          c.get('unitId')?.value === v.unitName
        );
        if (!isAlreadyAdded) {
          const sampleCount = v.casesInJobs ?? defaultSampleCount;
          this.addVariable(v.variableId, v.unitName, sampleCount, undefined, undefined, true);
          varsAdded += 1;
        }
      });
    }

    if (jobDef.assignedVariableBundles && jobDef.assignedVariableBundles.length > 0) {
      const currentSelectedIds = Array.from(this.selectedBundleIds);
      jobDef.assignedVariableBundles.forEach((b: VariableBundle) => {
        if (!currentSelectedIds.includes(b.id)) {
          this.addBundleVariables(b.id, defaultSampleCount, b.caseOrderingMode);
          if (this.variablesFormArray.controls.some(control => control.get('bundleId')?.value === b.id)) {
            this.selectedBundleIds.add(b.id);
            bundlesAdded += 1;
          }
        }
      });
      this.bundleSelection$.next(Array.from(this.selectedBundleIds));
    }

    this.updateGroupedVariables();
    this.checkForOverlaps();

    if (varsAdded > 0 || bundlesAdded > 0) {
      this.showSuccess(`${varsAdded} Variable(n) und ${bundlesAdded} Bündel hinzugefügt.`);
    } else {
      this.showSuccess('Alle Variablen und Bündel waren bereits vorhanden.');
    }
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }
}
