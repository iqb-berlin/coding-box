import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
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
  FormArray
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { CoderService } from '../../services/coder.service';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { Coder } from '../../models/coder.model';
import { VariableBundle } from '../../models/coding-job.model';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

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

  private destroy$ = new Subject<void>();
  private changeDetectorRef = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);
  private coderService = inject(CoderService);
  private variableBundleService = inject(VariableBundleService);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private fb = inject(FormBuilder);

  // Cached grouped variables data
  private _groupedVariables: VariableGrouping = { manual: [], bundles: [] };

  // Public getters for template access
  get groupedVariables(): VariableGrouping {
    return this._groupedVariables;
  }

  coders: Coder[] = [];
  selectedCoders: Set<number> = new Set();
  availableVariables: { unitName: string; variableId: string }[] = [];
  availableBundles: VariableBundle[] = [];
  selectedBundleIds: Set<number> = new Set();
  availableMissingsProfiles: { label: string; id: number }[] = [];
  isLoading = false;
  isLoadingVariables = false;
  isLoadingBundles = false;
  isLoadingMissingsProfiles = false;

  trainingForm: FormGroup;

  constructor() {
    this.trainingForm = this.fb.group({
      trainingLabel: ['', [Validators.required]],
      missingsProfileId: [null],
      variables: this.fb.array([])
    });

    // Initialize grouped variables
    this.updateGroupedVariables();
  }

  ngOnInit(): void {
    this.loadCoders();
    this.loadAvailableVariables();
    this.loadVariableBundles();
    this.loadMissingsProfiles();
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
      return;
    }

    this.backendService.getCodingIncompleteVariables(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: variables => {
          this.availableVariables = variables;
          this.isLoadingVariables = false;
          if (variables.length === 0) {
            this.addVariable();
          }
        },
        error: () => {
          this.showError('Fehler beim Laden der verfügbaren Variablen');
          this.isLoadingVariables = false;
          this.addVariable();
        }
      });
  }

  addVariable(variableId: string = '', unitId: string = '', sampleCount: number = 10, bundleId?: number, bundleName?: string): void {
    const variableGroup = this.fb.group({
      variableId: [variableId, [Validators.required]],
      unitId: [unitId, [Validators.required]],
      sampleCount: [sampleCount, [Validators.required, Validators.min(1), Validators.max(1000)]],
      bundleId: [bundleId],
      bundleName: [bundleName]
    });

    this.variablesFormArray.push(variableGroup);
    this.updateGroupedVariables();
  }

  onVariableChange(variableId: string, index: number): void {
    const control = this.variablesFormArray.at(index);
    const selectedVariable = this.availableVariables.find(v => v.variableId === variableId);
    if (selectedVariable) {
      control.get('unitId')?.setValue(selectedVariable.unitName);
      // Force validation update for the changed control
      control.get('unitId')?.updateValueAndValidity();
    }
  }

  removeVariable(index: number): void {
    if (this.variablesFormArray.length > 1) {
      this.variablesFormArray.removeAt(index);
    } else {
      this.showError('Mindestens eine Variable ist erforderlich');
    }
    this.updateGroupedVariables();
  }

  loadCoders(): void {
    this.isLoading = true;
    this.coderService.getCoders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (coders: Coder[]) => {
          this.coders = coders;
          this.isLoading = false;
        },
        error: () => {
          this.showError('Fehler beim Laden der Kodierer');
          this.isLoading = false;
        }
      });
  }

  private loadMissingsProfiles(): void {
    this.isLoadingMissingsProfiles = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError('Kein Arbeitsbereich ausgewählt');
      this.isLoadingMissingsProfiles = false;
      return;
    }

    this.backendService.getMissingsProfiles(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: profiles => {
          this.availableMissingsProfiles = profiles;
          this.isLoadingMissingsProfiles = false;
        },
        error: () => {
          this.showError('Fehler beim Laden der Missings-Profile');
          this.isLoadingMissingsProfiles = false;
        }
      });
  }

  private loadVariableBundles(): void {
    this.isLoadingBundles = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError('Kein Arbeitsbereich ausgewählt');
      this.isLoadingBundles = false;
      return;
    }

    this.variableBundleService.getBundles(1, 100) // Load all bundles with reasonable limit
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ bundles }) => {
          this.availableBundles = bundles;
          this.isLoadingBundles = false;
        },
        error: () => {
          this.showError('Fehler beim Laden der Variable-Bundles');
          this.isLoadingBundles = false;
        }
      });
  }

  addBundleVariables(bundleId: number, sampleCount: number | string = 10): void {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    if (!bundle) {
      this.showError('Variable-Bundle nicht gefunden');
      return;
    }

    if (bundle.variables.length === 0) {
      this.showError('Das gewählte Variable-Bundle enthält keine Variablen');
      return;
    }

    const sampleCountNum = Number(sampleCount);
    if (Number.isNaN(sampleCountNum) || sampleCountNum < 1 || sampleCountNum > 1000) {
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
      this.showSuccess(`${addedCount} Variable(n) aus Bundle "${bundle.name}" mit je ${sampleCountNum} Stichproben hinzugefügt`);
    }

    if (duplicateVariables.length > 0) {
      this.showError(`${duplicateVariables.length} Variable(n) waren bereits hinzugefügt: ${duplicateVariables.join(', ')}`);
    }
  }

  private isVariableAlreadyAdded(variable: { unitName: string; variableId: string }): boolean {
    return this.variablesFormArray.controls.some(control => {
      const existingVariableId = control.get('variableId')?.value;
      const existingUnitId = control.get('unitId')?.value;
      return existingVariableId === variable.variableId && existingUnitId === variable.unitName;
    });
  }

  onBundleSelectionChange(selectedBundleIds: number[]): void {
    if (selectedBundleIds && selectedBundleIds.length > 0) {
      const newBundleIds = selectedBundleIds.filter(id => !this.selectedBundleIds.has(id));

      newBundleIds.forEach(bundleId => {
        if (!this.selectedBundleIds.has(bundleId)) {
          this.addBundleVariables(bundleId, 10); // Add with default sample count of 10
          this.selectedBundleIds.add(bundleId);
        }
      });
    }

    const removedBundleIds = Array.from(this.selectedBundleIds).filter(id => !selectedBundleIds.includes(id));

    removedBundleIds.forEach(bundleId => {
      this.removeBundle(bundleId);
    });
  }

  removeBundle(bundleId: number): void {
    const bundle = this.availableBundles.find(b => b.id === bundleId);
    if (!bundle) {
      return;
    }

    const variablesToRemove: number[] = [];

    this.variablesFormArray.controls.forEach((control, index) => {
      const variableId = control.get('variableId')?.value;
      const unitId = control.get('unitId')?.value;

      if (variableId && unitId) {
        const variableExistsInBundle = bundle.variables.some(v => v.variableId === variableId && v.unitName === unitId
        );

        if (variableExistsInBundle) {
          variablesToRemove.push(index);
        }
      }
    });

    variablesToRemove.reverse().forEach(index => {
      this.variablesFormArray.removeAt(index);
    });

    this.selectedBundleIds.delete(bundleId);

    if (this.variablesFormArray.length === 0) {
      this.addVariable();
    }

    this.updateGroupedVariables();
    this.showSuccess(`Bundle "${bundle.name}" entfernt. ${variablesToRemove.length} Variable(n) wurden entfernt.`);
  }

  toggleCoderSelection(coder: Coder): void {
    if (this.selectedCoders.has(coder.id)) {
      this.selectedCoders.delete(coder.id);
    } else {
      this.selectedCoders.add(coder.id);
    }
  }

  isCoderSelected(coder: Coder): boolean {
    return this.selectedCoders.has(coder.id);
  }

  selectAllCoders(): void {
    this.coders.forEach(coder => this.selectedCoders.add(coder.id));
  }

  deselectAllCoders(): void {
    this.selectedCoders.clear();
  }

  getSelectedCoders(): Coder[] {
    return this.coders.filter(coder => this.selectedCoders.has(coder.id));
  }

  canStartTraining(): boolean {
    const trainingLabel = this.trainingForm.get('trainingLabel')?.value;
    return this.selectedCoders.size > 0 &&
           trainingLabel?.trim() &&
           this.trainingForm.valid &&
           (this.hasAtLeastOneVariableSelected() || this.hasBundlesSelected());
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
    return this.variablesFormArray.controls.reduce((total, control) => total + (control.get('sampleCount')?.value || 0), 0);
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

  getVariablesGroupedByBundle() {
    const manualVariables: FormGroup[] = [];
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
        manualVariables.push(control as FormGroup);
      }
    });

    return {
      manual: manualVariables.map((control, index) => ({ control, index })),
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

    let updatedCount = 0;
    const bundle = this.availableBundles.find(b => b.id === bundleId);

    this.variablesFormArray.controls.forEach(control => {
      const variableBundleId = control.get('bundleId')?.value;
      if (variableBundleId === bundleId) {
        control.get('sampleCount')?.setValue(newSampleCount);
        updatedCount += 1;
      }
    });

    if (bundle && updatedCount > 0) {
      this.showSuccess(`${updatedCount} Variable(n) in Bundle "${bundle.name}" wurden auf ${newSampleCount} Stichproben aktualisiert.`);
    }
  }

  getBundleSampleCount(bundleId: number): number {
    const firstVariable = this.variablesFormArray.controls.find(control => control.get('bundleId')?.value === bundleId
    );
    return firstVariable?.get('sampleCount')?.value || 10;
  }

  hasManualVariables(): boolean {
    return this._groupedVariables.manual.length > 0;
  }

  getBundleGroups(): typeof this._groupedVariables.bundles {
    return this._groupedVariables.bundles;
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
      const selectedVariable = this.availableVariables.find(v => v.variableId === variableId);
      return {
        variableId,
        unitId: selectedVariable?.unitName || '',
        sampleCount: control.get('sampleCount')?.value || 10
      };
    });

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('Kein Arbeitsbereich ausgewählt');
      this.isLoading = false;
      return;
    }

    const trainingLabel = this.trainingForm.get('trainingLabel')?.value || '';
    const missingsProfileId = this.trainingForm.get('missingsProfileId')?.value;

    this.backendService.createCoderTrainingJobs(workspaceId, selectedCoders, variableConfigs, trainingLabel, missingsProfileId)
      .subscribe({
        next: result => {
          this.isLoading = false;
          if (result.success) {
            this.showSuccess(`Erfolgreich ${result.jobsCreated} Kodierungsaufträge für ${selectedCoders.length} Kodierer erstellt`);
            this.startTraining.emit({ selectedCoders, variableConfigs });
            this.onClose();
          } else {
            this.showError(`Fehler beim Erstellen der Kodierungsaufträge: ${result.message}`);
          }
        },
        error: () => {
          this.isLoading = false;
          this.showError('Fehler beim Erstellen der Kodierungsaufträge');
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
