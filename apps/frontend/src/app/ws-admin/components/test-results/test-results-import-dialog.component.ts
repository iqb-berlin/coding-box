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

export type TestResultsImportDialogResult = {
  type: 'testcenter' | 'responses' | 'logs';
};

@Component({
  selector: 'coding-box-test-results-import-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatListModule
  ],
  template: `
    <h2 mat-dialog-title>Import Test Results</h2>
    <mat-dialog-content>
      <mat-list>
        <mat-list-item (click)="selectImportType('testcenter')">
          <mat-icon matListItemIcon>cloud_download</mat-icon>
          <div matListItemTitle>Testcenter Import</div>
          <div matListItemLine>Import from Testcenter</div>
        </mat-list-item>
        <mat-divider></mat-divider>
        <mat-list-item (click)="selectImportType('responses')">
          <mat-icon matListItemIcon>upload</mat-icon>
          <div matListItemTitle>Antworten hochladen</div>
          <div matListItemLine>Upload responses from file</div>
        </mat-list-item>
        <mat-divider></mat-divider>
        <mat-list-item (click)="selectImportType('logs')">
          <mat-icon matListItemIcon>upload</mat-icon>
          <div matListItemTitle>Logs hochladen</div>
          <div matListItemLine>Upload logs from file</div>
        </mat-list-item>
      </mat-list>
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
    `
  ]
})
export class TestResultsImportDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<TestResultsImportDialogComponent>
  ) {}

  selectImportType(type: 'testcenter' | 'responses' | 'logs'): void {
    this.dialogRef.close({ type });
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
