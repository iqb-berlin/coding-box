import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-apply-training-discussion-results-dialog',
  standalone: true,
  imports: [
    TranslateModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ data.source === 'manual' ? 'rule' : 'verified' }}</mat-icon>
      {{ (data.source === 'manual' ? 'coding.trainings.compare.apply-discussion' : 'coding.trainings.compare.apply-agreements') | translate }}
    </h2>

    <mat-dialog-content>
      <p>
        {{ 'coding.trainings.compare.apply-dialog.description' | translate }}
      </p>

      <div class="summary-grid">
        <div>
          <strong>{{ data.preview.applicableResultsCount }}</strong>
          <span>{{ 'coding.trainings.compare.apply-dialog.applicable' | translate }}</span>
        </div>
        <div>
          <strong>{{ data.preview.existingFinalResultsCount }}</strong>
          <span>{{ 'coding.trainings.compare.apply-dialog.existing-results' | translate }}</span>
        </div>
        <div>
          <strong>{{ data.preview.productiveJobConflictCount }}</strong>
          <span>{{ 'coding.trainings.compare.apply-dialog.in-jobs' | translate }}</span>
        </div>
        <div>
          <strong>{{ data.preview.missingResultsCount }}</strong>
          <span>{{ 'coding.trainings.compare.apply-dialog.without-result' | translate }}</span>
        </div>
        <div>
          <strong>{{ data.preview.missingScoreCount }}</strong>
          <span>{{ 'coding.trainings.compare.apply-dialog.without-score' | translate }}</span>
        </div>
        <div>
          <strong>{{ data.preview.approvedJobDefinitionConflictCount }}</strong>
          <span>{{ 'coding.trainings.compare.apply-dialog.approved-definitions' | translate }}</span>
        </div>
      </div>

      @if (!data.preview.canApply) {
        <div class="warning-box">
          <mat-icon>block</mat-icon>
          <span>
            {{ 'coding.trainings.compare.apply-dialog.stale-cases' | translate }}
          </span>
        </div>
      }

      @if (data.preview.existingFinalResultsCount > 0) {
        <section>
          <h3>{{ 'coding.trainings.compare.apply-dialog.existing-results-title' | translate }}</h3>
          <mat-radio-group [(ngModel)]="existingResultStrategy">
            <mat-radio-button value="skip">{{ 'coding.trainings.compare.apply-dialog.skip-existing' | translate }}</mat-radio-button>
            <mat-radio-button value="overwrite">{{ 'coding.trainings.compare.apply-dialog.overwrite-existing' | translate }}</mat-radio-button>
          </mat-radio-group>
        </section>
      }

      @if (data.preview.productiveJobConflictCount > 0) {
        <section>
          <h3>{{ 'coding.trainings.compare.apply-dialog.affected-jobs' | translate }}</h3>
          <mat-radio-group [(ngModel)]="jobConflictStrategy">
            <mat-radio-button value="skip">{{ 'coding.trainings.compare.apply-dialog.skip-jobs' | translate }}</mat-radio-button>
            <mat-radio-button value="removeFromJobs">
              {{ 'coding.trainings.compare.apply-dialog.remove-untouched-jobs' | translate }}
            </mat-radio-button>
          </mat-radio-group>
          @if (data.preview.blockingProductiveJobUnitCount > 0) {
            <div class="warning-box">
              <mat-icon>warning</mat-icon>
              <span>
                {{ 'coding.trainings.compare.apply-dialog.blocked-jobs' | translate:{count: data.preview.blockingProductiveJobUnitCount} }}
              </span>
            </div>
          }
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ 'coding.trainings.compare.apply-dialog.cancel' | translate }}</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!data.preview.canApply || data.preview.applicableResultsCount === 0"
        (click)="confirm()"
        >
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
  protected dialogRef = inject<MatDialogRef<ApplyTrainingDiscussionResultsDialogComponent, ApplyTrainingDiscussionResultsDialogResult | undefined>>(MatDialogRef);
  protected data = inject<ApplyTrainingDiscussionResultsDialogData>(MAT_DIALOG_DATA);

  protected existingResultStrategy: TrainingDiscussionExistingResultStrategy = 'skip';
  protected jobConflictStrategy: TrainingDiscussionJobConflictStrategy = 'skip';

  protected confirm(): void {
    this.dialogRef.close({
      existingResultStrategy: this.existingResultStrategy,
      jobConflictStrategy: this.jobConflictStrategy
    });
  }
}
