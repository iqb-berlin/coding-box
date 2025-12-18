import { Component, OnInit, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatList, MatListItem } from '@angular/material/list';
import { NgClass } from '@angular/common';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'app-log-dialog',
  template: `
    <div class="dialog-header">
      <h1 mat-dialog-title>Booklet Logs</h1>
      <div class="header-info">
        <span class="log-count">{{ data.logs.length }} Einträge</span>
        @if (processingDuration) {
        <span class="processing-duration">
          <span class="duration-label">Bearbeitungsdauer:</span>
          <span class="duration-value">{{ processingDuration }}</span>
        </span>
        } @if (data.units && data.units.length > 0) {
        <span class="unit-progress">
          <span class="progress-label">Unit-Fortschritt:</span>
          <span
            class="progress-value"
            [ngClass]="{
              complete: unitProgressComplete,
              incomplete: !unitProgressComplete
            }"
          >
            {{ unitProgressComplete ? 'Vollständig' : 'Unvollständig' }}
          </span>
        </span>
        }
      </div>
    </div>

    <div mat-dialog-content>
      <!-- Session Information Section -->
      @if (data.sessions && data.sessions.length > 0) {
      <div class="session-section">
        <div class="section-header">
          <h2>Session Information</h2>
          <span class="session-count">{{ data.sessions.length }} Sessions</span>
        </div>
        <div class="session-list">
          @for (session of data.sessions; track session) {
          <div class="session-item">
            <div class="session-header">
              <span class="session-timestamp">
                {{ formatTimestamp(session.ts) }}
              </span>
            </div>
            <div class="session-details">
              <div class="detail-item">
                <span class="detail-label">Browser:</span>
                <span class="detail-value">{{
                  session.browser || 'Unknown'
                }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">OS:</span>
                <span class="detail-value">{{ session.os || 'Unknown' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Screen:</span>
                <span class="detail-value">{{
                  session.screen || 'Unknown'
                }}</span>
              </div>
            </div>
          </div>
          }
        </div>
      </div>
      }

      <!-- Logs Section -->
      <div class="logs-section">
        <div class="section-header">
          <h2>Booklet Logs</h2>
          <div class="search-box">
            <input
              type="text"
              placeholder="Suchen..."
              (input)="filterLogs($event)"
            />
          </div>
        </div>

        <mat-list class="logs-list">
          @for (log of filteredLogs; track log) {
          <mat-list-item class="log-item">
            <div class="log-content">
              <div class="log-header">
                <span class="log-key">{{ log.key }}</span>
                <span class="log-timestamp">{{ formatTimestamp(log.ts) }}</span>
              </div>
              <div class="log-parameter">{{ log.parameter }}</div>
            </div>
          </mat-list-item>
          }
        </mat-list>
      </div>
    </div>

    <div mat-dialog-actions align="end">
      <button mat-stroked-button (click)="closeDialog()">Schließen</button>
    </div>
  `,
  styles: [
    `
      /* Dialog Header */
      .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 16px;
        margin-bottom: 8px;
      }

      h1 {
        margin: 0;
        font-size: 24px;
        color: #1976d2;
      }

      .header-info {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }

      .log-count {
        background-color: #e3f2fd;
        color: #1976d2;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 14px;
        font-weight: 500;
      }

      .processing-duration {
        background-color: #e8f5e9;
        color: #2e7d32;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .duration-label {
        font-weight: 500;
      }

      .duration-value {
        font-weight: 600;
      }

      .unit-progress {
        background-color: #f5f5f5;
        color: #333;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .progress-label {
        font-weight: 500;
      }

      .progress-value {
        font-weight: 600;
      }

      .progress-value.complete {
        color: #2e7d32; /* Green color for complete */
      }

      .progress-value.incomplete {
        color: #f44336; /* Red color for incomplete */
      }

      /* Section Headers */
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        border-bottom: 1px solid #e0e0e0;
        padding-bottom: 8px;
      }

      h2 {
        margin: 0;
        font-size: 18px;
        color: #333;
        font-weight: 500;
      }

      .session-count {
        background-color: #e8f5e9;
        color: #2e7d32;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 500;
      }

      /* Session Section */
      .session-section {
        margin-bottom: 24px;
        background-color: #f9f9f9;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .session-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .session-item {
        background-color: white;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        transition: box-shadow 0.2s ease;
      }

      .session-item:hover {
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
      }

      .session-header {
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px dashed #e0e0e0;
      }

      .session-timestamp {
        font-size: 12px;
        color: #757575;
        font-style: italic;
      }

      .session-details {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .detail-item {
        display: flex;
        align-items: center;
      }

      .detail-label {
        font-weight: 500;
        color: #555;
        width: 80px;
        flex-shrink: 0;
      }

      .detail-value {
        color: #333;
      }

      /* Logs Section */
      .logs-section {
        background-color: #f9f9f9;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .search-box {
        position: relative;
        width: 200px;
      }

      .search-box input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 20px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }

      .search-box input:focus {
        border-color: #1976d2;
        box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
      }

      .logs-list {
        max-height: 300px;
        overflow-y: auto;
        padding: 0;
      }

      .log-item {
        border-bottom: 1px solid #eee;
        transition: background-color 0.2s ease;
      }

      .log-item:hover {
        background-color: #f5f5f5;
      }

      .log-content {
        padding: 12px 0;
        width: 100%;
      }

      .log-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      .log-key {
        font-weight: 600;
        color: #1976d2;
        font-size: 14px;
      }

      .log-timestamp {
        font-size: 12px;
        color: #757575;
      }

      .log-parameter {
        font-size: 14px;
        color: #555;
        word-break: break-word;
      }

      /* Dialog Content and Actions */
      mat-dialog-content {
        max-height: 600px;
        overflow-y: auto;
        padding: 0 16px;
      }

      mat-dialog-actions {
        margin-top: 16px;
        padding: 8px 16px;
        border-top: 1px solid #eee;
      }

      button[mat-stroked-button] {
        min-width: 100px;
      }
    `
  ],

  imports: [
    MatListItem,
    MatList,
    MatDialogContent,
    MatDialogTitle,
    MatDialogActions,
    MatButton,
    NgClass
  ],
  standalone: true
})
export class LogDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<LogDialogComponent>>(MatDialogRef);
  data = inject<{
    logs: {
      id: number;
      bookletid: number;
      ts: string;
      key: string;
      parameter: string;
    }[];
    sessions?: {
      id: number;
      browser: string;
      os: string;
      screen: string;
      ts: string;
    }[];
    units?: {
      id: number;
      bookletid: number;
      name: string;
      alias: string | null;
      results: {
        id: number;
        unitid: number;
      }[];
      logs: {
        id: number;
        unitid: number;
        ts: string;
        key: string;
        parameter: string;
      }[];
    }[];
  }>(MAT_DIALOG_DATA);

  filteredLogs: {
    id: number;
    bookletid: number;
    ts: string;
    key: string;
    parameter: string;
  }[] = [];

  processingDuration: string | null = null;

  unitProgressComplete: boolean = false;

  ngOnInit(): void {
    this.filteredLogs = [...this.data.logs];
    this.sortLogsByTimestamp();
    this.calculateProcessingDuration();
    this.checkUnitProgress();
  }

  /**
   * Checks if all units in the booklet have corresponding log entries with log-key CURRENT_UNIT_ID
   */
  private checkUnitProgress(): void {
    // If no units data is provided, we can't check unit progress
    if (!this.data.units || this.data.units.length === 0) {
      return;
    }

    // Get all log entries with key CURRENT_UNIT_ID
    const unitIdLogs = this.data.logs.filter(
      log => log.key === 'CURRENT_UNIT_ID'
    );

    // Get all unit aliases
    const unitAliases = this.data.units
      .map(unit => unit.alias)
      .filter(alias => alias !== null) as string[];

    // Check if each unit alias has a corresponding log entry
    const allUnitsVisited = unitAliases.every(alias => unitIdLogs.some(log => log.parameter === alias)
    );

    this.unitProgressComplete = allUnitsVisited && unitAliases.length > 0;
  }

  /**
   * Calculates the time difference between CONTROLLER/POLLING and CONTROLLER/TERMINATED events
   */
  private calculateProcessingDuration(): void {
    const pollingLog = this.data.logs.find(
      log => log.key === 'CONTROLLER' && log.parameter === 'RUNNING'
    );
    const terminatedLog = this.data.logs.find(
      log => log.key === 'CONTROLLER' && log.parameter === 'TERMINATED'
    );
    if (pollingLog && terminatedLog) {
      const pollingTime = Number(pollingLog.ts);
      const terminatedTime = Number(terminatedLog.ts);

      if (!Number.isNaN(pollingTime) && !Number.isNaN(terminatedTime)) {
        // Calculate the difference in milliseconds
        const durationMs = terminatedTime - pollingTime;

        // Store the duration for display
        this.processingDuration = this.formatDuration(durationMs);
      }
    }
  }

  /**
   * Formats a duration in milliseconds to a readable format (minutes:seconds)
   */
  private formatDuration(durationMs: number): string {
    if (durationMs < 0) return '00:00';

    // Convert to seconds
    const totalSeconds = Math.floor(durationMs / 1000);

    // Calculate minutes and remaining seconds
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    // Format as MM:SS
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  /**
   * Formats a timestamp to a readable date and time
   */
  formatTimestamp(timestamp: string): string {
    const date = new Date(Number(timestamp));
    return date.toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Filters logs based on search input
   */
  filterLogs(event: Event): void {
    const searchTerm = (event.target as HTMLInputElement).value.toLowerCase();

    if (!searchTerm) {
      // If search term is empty, show all logs
      this.filteredLogs = [...this.data.logs];
    } else {
      // Filter logs by key or parameter containing the search term
      this.filteredLogs = this.data.logs.filter(
        log => log.key.toLowerCase().includes(searchTerm) ||
          log.parameter.toLowerCase().includes(searchTerm)
      );
    }

    // Always maintain the sort order
    this.sortLogsByTimestamp();
  }

  /**
   * Sorts logs by timestamp (newest first)
   */
  private sortLogsByTimestamp(): void {
    this.filteredLogs.sort((a, b) => {
      const timeA = Number(a.ts);
      const timeB = Number(b.ts);
      return timeB - timeA; // Descending order (newest first)
    });
  }

  /**
   * Closes the dialog
   */
  closeDialog(): void {
    this.dialogRef.close();
  }
}
