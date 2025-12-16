import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';

export type TestResultsExportDialogResult = {
  type: 'results' | 'logs';
};

@Component({
  selector: 'coding-box-test-results-export-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatListModule,
    MatProgressBarModule
  ],
  template: `
    <h2 mat-dialog-title>Export Test Results</h2>
    <mat-dialog-content>
      <mat-list>
        <mat-list-item (click)="selectExportType('results')">
          <mat-icon matListItemIcon>download</mat-icon>
          <div matListItemTitle>Ergebnisse exportieren</div>
          <div matListItemLine>Export test results data</div>
        </mat-list-item>
        <mat-divider></mat-divider>
        <mat-list-item (click)="selectExportType('logs')">
          <mat-icon matListItemIcon>download</mat-icon>
          <div matListItemTitle>Logs exportieren</div>
          <div matListItemLine>Export test logs</div>
        </mat-list-item>
      </mat-list>

      <mat-divider class="export-divider"></mat-divider>

      <!-- Export Progress Section -->
      <div *ngIf="data?.isExporting" class="export-progress-section">
        <div class="export-progress-header">
          <span class="export-status">
            {{
              data.exportTypeInProgress === 'test-logs' ? 'Logs' : 'Ergebnisse'
            }}:
            {{ data.exportJobStatus || '...' }}
          </span>
          <span class="export-percentage">{{ data.exportJobProgress }}%</span>
        </div>
        <mat-progress-bar
          mode="determinate"
          [value]="data.exportJobProgress"
        ></mat-progress-bar>
      </div>

      <!-- Download Ready Section -->
      <div
        *ngIf="
          data?.exportJobStatus === 'completed' &&
          !data?.isExporting &&
          data?.exportJobId
        "
        class="download-ready-section"
      >
        <mat-divider></mat-divider>
        <mat-list-item (click)="downloadExport()">
          <mat-icon matListItemIcon>file_download</mat-icon>
          <div matListItemTitle>Download bereit</div>
          <div matListItemLine>Download your exported file</div>
        </mat-list-item>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-list-item {
        cursor: pointer;
        transition: background-color 0.2s ease;
        border-radius: 4px;
        margin: 4px 0;
      }

      mat-list-item:hover {
        background-color: rgba(25, 118, 210, 0.08);
      }

      mat-icon {
        color: #1976d2;
        margin-right: 12px;
      }

      [matListItemTitle] {
        font-weight: 500;
        color: #333;
      }

      [matListItemLine] {
        font-size: 12px;
        color: #999;
      }

      .export-divider {
        margin: 16px 0;
      }

      .export-progress-section {
        padding: 12px 16px;
        background-color: #f9fafc;
        border-radius: 4px;
        margin: 8px 0;
      }

      .export-progress-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 500;
      }

      .export-status {
        color: #666;
      }

      .export-percentage {
        color: #1976d2;
      }

      mat-progress-bar {
        height: 4px;
        border-radius: 2px;
      }

      .download-ready-section {
        margin-top: 8px;
      }
    `
  ]
})
export class TestResultsExportDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<TestResultsExportDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  selectExportType(type: 'results' | 'logs'): void {
    this.dialogRef.close({ type });
  }

  downloadExport(): void {
    this.dialogRef.close({ type: 'download', jobId: this.data.exportJobId });
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
