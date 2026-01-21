import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

export interface ApplyEmptyCodingDialogData {
  count: number;
}

@Component({
  selector: 'app-apply-empty-coding-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    TranslateModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon color="primary" class="header-icon">flash_on</mat-icon>
      {{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.title' | translate }}
    </h2>
    <mat-dialog-content>
      <p>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.description' | translate:{ count: data.count } }}</p>

      <div class="coding-info-box">
        <p><strong>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.apply-header' | translate }}</strong></p>
        <ul>
          <li>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.status' | translate }}: <strong>CODING_COMPLETE</strong></li>
          <li>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.code' | translate }}: <strong>-98</strong></li>
          <li>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.score' | translate }}: <strong>0</strong></li>
        </ul>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.cancel' | translate }}</button>
      <button mat-raised-button color="primary" (click)="onConfirm()">{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.confirm' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .header-icon {
      vertical-align: middle;
      margin-right: 8px;
    }
    mat-dialog-content {
      min-width: 500px;
    }
    .coding-info-box {
      background-color: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      margin: 16px 0;
      border-left: 4px solid #3f51b5;
    }
    .coding-info-box ul {
      margin: 8px 0 0 0;
      padding-left: 20px;
    }
    .warning-hint {
      font-size: 0.9em;
      color: #666;
      font-style: italic;
    }
  `]
})
export class ApplyEmptyCodingDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ApplyEmptyCodingDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ApplyEmptyCodingDialogData
  ) { }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
