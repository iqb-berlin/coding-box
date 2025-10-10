import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  Output,
  EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormArray
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { CoderService } from '../../services/coder.service';
import { Coder } from '../../models/coder.model';
import { BackendService } from '../../../services/backend.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { AppService } from '../../../services/app.service';

export interface VariableConfig {
  variableName: string;
  sampleCount: number;
}

@Component({
  selector: 'coding-box-coder-training',
  standalone: true,
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
    MatProgressSpinner,
    ReactiveFormsModule,
    MatIconButton
  ],
  templateUrl: './coder-training.component.html',
  styleUrls: ['./coder-training.component.scss']
})
export class CoderTrainingComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() startTraining = new EventEmitter<{ selectedCoders: Coder[], variableConfigs: VariableConfig[] }>();

  private destroy$ = new Subject<void>();
  private snackBar = inject(MatSnackBar);
  private coderService = inject(CoderService);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private fb = inject(FormBuilder);

  coders: Coder[] = [];
  selectedCoders: Set<number> = new Set();
  availableVariables: { unitName: string; variableId: string }[] = [];
  isLoading = false;
  isLoadingVariables = false;

  trainingForm: FormGroup;

  constructor() {
    this.trainingForm = this.fb.group({
      variables: this.fb.array([])
    });
  }

  ngOnInit(): void {
    this.loadCoders();
    this.loadAvailableVariables();
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

          // Add a default variable entry if no variables are available
          if (variables.length === 0) {
            this.addVariable();
          }
        },
        error: error => {
          console.error('Error loading available variables:', error);
          this.showError('Fehler beim Laden der verfügbaren Variablen');
          this.isLoadingVariables = false;
          // Add a default variable entry on error
          this.addVariable();
        }
      });
  }

  addVariable(variableName: string = ''): void {
    const variableGroup = this.fb.group({
      variableName: [variableName, [Validators.required]],
      sampleCount: [10, [Validators.required, Validators.min(1), Validators.max(1000)]]
    });

    this.variablesFormArray.push(variableGroup);
  }

  removeVariable(index: number): void {
    if (this.variablesFormArray.length > 1) {
      this.variablesFormArray.removeAt(index);
    } else {
      this.showError('Mindestens eine Variable ist erforderlich');
    }
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
    return this.selectedCoders.size > 0 &&
           this.trainingForm.valid &&
           this.variablesFormArray.length > 0;
  }

  getTotalSamples(): number {
    return this.variablesFormArray.controls.reduce((total, control) => total + (control.get('sampleCount')?.value || 0), 0);
  }

  trackByCoderId(index: number, coder: Coder): number {
    return coder.id;
  }

  onStartTraining(): void {
    if (!this.canStartTraining()) {
      this.showError('Bitte wählen Sie mindestens einen Kodierer aus und konfigurieren Sie die Variablen');
      return;
    }

    const selectedCoders = this.getSelectedCoders();
    const variableConfigs: VariableConfig[] = this.variablesFormArray.controls.map(control => ({
      variableName: control.get('variableName')?.value || '',
      sampleCount: control.get('sampleCount')?.value || 10
    }));

    this.startTraining.emit({ selectedCoders, variableConfigs });
    this.showSuccess(`Schulung für ${selectedCoders.length} Kodierer gestartet`);
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
