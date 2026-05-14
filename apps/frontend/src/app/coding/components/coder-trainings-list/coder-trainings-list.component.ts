import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  Input,
  Output,
  EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import {
  MatDialog, MatDialogModule
} from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CaseSelectionMode, CoderTraining } from '../../models/coder-training.model';
import { AppService } from '../../../core/services/app.service';
import { CodingResultsComparisonComponent } from '../coding-results-comparison/coding-results-comparison.component';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog.component';
import { TrainingJobsDialogComponent } from './training-jobs-dialog.component';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import {
  getTrainingOptionMeta,
  normalizeTrainingLabel
} from '../../utils/coder-training-display';

interface TrainingNameFilterOption {
  label: string;
  count: number;
}

@Component({
  selector: 'coding-box-coder-trainings-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    MatButtonModule,
    MatIconModule,

    MatProgressSpinnerModule,
    MatTableModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule
  ],
  templateUrl: './coder-trainings-list.component.html',
  styleUrls: ['./coder-trainings-list.component.scss']
})
export class CoderTrainingsListComponent implements OnInit, OnDestroy {
  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private backendMessageTranslator = inject(BackendMessageTranslatorService);
  private destroy$ = new Subject<void>();

  @Input() showCreateButton = true;
  @Output() onCreateTraining = new EventEmitter<void>();
  @Output() onEditTraining = new EventEmitter<CoderTraining>(); // New

  coderTrainings: CoderTraining[] = [];
  originalData: CoderTraining[] = [];
  trainingNameFilterOptions: TrainingNameFilterOption[] = [];
  duplicateTrainingLabels = new Set<string>();
  selectedTrainingName: string | null = null;
  isLoading = false;
  displayedColumns: string[] = ['actions', 'label', 'jobsCount', 'selectionStrategy', 'created_at'];

  ngOnInit(): void {
    this.loadCoderTrainings();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCoderTrainings(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workspaceId = this.appService.selectedWorkspaceId;
      if (!workspaceId) {
        reject();
        return;
      }

      this.codingTrainingBackendService.getCoderTrainings(workspaceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (trainings: CoderTraining[]) => {
            this.originalData = trainings;
            this.rebuildTrainingNameFilterOptions();
            this.applyAllFilters();
            this.isLoading = false;
            resolve();
          },
          error: () => {
            this.coderTrainings = [];
            this.originalData = [];
            this.trainingNameFilterOptions = [];
            this.duplicateTrainingLabels.clear();
            this.isLoading = false;
            reject();
          }
        });
    });
  }

  requestFullEdit(training: CoderTraining): void {
    this.onEditTraining.emit(training);
  }

  createTraining(): void {
    this.onCreateTraining.emit();
  }

  onTrainingNameFilterChange(): void {
    this.applyAllFilters();
  }

  private applyAllFilters(): void {
    if (!this.originalData) {
      this.coderTrainings = [];
      return;
    }

    if (this.selectedTrainingName === null || this.selectedTrainingName === '') {
      this.coderTrainings = [...this.originalData];
      return;
    }

    this.coderTrainings = this.originalData.filter(training => training.label === this.selectedTrainingName);
  }

  rebuildTrainingNameFilterOptions(): void {
    const options = new Map<string, TrainingNameFilterOption>();
    const normalizedCounts = new Map<string, number>();
    this.originalData.forEach(training => {
      const current = options.get(training.label);
      if (current) {
        current.count += 1;
      } else {
        options.set(training.label, { label: training.label, count: 1 });
      }

      const normalizedLabel = normalizeTrainingLabel(training.label);
      if (normalizedLabel) {
        normalizedCounts.set(normalizedLabel, (normalizedCounts.get(normalizedLabel) || 0) + 1);
      }
    });
    this.trainingNameFilterOptions = Array.from(options.values());
    this.duplicateTrainingLabels = new Set(
      Array.from(normalizedCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([label]) => label)
    );
  }

  getTrainingNameFilterOptions(): TrainingNameFilterOption[] {
    return this.trainingNameFilterOptions;
  }

  getTrainingNameFilterLabel(option: TrainingNameFilterOption): string {
    return option.count > 1 ? `${option.label} (${option.count} Schulungen)` : option.label;
  }

  getTrainingOptionMeta(training: CoderTraining): string {
    return getTrainingOptionMeta(training, 'Job', 'Jobs');
  }

  getTrainingTableMeta(training: CoderTraining): string {
    return `ID ${training.id} · ${this.getTrainingOptionMeta(training)}`;
  }

  getTrainingActionTarget(training: CoderTraining): string {
    return `${training.label} (${this.getTrainingTableMeta(training)})`;
  }

  isDuplicateTrainingLabel(training: CoderTraining): boolean {
    return this.duplicateTrainingLabels.has(normalizeTrainingLabel(training.label));
  }

  openResultsComparison(training?: CoderTraining): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.dialog.open(CodingResultsComparisonComponent, {
      width: '95vw',
      height: '95vh',
      maxWidth: '95vw',
      maxHeight: '95vh',
      data: {
        workspaceId,
        selectedTraining: training
      }
    });
  }

  getTrainingActionAriaLabel(action: 'details' | 'compare' | 'edit' | 'delete' | 'more', training: CoderTraining): string {
    const target = this.getTrainingActionTarget(training);
    switch (action) {
      case 'details':
        return `Details anzeigen: ${target}`;
      case 'compare':
        return `Ergebnisse vergleichen: ${target}`;
      case 'edit':
        return `Schulung bearbeiten: ${target}`;
      case 'delete':
        return `Schulung löschen: ${target}`;
      case 'more':
        return `Weitere Aktionen: ${target}`;
      default:
        return target;
    }
  }

  getCaseSelectionModeLabel(mode?: CaseSelectionMode | null): string {
    switch (mode || 'oldest_first') {
      case 'oldest_first':
        return 'Älteste zuerst';
      case 'newest_first':
        return 'Neueste zuerst';
      case 'random':
        return 'Zufällig';
      case 'random_per_testgroup':
        return 'Zufällig je Testgruppe';
      case 'random_testgroups':
        return 'Zufällige Testgruppen';
      default:
        return 'Älteste zuerst';
    }
  }

  getCaseSelectionModeDescription(mode?: CaseSelectionMode | null): string {
    switch (mode || 'oldest_first') {
      case 'oldest_first':
        return 'Älteste verfügbare Fälle pro Variable';
      case 'newest_first':
        return 'Neueste verfügbare Fälle pro Variable';
      case 'random':
        return 'Zufällig aus allen verfügbaren Fällen';
      case 'random_per_testgroup':
        return 'Möglichst gleichmäßig über Testgruppen';
      case 'random_testgroups':
        return 'Erst Testgruppen, dann Fälle zufällig';
      default:
        return 'Älteste verfügbare Fälle pro Variable';
    }
  }

  getCaseOrderingModeLabel(mode?: 'continuous' | 'alternating' | null): string {
    return mode === 'alternating' ? 'Abwechselnd' : 'Fortlaufend';
  }

  showTrainingJobs(training: CoderTraining): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translate.instant('error.noWorkspaceSelected'),
        this.translate.instant('common.close'),
        { duration: 3000 }
      );
      return;
    }

    this.codingTrainingBackendService.getCodingJobsForTraining(workspaceId, training.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: jobs => {
          this.dialog.open(TrainingJobsDialogComponent, {
            width: '90vw',
            data: {
              training,
              jobs
            }
          });
        },
        error: error => {
          this.snackBar.open(
            this.translate.instant('error.general', { error: error.message }),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
        }
      });
  }

  deleteTraining(training: CoderTraining): void {
    const dialogRef = this.dialog.open(DeleteConfirmationDialog, {
      width: '400px',
      data: { training }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.performDelete(training);
      }
    });
  }

  private performDelete(training: CoderTraining): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translate.instant('error.noWorkspaceSelected'),
        this.translate.instant('common.close'),
        { duration: 3000 }
      );
      return;
    }

    this.codingTrainingBackendService.deleteCoderTraining(workspaceId, training.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          if (response.success) {
            const translatedMessage = response.message ?
              this.backendMessageTranslator.translateMessage(response.message) :
              this.translate.instant('trainings.delete.success', { label: training.label, count: training.jobsCount });
            this.snackBar.open(translatedMessage, this.translate.instant('common.close'), { duration: 5000 });
            this.loadCoderTrainings(); // Refresh the list
          } else {
            const translatedError = response.message ?
              this.backendMessageTranslator.translateMessage(response.message) :
              this.translate.instant('error.general', { error: response.message });
            this.snackBar.open(
              translatedError,
              this.translate.instant('common.close'),
              { duration: 5000 }
            );
          }
        },
        error: error => {
          this.snackBar.open(
            this.translate.instant('coding.trainings.delete.error.generic', { error: error.message }),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
        }
      });
  }
}
