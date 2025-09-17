import { Component, Inject, OnInit } from '@angular/core';
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
import { BackendService } from '../../../services/backend.service';

export interface VariableAnalysisJobsDialogData {
  jobs: VariableAnalysisJobDto[];
  workspaceId: number;
}

@Component({
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
  displayedColumns: string[] = ['id', 'status', 'createdAt', 'unitId', 'variableId', 'actions'];
  isLoading = false;

  constructor(
    public dialogRef: MatDialogRef<VariableAnalysisJobsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableAnalysisJobsDialogData,
    private backendService: BackendService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.refreshJobs();
  }

  refreshJobs(): void {
    this.isLoading = true;
    this.backendService.getAllVariableAnalysisJobs(this.data.workspaceId)
      .subscribe({
        next: jobs => {
          this.data.jobs = jobs.filter(job => job.type === 'variable-analysis');
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Analyse-Aufträge',
            'Fehler',
            { duration: 3000 }
          );
          this.isLoading = false;
        }
      });
  }

  cancelJob(jobId: number): void {
    this.isLoading = true;
    this.backendService.cancelVariableAnalysisJob(this.data.workspaceId, jobId)
      .subscribe({
        next: result => {
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
            this.isLoading = false;
          }
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Abbrechen des Analyse-Auftrags',
            'Fehler',
            { duration: 3000 }
          );
          this.isLoading = false;
        }
      });
  }

  viewResults(jobId: number): void {
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
