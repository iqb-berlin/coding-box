import { TranslateModule } from '@ngx-translate/core';
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';

export interface ApplyCodingResultsDialogData {
  jobName: string;
  totalResults?: number;
  codedResults?: number;
  reviewIssues?: number;
  hasReviewIssues?: boolean;
}

export interface ApplyCodingResultsDialogResult {
  overwriteExisting: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-apply-coding-results-dialog',
  standalone: true,
  imports: [TranslateModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>fact_check</mat-icon>
      {{ 'ui-text.apply-coding-results-dialog.kodierergebnisse-anwenden' | translate }}
    </h2>

    <mat-dialog-content>
      <p>
        {{ 'ui-text.apply-coding-results-dialog.die-ergebnisse-des-kodierjobs-werden-auf-die-antwortdaten-uebertragen' | translate: { jobName: (data.jobName) } }}
      </p>

      <div class="info-box">
        <mat-icon>info</mat-icon>
        <span>
          {{ 'ui-text.apply-coding-results-dialog.bestehende-v2-kodierungen-bleiben-standardmaessig-erhalten-aggregierte-ergebnisse-werden-n' | translate }}
        </span>
      </div>

      @if (hasSummary()) {
        <div class="summary-grid">
          <div>
            <strong>{{ data.totalResults ?? '-' }}</strong>
            <span>{{ 'ui-text.apply-coding-results-dialog.ergebnisse' | translate }}</span>
          </div>
          <div>
            <strong>{{ data.codedResults ?? '-' }}</strong>
            <span>{{ 'ui-text.apply-coding-results-dialog.kodiert' | translate }}</span>
          </div>
          <div>
            <strong>{{ data.reviewIssues ?? (data.hasReviewIssues ? 'vorhanden' : 0) }}</strong>
            <span>{{ 'ui-text.apply-coding-results-dialog.mit-pruefung' | translate }}</span>
          </div>
        </div>
      }

      @if (hasReviewIssues()) {
        <div class="warning-box">
          <mat-icon>rule</mat-icon>
          <span>
            {{ 'ui-text.apply-coding-results-dialog.ergebnisse-mit-kodierungshinweis-werden-beim-anwenden-uebersprungen-bis-sie-manuell-geprue' | translate }}
          </span>
        </div>
      }

      <mat-checkbox [(ngModel)]="overwriteExisting" color="warn">
        {{ 'ui-text.apply-coding-results-dialog.bestehende-v2-kodierungen-ueberschreiben' | translate }}
      </mat-checkbox>

      @if (overwriteExisting) {
        <div class="warning-box">
          <mat-icon>warning</mat-icon>
          <span>
            {{ 'ui-text.apply-coding-results-dialog.vorhandene-v2-kodierungen-fuer-direkte-ergebnisse-und-passende-aggregationsgruppen-werden' | translate }}
          </span>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">{{ 'cancel' | translate }}</button>
      <button mat-raised-button color="primary" (click)="onConfirm()">
        {{ 'coding.trainings.compare.apply-dialog.apply' | translate }}
      </button>
    </mat-dialog-actions>
    `,
  styles: [`
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    mat-dialog-content {
      max-width: 560px;
    }

    .info-box,
    .warning-box {
      display: flex;
      gap: 12px;
      padding: 12px;
      margin: 16px 0;
      border-radius: 4px;
      line-height: 1.4;
    }

    .info-box {
      background: #e8f3ff;
      color: #0d4778;
    }

    .warning-box {
      background: #fff3e0;
      color: #7a3f00;
    }

    .info-box mat-icon,
    .warning-box mat-icon {
      flex-shrink: 0;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 16px 0;
    }

    .summary-grid div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background: #fafafa;
    }

    .summary-grid strong {
      font-size: 18px;
      font-weight: 600;
    }

    .summary-grid span {
      color: #666;
      font-size: 12px;
    }
  `]
})
export class ApplyCodingResultsDialogComponent {
  dialogRef = inject<MatDialogRef<ApplyCodingResultsDialogComponent>>(MatDialogRef);
  protected data = inject<ApplyCodingResultsDialogData>(MAT_DIALOG_DATA);

  protected overwriteExisting = false;

  protected onCancel(): void {
    this.dialogRef.close(false);
  }

  protected onConfirm(): void {
    this.dialogRef.close({ overwriteExisting: this.overwriteExisting });
  }

  protected hasSummary(): boolean {
    return this.data.totalResults !== undefined ||
      this.data.codedResults !== undefined ||
      this.data.reviewIssues !== undefined ||
      this.data.hasReviewIssues !== undefined;
  }

  protected hasReviewIssues(): boolean {
    if (this.data.reviewIssues !== undefined) {
      return this.data.reviewIssues > 0;
    }
    return !!this.data.hasReviewIssues;
  }
}
