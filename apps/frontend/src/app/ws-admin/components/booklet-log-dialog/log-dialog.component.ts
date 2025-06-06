import { Component, Inject, OnInit } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatList, MatListItem } from '@angular/material/list';
import { NgForOf, NgIf } from '@angular/common';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'app-log-dialog',
  template: `
    <h1 mat-dialog-title>Logs</h1>
    <div mat-dialog-content>
      <div *ngIf="data.sessions && data.sessions.length > 0" class="session-section">
        <h2>Session Information</h2>
        <div class="session-list">
          <div *ngFor="let session of data.sessions" class="session-item">
            <div class="session-timestamp">
              {{ formatTimestamp(session.ts) }}
            </div>
            <div class="session-details">
              <div><strong>Browser:</strong> {{ session.browser || 'Unknown' }}</div>
              <div><strong>OS:</strong> {{ session.os || 'Unknown' }}</div>
              <div><strong>Screen:</strong> {{ session.screen || 'Unknown' }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs Section -->
      <h2>Booklet Logs</h2>
      <mat-list>
        <mat-list-item *ngFor="let log of data.logs">
          <div class="log-item">
            <div class="log-timestamp">
             {{ formatTimestamp(log.ts) }}
            </div>
            <div class="log-header">
              <strong>{{ log.key }}</strong> – {{ log.parameter }}
            </div>
          </div>
        </mat-list-item>
      </mat-list>
    </div>
    <div mat-dialog-actions align="end">
      <button mat-stroked-button color="primary" (click)="closeDialog()">Schließen</button>
    </div>
  `,
  styles: [`
  .log-item {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
  }

  .log-header {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 4px;
  }

  .log-timestamp {
    font-size: 12px;
    color: #757575;
  }

  .session-section {
    margin-bottom: 20px;
    padding: 15px;
    background-color: #f5f5f5;
    border-radius: 4px;
  }

  .session-section h2 {
    margin-top: 0;
    font-size: 16px;
    color: #333;
    margin-bottom: 10px;
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .session-item {
    padding: 10px;
    background-color: white;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .session-timestamp {
    font-size: 12px;
    color: #757575;
    margin-bottom: 5px;
  }

  .session-details {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .session-details div {
    font-size: 14px;
  }

  h2 {
    font-size: 16px;
    color: #333;
    margin-bottom: 10px;
  }

  mat-dialog-content {
    max-height: 500px; /* Increased height to accommodate more content */
    overflow-y: auto;
  }

  mat-dialog-actions {
    margin-top: 16px;
  }
`],

  imports: [
    MatListItem,
    MatList,
    NgForOf,
    MatDialogContent,
    MatDialogTitle,
    MatDialogActions,
    MatButton,
    NgIf
  ]
})
export class LogDialogComponent implements OnInit {
  constructor(
    public dialogRef: MatDialogRef<LogDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      logs: {
        id: number;
        bookletid: number;
        ts: string;
        key: string;
        parameter: string;
      }[],
      sessions?: {
        id: number;
        browser: string;
        os: string;
        screen: string;
        ts: string;
      }[]
    }
  ) { }

  ngOnInit(): void {}

  formatTimestamp(timestamp: string): string {
    const date = new Date(Number(timestamp));
    return date.toLocaleString();
  }

  closeDialog() {
    this.dialogRef.close();
  }
}
