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
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import {
  MatDialog, MatDialogModule
} from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { CoderTraining } from '../../models/coder-training.model';
import { AppService } from '../../../services/app.service';
import { CodingResultsComparisonComponent } from '../coding-results-comparison/coding-results-comparison.component';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog.component';
import { TrainingJobsDialogComponent } from './training-jobs-dialog.component';

@Component({
  selector: 'coding-box-coder-trainings-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatSelectModule
  ],
  templateUrl: './coder-trainings-list.component.html',
  styleUrls: ['./coder-trainings-list.component.scss']
})
export class CoderTrainingsListComponent implements OnInit, OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private destroy$ = new Subject<void>();

  @Input() showCreateButton = true;
  @Output() onCreateTraining = new EventEmitter<void>();

  coderTrainings: CoderTraining[] = [];
  originalData: CoderTraining[] = [];
  selectedTrainingName: string | null = null;
  isLoading = false;
  displayedColumns: string[] = ['actions', 'label', 'jobsCount', 'created_at'];

  editingTrainingId: number | null = null;
  editingLabel = '';

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

      this.backendService.getCoderTrainings(workspaceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (trainings: CoderTraining[]) => {
            this.originalData = trainings;
            this.applyAllFilters();
            this.isLoading = false;
            resolve();
          },
          error: () => {
            this.coderTrainings = [];
            this.originalData = [];
            this.isLoading = false;
            reject();
          }
        });
    });
  }

  startEditTraining(training: CoderTraining): void {
    this.editingTrainingId = training.id;
    this.editingLabel = training.label;
  }

  cancelEditTraining(): void {
    this.editingTrainingId = null;
    this.editingLabel = '';
  }

  saveEditTraining(): void {
    if (!this.editingTrainingId || !this.editingLabel.trim()) {
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translate.instant('error.noWorkspaceSelected'),
        this.translate.instant('common.close'),
        { duration: 3000 }
      );
      return;
    }

    this.backendService.updateCoderTrainingLabel(workspaceId, this.editingTrainingId, this.editingLabel.trim())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          if (response.success) {
            this.snackBar.open(response.message, this.translate.instant('common.close'), { duration: 3000 });
            this.editingTrainingId = null;
            this.editingLabel = '';
            this.loadCoderTrainings();
          } else {
            this.snackBar.open(
              this.translate.instant('error.general', { error: response.message }),
              this.translate.instant('common.close'),
              { duration: 5000 }
            );
          }
        },
        error: error => {
          this.snackBar.open(
            this.translate.instant('coding.trainings.edit.error.generic', { error: error.message }),
            this.translate.instant('common.close'),
            { duration: 5000 }
          );
        }
      });
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

  openResultsComparison(training?: CoderTraining): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.dialog.open(CodingResultsComparisonComponent, {
      width: '90vw',
      height: '80vh',
      data: {
        workspaceId,
        selectedTraining: training
      }
    });
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

    this.backendService.getCodingJobsForTraining(workspaceId, training.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: jobs => {
          this.dialog.open(TrainingJobsDialogComponent, {
            width: '80vw',
            maxWidth: '1000px',
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

    this.backendService.deleteCoderTraining(workspaceId, training.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          if (response.success) {
            this.snackBar.open(response.message, this.translate.instant('common.close'), { duration: 5000 });
            this.loadCoderTrainings(); // Refresh the list
          } else {
            this.snackBar.open(
              this.translate.instant('error.general', { error: response.message }),
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
