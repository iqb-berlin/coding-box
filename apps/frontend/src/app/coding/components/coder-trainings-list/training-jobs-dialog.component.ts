import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { CoderTraining } from '../../models/coder-training.model';

interface CodingJob {
  id: number;
  name: string;
  description?: string;
  status: string;
  created_at: Date;
  coder: {
    userId: number;
    username: string;
  };
  unitsCount: number;
}

interface DialogData {
  training: CoderTraining;
  jobs: CodingJob[];
}

@Component({
  selector: 'coding-box-training-jobs-dialog',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatDialogModule,
    MatButtonModule,
    MatTableModule,
    MatIconModule,
    MatChipsModule
  ],
  template: `
    <div class="training-jobs-dialog">
      <h2 mat-dialog-title>{{ 'coding.trainings.jobs.title' | translate }}: {{ data.training.label }}</h2>

      <mat-dialog-content class="dialog-content">
        <div class="training-info">
          <p><strong>{{ 'coding.trainings.table.created' | translate }}:</strong> {{ formatDate(data.training.created_at) }}</p>
          <p><strong>{{ 'coding.trainings.table.jobs' | translate }}:</strong> {{ data.jobs.length }}</p>
        </div>

        <table mat-table [dataSource]="data.jobs" class="jobs-table" *ngIf="data.jobs.length > 0">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>{{ 'coding.jobs.table.name' | translate }}</th>
            <td mat-cell *matCellDef="let job">
              <div class="job-name">
                <mat-icon class="job-icon">work</mat-icon>
                <span>{{ job.name }}</span>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="coder">
            <th mat-header-cell *matHeaderCellDef>{{ 'coding.jobs.table.coder' | translate }}</th>
            <td mat-cell *matCellDef="let job">
              <mat-chip-listbox>
                <mat-chip>{{ job.coder.username }}</mat-chip>
              </mat-chip-listbox>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>{{ 'coding.jobs.table.status' | translate }}</th>
            <td mat-cell *matCellDef="let job">
              <span [ngClass]="getStatusClass(job.status)">{{getStatusText(job.status)}}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="unitsCount">
            <th mat-header-cell *matHeaderCellDef>{{ 'coding.jobs.table.units' | translate }}</th>
            <td mat-cell *matCellDef="let job">
              <mat-chip-listbox>
                <mat-chip>{{ job.unitsCount }}</mat-chip>
              </mat-chip-listbox>
            </td>
          </ng-container>

          <ng-container matColumnDef="created_at">
            <th mat-header-cell *matHeaderCellDef>{{ 'common.created' | translate }}</th>
            <td mat-cell *matCellDef="let job">{{ formatDate(job.created_at) }}</td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>

        <div class="no-jobs" *ngIf="data.jobs.length === 0">
          <mat-icon>info</mat-icon>
          <p>{{ 'coding.trainings.jobs.empty' | translate }}</p>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="close()">{{ 'common.close' | translate }}</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .training-jobs-dialog {
      .dialog-content {
        min-width: 600px;
      }

      .training-info {
        margin-bottom: 20px;
        padding: 16px;
        background-color: #f5f5f5;
        border-radius: 4px;

        p {
          margin: 4px 0;

          strong {
            color: #666;
          }
        }
      }

      .jobs-table {
        width: 100%;

        .job-name {
          display: flex;
          align-items: center;
          gap: 8px;

          .job-icon {
            font-size: 20px;
            color: #666;
          }
        }
      }

      .no-jobs {
        text-align: center;
        padding: 40px;
        color: #666;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: 16px;
        }
      }
    }

    .status-active {
      color: #4caf50;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 4px;
      background-color: rgba(76, 175, 80, 0.1);
    }

    .status-completed {
      color: #2196f3;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 4px;
      background-color: rgba(33, 150, 243, 0.1);
    }

    .status-pending {
      color: #ff9800;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 4px;
      background-color: rgba(255, 152, 0, 0.1);
    }

    .status-paused {
      background-color: rgba(156, 39, 176, 0.1);
      color: #6a1b9a;
      border: 1px solid rgba(156, 39, 176, 0.2);
    }
  `]
})
export class TrainingJobsDialogComponent {
  private dialogRef = inject(MatDialogRef<TrainingJobsDialogComponent>);
  data: DialogData = inject(MAT_DIALOG_DATA);

  displayedColumns: string[] = ['name', 'coder', 'status', 'unitsCount', 'created_at'];

  close(): void {
    this.dialogRef.close();
  }

  formatDate(date: Date): string {
    const d = new Date(date);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'status-active';
      case 'completed':
        return 'status-completed';
      case 'pending':
        return 'status-pending';
      case 'paused':
        return 'status-paused';
      default:
        return '';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'active':
        return 'Aktiv';
      case 'completed':
        return 'Abgeschlossen';
      case 'pending':
        return 'Ausstehend';
      case 'paused':
        return 'Pausiert';
      default:
        return status;
    }
  }
}
