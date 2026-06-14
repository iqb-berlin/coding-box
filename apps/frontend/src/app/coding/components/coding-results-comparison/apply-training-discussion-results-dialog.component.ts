import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import {
  TrainingDiscussionApplyPreviewDto,
  TrainingDiscussionApplySource,
  TrainingDiscussionExistingResultStrategy,
  TrainingDiscussionJobConflictStrategy
} from '../../../../../../../api-dto/coding/training-discussion-apply.dto';

export interface ApplyTrainingDiscussionResultsDialogData {
  preview: TrainingDiscussionApplyPreviewDto;
  source: TrainingDiscussionApplySource;
}

export interface ApplyTrainingDiscussionResultsDialogResult {
  existingResultStrategy: TrainingDiscussionExistingResultStrategy;
  jobConflictStrategy: TrainingDiscussionJobConflictStrategy;
}

@Component({
  selector: 'coding-box-apply-training-discussion-results-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ data.source === 'manual' ? 'rule' : 'verified' }}</mat-icon>
      {{ data.source === 'manual' ? 'Diskussionsergebnisse anwenden' : 'Schulungsergebnisse ohne Abweichungen anwenden' }}
    </h2>

    <mat-dialog-content>
      <p>
        Die ausgewählten Schulungsergebnisse werden als finale v2-Ergebnisse übernommen.
      </p>

      <div class="summary-grid">
        <div>
          <strong>{{ data.preview.applicableResultsCount }}</strong>
          <span>anwendbar</span>
        </div>
        <div>
          <strong>{{ data.preview.existingFinalResultsCount }}</strong>
          <span>bestehende v2-Ergebnisse</span>
        </div>
        <div>
          <strong>{{ data.preview.productiveJobConflictCount }}</strong>
          <span>in Kodierjobs</span>
        </div>
        <div>
          <strong>{{ data.preview.missingResultsCount }}</strong>
          <span>ohne Ergebnis</span>
        </div>
        <div>
          <strong>{{ data.preview.missingScoreCount }}</strong>
          <span>ohne Score</span>
        </div>
        <div>
          <strong>{{ data.preview.approvedJobDefinitionConflictCount }}</strong>
          <span>freigegebene Definitionen</span>
        </div>
      </div>

      <div class="warning-box" *ngIf="!data.preview.canApply">
        <mat-icon>block</mat-icon>
        <span>
          Die Schulung enthält veraltete Quellfälle. Bitte die betroffenen Trainingsjobs prüfen, bevor Ergebnisse angewendet werden.
        </span>
      </div>

      <section *ngIf="data.preview.existingFinalResultsCount > 0">
        <h3>Bestehende finale Ergebnisse</h3>
        <mat-radio-group [(ngModel)]="existingResultStrategy">
          <mat-radio-button value="skip">Bestehende v2-Ergebnisse überspringen</mat-radio-button>
          <mat-radio-button value="overwrite">Bestehende v2-Ergebnisse überschreiben</mat-radio-button>
        </mat-radio-group>
      </section>

      <section *ngIf="data.preview.productiveJobConflictCount > 0">
        <h3>Betroffene Kodierjobs</h3>
        <mat-radio-group [(ngModel)]="jobConflictStrategy">
          <mat-radio-button value="skip">Fälle in Kodierjobs überspringen</mat-radio-button>
          <mat-radio-button value="removeFromJobs">
            Aus unberührten Kodierjobs entfernen
          </mat-radio-button>
        </mat-radio-group>
        <div class="warning-box" *ngIf="data.preview.blockingProductiveJobUnitCount > 0">
          <mat-icon>warning</mat-icon>
          <span>
            {{ data.preview.blockingProductiveJobUnitCount }} betroffene Jobfälle enthalten bereits Kodierarbeit und werden nicht automatisch entfernt.
          </span>
        </div>
      </section>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Abbrechen</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!data.preview.canApply || data.preview.applicableResultsCount === 0"
        (click)="confirm()"
      >
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
      max-width: 640px;
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

    section {
      margin-top: 18px;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 15px;
      font-weight: 600;
    }

    mat-radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .warning-box {
      display: flex;
      gap: 12px;
      padding: 12px;
      margin: 14px 0;
      border-radius: 4px;
      background: #fff3e0;
      color: #7a3f00;
      line-height: 1.4;
    }

    .warning-box mat-icon {
      flex-shrink: 0;
    }
  `]
})
export class ApplyTrainingDiscussionResultsDialogComponent {
  existingResultStrategy: TrainingDiscussionExistingResultStrategy = 'skip';
  jobConflictStrategy: TrainingDiscussionJobConflictStrategy = 'skip';

  constructor(
    public dialogRef: MatDialogRef<ApplyTrainingDiscussionResultsDialogComponent, ApplyTrainingDiscussionResultsDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA)
    public data: ApplyTrainingDiscussionResultsDialogData
  ) { }

  confirm(): void {
    this.dialogRef.close({
      existingResultStrategy: this.existingResultStrategy,
      jobConflictStrategy: this.jobConflictStrategy
    });
  }
}
