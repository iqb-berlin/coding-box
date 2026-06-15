import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  selector: 'coding-box-apply-coding-results-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>fact_check</mat-icon>
      Kodierergebnisse anwenden
    </h2>

    <mat-dialog-content>
      <p>
        Die Ergebnisse des Kodierjobs "{{ data.jobName }}" werden auf die Antwortdaten übertragen.
      </p>

      <div class="info-box">
        <mat-icon>info</mat-icon>
        <span>
          Bestehende v2-Kodierungen bleiben standardmäßig erhalten. Aggregierte Ergebnisse werden nur
          auf passende Antworten derselben Aggregationsgruppe angewendet.
        </span>
      </div>

      <div class="summary-grid" *ngIf="hasSummary()">
        <div>
          <strong>{{ data.totalResults ?? '-' }}</strong>
          <span>Ergebnisse</span>
        </div>
        <div>
          <strong>{{ data.codedResults ?? '-' }}</strong>
          <span>kodiert</span>
        </div>
        <div>
          <strong>{{ data.reviewIssues ?? (data.hasReviewIssues ? 'vorhanden' : 0) }}</strong>
          <span>mit Prüfung</span>
        </div>
      </div>

      <div class="warning-box" *ngIf="hasReviewIssues()">
        <mat-icon>rule</mat-icon>
        <span>
          Ergebnisse mit Kodierungshinweis werden beim Anwenden übersprungen, bis sie manuell geprüft wurden.
        </span>
      </div>

      <mat-checkbox [(ngModel)]="overwriteExisting" color="warn">
        Bestehende v2-Kodierungen überschreiben
      </mat-checkbox>

      <div class="warning-box" *ngIf="overwriteExisting">
        <mat-icon>warning</mat-icon>
        <span>
          Vorhandene v2-Kodierungen für direkte Ergebnisse und passende Aggregationsgruppen werden ersetzt.
          Diese Option sollte nur für bewusst neu zu berechnende Ergebnisse genutzt werden.
        </span>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Abbrechen</button>
      <button mat-raised-button color="primary" (click)="onConfirm()">
        Anwenden
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
  overwriteExisting = false;

  constructor(
    public dialogRef: MatDialogRef<ApplyCodingResultsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ApplyCodingResultsDialogData
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close({ overwriteExisting: this.overwriteExisting });
  }

  hasSummary(): boolean {
    return this.data.totalResults !== undefined ||
      this.data.codedResults !== undefined ||
      this.data.reviewIssues !== undefined ||
      this.data.hasReviewIssues !== undefined;
  }

  hasReviewIssues(): boolean {
    if (this.data.reviewIssues !== undefined) {
      return this.data.reviewIssues > 0;
    }
    return !!this.data.hasReviewIssues;
  }
}
