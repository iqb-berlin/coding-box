import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

export interface ApplyDuplicateAggregationDialogData {
  duplicateGroups: number;
  totalResponses: number;
  threshold: number;
}

@Component({
  selector: 'coding-box-apply-duplicate-aggregation-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    TranslateModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>content_copy</mat-icon>
      {{ 'coding-management-manual.duplicate-aggregation.dialog.title' | translate }}
    </h2>
    <mat-dialog-content>
      <div class="dialog-content">
        <p class="info-text">
          {{ 'coding-management-manual.duplicate-aggregation.dialog.info' | translate }}
        </p>

        <div class="stats-container">
          <div class="stat-item">
            <span class="stat-label">{{ 'coding-management-manual.duplicate-aggregation.dialog.groups' | translate }}:</span>
            <span class="stat-value">{{ data.duplicateGroups }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ 'coding-management-manual.duplicate-aggregation.dialog.total-responses' | translate }}:</span>
            <span class="stat-value">{{ data.totalResponses }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ 'coding-management-manual.duplicate-aggregation.dialog.threshold' | translate }}:</span>
            <span class="stat-value">{{ data.threshold }}</span>
          </div>
        </div>

        <div class="warning-box">
          <mat-icon>warning</mat-icon>
          <div>
            <p class="warning-title">{{ 'coding-management-manual.duplicate-aggregation.dialog.warning-title' | translate }}</p>
            <p class="warning-text">{{ 'coding-management-manual.duplicate-aggregation.dialog.warning-text' | translate }}</p>
          </div>
        </div>

        <p class="explanation-text">
          {{ 'coding-management-manual.duplicate-aggregation.dialog.explanation' | translate }}
        </p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        {{ 'coding-management-manual.duplicate-aggregation.dialog.cancel' | translate }}
      </button>
      <button mat-raised-button color="primary" (click)="onConfirm()">
        <mat-icon>check</mat-icon>
        {{ 'coding-management-manual.duplicate-aggregation.dialog.confirm' | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-content {
      min-width: 400px;
      padding: 16px 0;
    }

    .info-text {
      margin-bottom: 20px;
      color: rgba(0, 0, 0, 0.87);
      line-height: 1.5;
    }

    .stats-container {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .stat-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }

    .stat-item:last-child {
      border-bottom: none;
    }

    .stat-label {
      font-weight: 500;
      color: rgba(0, 0, 0, 0.6);
    }

    .stat-value {
      font-weight: 600;
      color: #1976d2;
      font-size: 1.1em;
    }

    .warning-box {
      display: flex;
      gap: 12px;
      background: #fff3e0;
      border-left: 4px solid #ff9800;
      padding: 16px;
      margin-bottom: 20px;
      border-radius: 4px;
    }

    .warning-box mat-icon {
      color: #ff9800;
      flex-shrink: 0;
    }

    .warning-title {
      font-weight: 600;
      margin: 0 0 8px 0;
      color: rgba(0, 0, 0, 0.87);
    }

    .warning-text {
      margin: 0;
      color: rgba(0, 0, 0, 0.6);
      font-size: 0.9em;
      line-height: 1.4;
    }

    .explanation-text {
      color: rgba(0, 0, 0, 0.6);
      font-size: 0.9em;
      line-height: 1.5;
      margin: 0;
    }

    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    mat-dialog-actions button {
      margin-left: 8px;
    }
  `]
})
export class ApplyDuplicateAggregationDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ApplyDuplicateAggregationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ApplyDuplicateAggregationDialogData
  ) { }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
