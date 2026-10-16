import {
  Component, OnInit, ChangeDetectionStrategy, signal, DestroyRef, inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, takeUntil } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';
import { VariableAnalysisService, JobCancelResult } from '../../../shared/services/response/variable-analysis.service';

export interface VariableAnalysisJobsDialogData {
  jobs: VariableAnalysisJobDto[];
  workspaceId: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-variable-analysis-jobs-dialog',
  templateUrl: './variable-analysis-jobs-dialog.component.html',
  styleUrls: ['./variable-analysis-jobs-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule
  ]
})
export class VariableAnalysisJobsDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<VariableAnalysisJobsDialogComponent>>(MatDialogRef);
  data = inject<VariableAnalysisJobsDialogData>(MAT_DIALOG_DATA);
  private variableAnalysisService = inject(VariableAnalysisService);
  private snackBar = inject(MatSnackBar);

  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshCancel$ = new Subject<void>();
  displayedColumns: string[] = ['id', 'status', 'createdAt', 'unitId', 'variableId', 'actions'];
  readonly isLoading = signal(false);
  readonly jobs = signal<VariableAnalysisJobDto[]>([]);

  constructor() {
    this.jobs.set([...this.data.jobs]);
  }

  ngOnInit(): void {
    this.refreshJobs();
  }

  refreshJobs(): void {
    this.refreshCancel$.next();
    this.isLoading.set(true);
    this.variableAnalysisService.getAllJobs(this.data.workspaceId)
      .pipe(takeUntil(this.refreshCancel$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (jobs: VariableAnalysisJobDto[]) => {
          this.jobs.set(jobs.filter(job => job.type === 'variable-analysis'));
          this.isLoading.set(false);
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Analyse-Aufträge',
            'Fehler',
            { duration: 3000 }
          );
          this.isLoading.set(false);
        }
      });
  }

  cancelJob(jobId: number | string): void {
    this.isLoading.set(true);
    this.variableAnalysisService.cancelJob(this.data.workspaceId, jobId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: JobCancelResult) => {
          if (result.success) {
            this.snackBar.open(
              result.message || 'Analyse-Auftrag erfolgreich abgebrochen',
              'OK',
              { duration: 3000 }
            );
            this.refreshJobs();
          } else {
            this.snackBar.open(
              result.message || 'Fehler beim Abbrechen des Analyse-Auftrags',
              'Fehler',
              { duration: 3000 }
            );
            this.isLoading.set(false);
          }
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Abbrechen des Analyse-Auftrags',
            'Fehler',
            { duration: 3000 }
          );
          this.isLoading.set(false);
        }
      });
  }

  viewResults(jobId: number | string): void {
    this.dialogRef.close({ jobId });
  }

  onClose(): void {
    this.dialogRef.close();
  }

  formatDate(date: Date): string {
    if (!date) return '';
    return new Date(date).toLocaleString();
  }
}
