import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

export interface ApplyEmptyCodingDialogData {
  count: number;
  code: number;
  score: number | null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-apply-empty-coding-dialog',
  standalone: true,
  imports: [
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
          <li>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.code' | translate }}: <strong>{{ data.code }}</strong></li>
          <li>{{ 'coding-management-manual.response-analysis.apply-empty-coding-dialog.score' | translate }}: <strong>{{ getScoreDisplay(data.score) }}</strong></li>
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
  dialogRef = inject<MatDialogRef<ApplyEmptyCodingDialogComponent>>(MatDialogRef);
  protected data = inject<ApplyEmptyCodingDialogData>(MAT_DIALOG_DATA);

  protected onCancel(): void {
    this.dialogRef.close(false);
  }

  protected onConfirm(): void {
    this.dialogRef.close(true);
  }

  protected getScoreDisplay(score: number | null): string | number {
    return score === null ? 'NA' : score;
  }
}
