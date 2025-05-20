import { Component, Inject, OnInit } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatList, MatListItem } from '@angular/material/list';
import { NgForOf } from '@angular/common';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'app-log-dialog',
  template: `
    <h1 mat-dialog-title>Logs</h1>
    <div mat-dialog-content>
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

  mat-dialog-content {
    max-height: 400px; /* Begrenzung der Höhe für Scrollbarkeit */
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
    MatButton
  ]
})
export class LogDialogComponent implements OnInit {
  constructor(
    public dialogRef: MatDialogRef<LogDialogComponent>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject(MAT_DIALOG_DATA) public data: { logs: any[] }
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
