import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  Component, ChangeDetectionStrategy, computed, inject, Signal
} from '@angular/core';

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
import type { TestResultExportJob } from '../../../shared/services/test-result/test-result-backend.service';

export type TestResultsExportDialogResult =
  | { type: 'results' }
  | { type: 'logs' }
  | { type: 'download'; jobId?: string | null }
  | { type: 'cancel'; jobId?: string | null };

type TestResultsExportDialogState = {
  isExporting?: boolean;
  exportTypeInProgress?: 'test-results' | 'test-logs' | null;
  exportJobStatus?: string | null;
  exportJobProgress?: number;
  exportJobId?: string | null;
  completedJobs?: TestResultExportJob[];
};

export type TestResultsExportDialogData = TestResultsExportDialogState & {
  state?: Signal<TestResultsExportDialogState>;
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-results-export-dialog',
  standalone: true,
  imports: [TranslateModule, DatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatListModule,
    MatProgressBarModule
  ],
  template: `
    @let exportState = state();
    <h2 mat-dialog-title>{{ 'ui-text.test-results-export-dialog.title' | translate }}</h2>
    <mat-dialog-content>
      @if (!exportState.isExporting) {
        <mat-list>
          <mat-list-item (click)="selectExportType('results')">
            <mat-icon matListItemIcon>download</mat-icon>
            <div matListItemTitle>{{ 'ui-text.test-results-export-dialog.uncoded-results' | translate }}</div>
            <div matListItemLine>{{ 'ui-text.test-results-export-dialog.uncoded-results-hint' | translate }}</div>
          </mat-list-item>
          <mat-divider></mat-divider>
          <mat-list-item (click)="selectExportType('logs')">
            <mat-icon matListItemIcon>download</mat-icon>
            <div matListItemTitle>{{ 'ui-text.test-results-export-dialog.export-logs' | translate }}</div>
            <div matListItemLine>{{ 'ui-text.test-results-export-dialog.logs-hint' | translate }}</div>
          </mat-list-item>
        </mat-list>
      }

      <mat-divider class="export-divider"></mat-divider>

      <!-- Export Progress Section -->
      @if (exportState.isExporting) {
        <div class="export-progress-section">
          <div class="export-progress-header">
            <span class="export-status">
              {{
              exportState.exportTypeInProgress === 'test-logs' ? ('ui-text.test-center-options-step.logs' | translate) : ('ui-text.apply-coding-results-dialog.results' | translate)
              }}:
              {{ (exportState.exportJobStatus === 'active' ? 'process-overview.status.active' : 'process-overview.status.waiting') | translate }}
            </span>
            <span class="export-percentage">{{ exportState.exportJobProgress }}%</span>
          </div>
          <mat-progress-bar
            [mode]="exportState.exportJobStatus === 'active' ? 'determinate' : 'indeterminate'"
            [value]="exportState.exportJobProgress"
          ></mat-progress-bar>
        </div>
      }

      @for (job of exportState.completedJobs ?? []; track job.jobId) {
        <button mat-button type="button" (click)="downloadExport(job.jobId)">
          <mat-icon>file_download</mat-icon>
          {{ (job.exportType === 'test-logs' ? 'ui-text.test-center-options-step.logs' : 'ui-text.apply-coding-results-dialog.results') | translate }}
          {{ job.createdAt | date:'short' }}
        </button>
      }
      @if (
        exportState.completedJobs === undefined &&
        exportState.exportJobStatus === 'completed' &&
        !exportState.isExporting &&
        exportState.exportJobId
        ) {
        <div
          class="download-ready-section"
          >
          <mat-divider></mat-divider>
          <mat-list-item (click)="downloadExport()">
            <mat-icon matListItemIcon>file_download</mat-icon>
            <div matListItemTitle>{{ 'ui-text.test-results-export-dialog.download-ready' | translate }}</div>
            <div matListItemLine>{{ 'ui-text.test-results-export-dialog.download-file' | translate }}</div>
          </mat-list-item>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">
        {{
        exportState.isExporting && exportState.exportJobId ?
        'Export abbrechen' :
        ('cancel' | translate)
        }}
      </button>
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
  private dialogRef = inject<MatDialogRef<TestResultsExportDialogComponent>>(MatDialogRef);
  private readonly data = inject<TestResultsExportDialogData>(MAT_DIALOG_DATA);
  protected readonly state = computed(() => this.data.state?.() ?? this.data);

  protected selectExportType(type: 'results' | 'logs'): void {
    this.dialogRef.close({ type });
  }

  protected downloadExport(jobId = this.state().exportJobId): void {
    this.dialogRef.close({ type: 'download', jobId });
  }

  protected cancel(): void {
    const { isExporting, exportJobId } = this.state();
    if (isExporting && exportJobId) {
      this.dialogRef.close({ type: 'cancel', jobId: exportJobId });
      return;
    }

    this.dialogRef.close(undefined);
  }
}
