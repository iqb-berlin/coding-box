import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  LogAnomalyDetailRow,
  LogAnomalySummary
} from '../../../shared/services/test-result/test-result.service';

export interface TestResultsLogAnomalyDetailsDialogData {
  affectedBooklets: number;
  rows: LogAnomalyDetailRow[];
  truncated: boolean;
}

export interface TestResultsLogAnomalyDetailsDialogResult {
  showTable?: boolean;
}

@Component({
  selector: 'coding-box-test-results-log-anomaly-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>troubleshoot</mat-icon>
      Log-Auffälligkeiten
    </h2>

    <div mat-dialog-content class="anomaly-dialog-content">
      <p class="summary">
        {{ data.affectedBooklets }} auffällige Testhefte erkannt.
        @if (data.truncated) {
          <span>Es werden die ersten {{ data.rows.length }} angezeigt.</span>
        }
      </p>

      @if (data.rows.length === 0) {
        <div class="empty-state">
          <mat-icon>check_circle</mat-icon>
          <span>Keine auffälligen Testhefte gefunden.</span>
        </div>
      }

      <div class="anomaly-list">
        @for (row of data.rows; track row.bookletId) {
          <section class="anomaly-row">
            <div class="row-header">
              <div class="identity">
                <strong>{{ row.code || 'Ohne Code' }}</strong>
                <span>{{ row.login || 'Ohne Login' }}</span>
                <span>{{ row.group || 'Ohne Gruppe' }}</span>
              </div>
              <span
                class="severity"
                [class.critical]="row.maxSeverity === 'critical'"
                [class.warning]="row.maxSeverity === 'warning'"
                [class.info]="row.maxSeverity === 'info'"
              >
                {{ getSeverityLabel(row.maxSeverity) }}
              </span>
            </div>

            <div class="booklet">{{ row.booklet || 'Unbekanntes Testheft' }}</div>

            <div class="anomaly-chips">
              @for (anomaly of row.anomalies; track anomaly.code) {
                <span
                  class="anomaly-chip"
                  [class.critical]="anomaly.severity === 'critical'"
                  [class.warning]="anomaly.severity === 'warning'"
                  [class.info]="anomaly.severity === 'info'"
                  [matTooltip]="getAnomalyTooltip(anomaly)"
                >
                  {{ anomaly.label }}
                  @if (anomaly.count > 1) {
                    <span>({{ anomaly.count }}x)</span>
                  }
                </span>
              }
            </div>
          </section>
        }
      </div>
    </div>

    <div mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">Schließen</button>
      <button
        mat-raised-button
        color="primary"
        type="button"
        [mat-dialog-close]="{ showTable: true }"
      >
        In Tabelle anzeigen
      </button>
    </div>
  `,
  styles: [`
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .anomaly-dialog-content {
      max-height: min(70vh, 720px);
      overflow: auto;
    }

    .summary {
      margin: 0 0 12px;
      color: rgba(0, 0, 0, 0.72);
    }

    .empty-state {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 16px 0;
      color: rgba(0, 0, 0, 0.68);
    }

    .anomaly-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .anomaly-row {
      padding: 10px 12px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 8px;
      background: #fff;
    }

    .row-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    }

    .identity {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      min-width: 0;
    }

    .identity span,
    .booklet {
      color: rgba(0, 0, 0, 0.64);
    }

    .booklet {
      margin-bottom: 8px;
      font-size: 13px;
    }

    .severity,
    .anomaly-chip {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 16px;
      white-space: nowrap;
      border: 1px solid rgba(25, 118, 210, 0.24);
      background: rgba(25, 118, 210, 0.08);
    }

    .severity.critical,
    .anomaly-chip.critical {
      border-color: rgba(211, 47, 47, 0.32);
      background: rgba(211, 47, 47, 0.10);
      color: #b71c1c;
    }

    .severity.warning,
    .anomaly-chip.warning {
      border-color: rgba(245, 124, 0, 0.36);
      background: rgba(245, 124, 0, 0.10);
      color: #bf5f00;
    }

    .severity.info,
    .anomaly-chip.info {
      border-color: rgba(25, 118, 210, 0.30);
      background: rgba(25, 118, 210, 0.08);
      color: #0d47a1;
    }

    .anomaly-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
  `]
})
export class TestResultsLogAnomalyDetailsDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<
    TestResultsLogAnomalyDetailsDialogComponent,
    TestResultsLogAnomalyDetailsDialogResult | undefined
    >,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsLogAnomalyDetailsDialogData
  ) {}

  close(): void {
    this.dialogRef.close(undefined);
  }

  getSeverityLabel(severity: LogAnomalySummary['severity']): string {
    switch (severity) {
      case 'critical':
        return 'kritisch';
      case 'warning':
        return 'Warnung';
      case 'info':
        return 'Info';
      default:
        return severity;
    }
  }

  getAnomalyTooltip(anomaly: LogAnomalySummary): string {
    const count = anomaly.count > 1 ? ` (${anomaly.count}x)` : '';
    return `${anomaly.label}${count}: ${anomaly.evidence}`;
  }
}
