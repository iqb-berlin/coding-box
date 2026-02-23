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
import { CoderService } from '../../services/coder.service';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { Coder } from '../../models/coder.model';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { AppService } from '../../../core/services/app.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { CoderTraining } from '../../models/coder-training.model';

export interface VariableConfig {
  variableId: string;
  unitId: string;
  sampleCount: number;
}

export interface VariableGrouping {
  manual: { control: FormGroup; index: number }[];
  bundles: { bundle: VariableBundle; variables: { control: FormGroup; index: number }[] }[];
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
    MatHint
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
      variables: this.fb.array([])
    });

    // Initialize grouped variables
    this.updateGroupedVariables();
    this.setupFilters();
    this.setupManualSelectSync();
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
      this._availableVariables$
    ]).pipe(
      map(([filter, selectedBundleIds, , availableVariables]) => {
        const search = (filter || '').toLowerCase();

        const variablesInBundles = new Set<string>();
        selectedBundleIds.forEach(bundleId => {
          const bundle = this.availableBundles.find(b => b.id === bundleId);
          if (bundle) {
            bundle.variables.forEach(v => {
              variablesInBundles.add(`${v.unitName}::${v.variableId}`);
            });
          }
        });

        return availableVariables.filter(v => {
          const matchesSearch = v.variableId.toLowerCase().includes(search) ||
            v.unitName.toLowerCase().includes(search);
          const inBundle = variablesInBundles.has(`${v.unitName}::${v.variableId}`);
          return matchesSearch && !inBundle;
        });
      })
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

  ngOnInit(): void {
    this.loadCoders();
    this.loadAvailableVariables();

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
          this.addBundleVariables(b.id, sampleCount);
        }
      });
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

  addVariable(variableId: string = '', unitId: string = '', sampleCount?: number, bundleId?: number, bundleName?: string, skipUpdate = false): void {
    const variableData = this.availableVariables.find(v => v.unitName === unitId && v.variableId === variableId);
    const maxAvailable = variableData?.uniqueCasesAfterAggregation ?? variableData?.responseCount ?? 1000;
    const defaultSampleCount = sampleCount !== undefined ? sampleCount : maxAvailable;

    const variableGroup = this.fb.group({
      variableId: [variableId, [Validators.required]],
      unitId: [unitId, [Validators.required]],
      sampleCount: [defaultSampleCount, [Validators.required, Validators.min(1), Validators.max(maxAvailable)]],
      bundleId: [bundleId],
      bundleName: [bundleName],
      overlapWarning: [false]
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

  addBundleVariables(bundleId: number, sampleCount?: number | string): void {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    if (!bundle) {
      this.showError('Variable-Bundle nicht gefunden');
      return;
    }

    if (bundle.variables.length === 0) {
      this.showError('Das gewählte Variable-Bundle enthält keine Variablen');
      return;
    }

    const sampleCountNum = sampleCount !== undefined ? Number(sampleCount) : undefined;
    if (sampleCountNum !== undefined && (Number.isNaN(sampleCountNum) || sampleCountNum < 1 || sampleCountNum > 1000)) {
      this.showError('Ungültige Stichprobenanzahl. Muss zwischen 1 und 1000 liegen.');
      return;
    }

    let addedCount = 0;
    const duplicateVariables: string[] = [];

    bundle.variables.forEach(variable => {
      if (this.isVariableAlreadyAdded(variable)) {
        duplicateVariables.push(`${variable.unitName} - ${variable.variableId}`);
      } else {
        this.addVariable(variable.variableId, variable.unitName, sampleCountNum, bundle.id, bundle.name);
        addedCount += 1;
      }
    });

    if (addedCount > 0) {
      this.showSuccess(`${addedCount} Variable(n) aus Bundle "${bundle.name}" hinzugefügt`);
    }

    if (duplicateVariables.length > 0) {
      this.showError(`${duplicateVariables.length} Variable(n) waren bereits hinzugefügt: ${duplicateVariables.join(', ')}`);
    }

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
        this.addBundleVariables(bundleId);
        this.selectedBundleIds.add(bundleId);
      });

      removedBundleIds.forEach(bundleId => {
        this.removeBundle(bundleId);
      });

      this.bundleSelection$.next(selectedBundleIds);
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
      if (unitId && variableId) {
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
    const trainingLabel = this.trainingForm.get('trainingLabel')?.value;
    return this.selectedCoders.size > 0 &&
      trainingLabel?.trim() &&
      this.trainingForm.valid &&
      (this.hasAtLeastOneVariableSelected() || this.hasBundlesSelected()) &&
      !this.hasAnyInsufficientCases();
  }

  private hasAnyInsufficientCases(): boolean {
    return this.variablesFormArray.controls.some(control => {
      const unitId = control.get('unitId')?.value;
      const variableId = control.get('variableId')?.value;
      const requestedCount = control.get('sampleCount')?.value || 0;
      const variableData = this.availableVariables.find(v => v.unitName === unitId && v.variableId === variableId);
      return variableData && (variableData.responseCount || 0) < requestedCount;
    });
  }

  private hasBundlesSelected(): boolean {
    return this.selectedBundleIds.size > 0;
  }

  hasAtLeastOneVariableSelected(): boolean {
    return this.variablesFormArray.controls.some(control => {
      const variableId = control.get('variableId')?.value;
      return variableId && variableId.trim() !== '';
    });
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
        if (!bundleGroups[bundleId]) {
          const bundle = this.availableBundles.find(b => b.id === bundleId);
          bundleGroups[bundleId] = {
            bundle: {
              id: bundleId,
              name: bundleName,
              createdAt: bundle?.createdAt || new Date(),
              updatedAt: bundle?.updatedAt || new Date(),
              description: bundle?.description,
              variables: bundle?.variables || []
            },
            variables: []
          };
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

  updateBundleSampleCount(bundleId: number, newSampleCount: number): void {
    if (Number.isNaN(newSampleCount) || newSampleCount < 1 || newSampleCount > 1000) {
      this.showError('Ungültige Stichprobenanzahl. Muss zwischen 1 und 1000 liegen.');
      return;
    }

    this.variablesFormArray.controls.forEach(control => {
      if (control.get('bundleId')?.value === bundleId) {
        control.get('sampleCount')?.setValue(newSampleCount);
      }
    });

    this.changeDetectorRef.markForCheck();
  }

  getBundleSampleCount(bundleId: number): number {
    const firstVariable = this.variablesFormArray.controls.find(control => control.get('bundleId')?.value === bundleId);
    return firstVariable?.get('sampleCount')?.value || 10;
  }

  hasInsufficientCases(bundleGroup: { variables: { control: FormGroup }[] }): boolean {
    if (bundleGroup.variables.length === 0) return false;
    const requestedCount = bundleGroup.variables[0].control.get('sampleCount')?.value || 0;

    return bundleGroup.variables.some(v => {
      const unitId = v.control.get('unitId')?.value;
      const variableId = v.control.get('variableId')?.value;
      const variableData = this.availableVariables.find(avail => avail.unitName === unitId && avail.variableId === variableId);
      const effectiveCount = variableData?.uniqueCasesAfterAggregation ?? variableData?.responseCount ?? 0;
      return variableData && effectiveCount < requestedCount;
    });
  }

  isManualVariableInsufficient(item: { control: FormGroup }): boolean {
    const unitId = item.control.get('unitId')?.value;
    const variableId = item.control.get('variableId')?.value;
    const requestedCount = item.control.get('sampleCount')?.value || 0;
    const variableData = this.availableVariables.find(avail => avail.unitName === unitId && avail.variableId === variableId);
    const effectiveCount = variableData?.uniqueCasesAfterAggregation ?? variableData?.responseCount ?? 0;
    return !!variableData && effectiveCount < requestedCount;
  }

  getAvailableCount(item: { control: FormGroup }): number {
    const unitId = item.control.get('unitId')?.value;
    const variableId = item.control.get('variableId')?.value;
    const variableData = this.availableVariables.find(avail => avail.unitName === unitId && avail.variableId === variableId);
    return variableData?.uniqueCasesAfterAggregation ?? variableData?.responseCount ?? 0;
  }

  trackByCoderId(index: number, coder: Coder): number {
    return coder.id;
  }

  onStartTraining(): void {
    if (!this.canStartTraining()) {
      this.showError('Bitte wählen Sie mindestens einen Kodierer aus und konfigurieren Sie die Variablen');
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

    const assignedVariableBundles: { id: number; name: string; sampleCount: number }[] = [];
    const seenBundleIds = new Set<number>();
    this.variablesFormArray.controls.forEach(c => {
      const bundleId = c.get('bundleId')?.value;
      if (bundleId && !seenBundleIds.has(bundleId)) {
        seenBundleIds.add(bundleId);
        assignedVariableBundles.push({
          id: bundleId,
          name: c.get('bundleName')?.value,
          sampleCount: c.get('sampleCount')?.value || 10
        });
      }
    });

    const request$ = this.isEditMode ?
      this.codingTrainingBackendService.updateCoderTraining(
        workspaceId,
        this.editTraining!.id,
        trainingLabel,
        selectedCoders,
        variableConfigs,
        undefined,
        assignedVariables,
        assignedVariableBundles
      ) :
      this.codingTrainingBackendService.createCoderTrainingJobs(
        workspaceId,
        selectedCoders,
        variableConfigs,
        trainingLabel,
        undefined,
        assignedVariables,
        assignedVariableBundles
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
