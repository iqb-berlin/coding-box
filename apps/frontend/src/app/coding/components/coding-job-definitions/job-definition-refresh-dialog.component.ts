import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { JobDefinitionRefreshPreviewDto } from '../../../../../../../api-dto/coding/job-refresh.dto';

export interface JobDefinitionRefreshDialogData {
  definitionId: number;
  preview: JobDefinitionRefreshPreviewDto;
}

type RefreshStatTone = 'default' | 'positive' | 'negative' | 'warning';

interface RefreshStat {
  labelKey: string;
  value: number;
  tone: RefreshStatTone;
}

@Component({
  selector: 'coding-box-job-definition-refresh-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    TranslateModule
  ],
  template: `
    <div class="refresh-dialog">
      <div class="dialog-header">
        <mat-icon [class.blocked]="!preview.canApply">
          {{ preview.canApply ? 'sync' : 'lock' }}
        </mat-icon>
        <div>
          <h2 mat-dialog-title>
            {{ (preview.canApply
              ? 'coding-job-definitions.refresh-dialog.title.apply'
              : 'coding-job-definitions.refresh-dialog.title.blocked') | translate }}
          </h2>
          <p class="definition-label">
            {{ 'coding-job-definitions.refresh-dialog.definition-label' | translate: { id: data.definitionId } }}
          </p>
        </div>
      </div>

      <mat-dialog-content>
        <p class="intro">
          {{ (preview.canApply
            ? 'coding-job-definitions.refresh-dialog.intro.apply'
            : 'coding-job-definitions.refresh-dialog.intro.blocked') | translate }}
        </p>

        @if (!preview.canApply) {
        <div class="blocking-note" role="status">
          <mat-icon>info</mat-icon>
          <span>{{ getBlockingReason() }}</span>
        </div>
        }

        <div
          class="rules-list"
          [attr.aria-label]="'coding-job-definitions.refresh-dialog.rules-label' | translate">
          <div class="rule-item">
            <mat-icon>delete_sweep</mat-icon>
            <span>{{ 'coding-job-definitions.refresh-dialog.rules.replace-open' | translate }}</span>
          </div>
          <div class="rule-item">
            <mat-icon>verified_user</mat-icon>
            <span>{{ 'coding-job-definitions.refresh-dialog.rules.keep-work' | translate }}</span>
          </div>
          <div class="rule-item">
            <mat-icon>schema</mat-icon>
            <span>{{ 'coding-job-definitions.refresh-dialog.rules.use-current-definition' | translate }}</span>
          </div>
        </div>

        <mat-divider></mat-divider>

        <h3>{{ 'coding-job-definitions.refresh-dialog.preview-title' | translate }}</h3>
        <div class="stats-grid">
          @for (stat of getJobStats(); track stat.labelKey) {
          <div class="stat-item" [ngClass]="stat.tone">
            <span>{{ stat.labelKey | translate }}</span>
            <strong>{{ stat.value }}</strong>
          </div>
          }
        </div>

        <h3>{{ 'coding-job-definitions.refresh-dialog.case-title' | translate }}</h3>
        <div class="stats-grid">
          @for (stat of getCaseStats(); track stat.labelKey) {
          <div class="stat-item" [ngClass]="stat.tone">
            <span>{{ stat.labelKey | translate }}</span>
            <strong>{{ stat.value }}</strong>
          </div>
          }
        </div>

        <h3>{{ 'coding-job-definitions.refresh-dialog.task-title' | translate }}</h3>
        <div class="stats-grid compact">
          @for (stat of getTaskStats(); track stat.labelKey) {
          <div class="stat-item" [ngClass]="stat.tone">
            <span>{{ stat.labelKey | translate }}</span>
            <strong>{{ stat.value }}</strong>
          </div>
          }
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="close()">
          {{ (preview.canApply ? 'common.cancel' : 'common.close') | translate }}
        </button>
        @if (preview.canApply) {
        <button mat-raised-button color="primary" type="button" (click)="confirm()">
          <mat-icon>sync</mat-icon>
          {{ 'coding-job-definitions.refresh-dialog.confirm' | translate }}
        </button>
        }
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .refresh-dialog {
      display: block;
      max-width: 640px;
    }

    .dialog-header {
      align-items: flex-start;
      display: flex;
      gap: 12px;
      padding: 20px 24px 8px;
    }

    .dialog-header > mat-icon {
      color: #1976d2;
      flex: 0 0 auto;
      font-size: 28px;
      height: 28px;
      margin-top: 2px;
      width: 28px;
    }

    .dialog-header > mat-icon.blocked {
      color: #ad1457;
    }

    h2[mat-dialog-title] {
      margin: 0;
      padding: 0;
      font-size: 1.25rem;
      line-height: 1.3;
    }

    .definition-label {
      color: rgba(0, 0, 0, 0.6);
      font-size: 0.86rem;
      margin: 4px 0 0;
    }

    mat-dialog-content {
      color: rgba(0, 0, 0, 0.78);
      display: block;
      padding: 8px 24px 4px;
    }

    .intro {
      line-height: 1.45;
      margin: 0 0 14px;
    }

    .blocking-note {
      align-items: flex-start;
      background: #fce4ec;
      border: 1px solid rgba(173, 20, 87, 0.18);
      border-radius: 6px;
      color: #7b1b43;
      display: flex;
      gap: 8px;
      line-height: 1.4;
      margin-bottom: 14px;
      padding: 10px 12px;
    }

    .blocking-note mat-icon {
      flex: 0 0 auto;
      font-size: 20px;
      height: 20px;
      width: 20px;
    }

    .rules-list {
      display: grid;
      gap: 8px;
      margin-bottom: 16px;
    }

    .rule-item {
      align-items: flex-start;
      display: flex;
      gap: 8px;
      line-height: 1.35;
    }

    .rule-item mat-icon {
      color: #2e7d32;
      flex: 0 0 auto;
      font-size: 19px;
      height: 19px;
      width: 19px;
    }

    h3 {
      color: rgba(0, 0, 0, 0.82);
      font-size: 0.92rem;
      font-weight: 700;
      margin: 18px 0 8px;
    }

    .stats-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }

    .stats-grid.compact {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    .stat-item {
      background: #fafafa;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 6px;
      min-width: 0;
      padding: 10px 12px;
    }

    .stat-item span {
      color: rgba(0, 0, 0, 0.62);
      display: block;
      font-size: 0.76rem;
      font-weight: 700;
      line-height: 1.25;
      margin-bottom: 4px;
      overflow-wrap: anywhere;
      text-transform: uppercase;
    }

    .stat-item strong {
      color: #1976d2;
      display: block;
      font-size: 1.35rem;
      line-height: 1.1;
    }

    .stat-item.positive strong {
      color: #2e7d32;
    }

    .stat-item.negative strong {
      color: #c62828;
    }

    .stat-item.warning strong {
      color: #ef6c00;
    }

    mat-dialog-actions {
      gap: 8px;
      padding: 16px 24px 20px;
    }

    mat-dialog-actions mat-icon {
      font-size: 18px;
      height: 18px;
      margin-right: 4px;
      width: 18px;
    }
  `]
})
export class JobDefinitionRefreshDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<JobDefinitionRefreshDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: JobDefinitionRefreshDialogData,
    private translateService: TranslateService
  ) {}

  get preview(): JobDefinitionRefreshPreviewDto {
    return this.data.preview;
  }

  getBlockingReason(): string {
    return this.preview.blockingReason ||
      this.translateService.instant(
        'coding-job-definitions.refresh-dialog.blocking-fallback'
      );
  }

  getJobStats(): RefreshStat[] {
    return [
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.existing-jobs',
        value: this.preview.existingJobsCount,
        tone: 'default'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.replaceable-jobs',
        value: this.preview.staleJobsCount,
        tone: this.preview.staleJobsCount > 0 ? 'warning' : 'default'
      }
    ];
  }

  getCaseStats(): RefreshStat[] {
    return [
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.existing-cases',
        value: this.preview.existingCases,
        tone: 'default'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.planned-cases',
        value: this.preview.plannedCases,
        tone: 'default'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.retained-cases',
        value: this.preview.retainedCases,
        tone: 'positive'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.added-cases',
        value: this.preview.addedCases,
        tone: this.preview.addedCases > 0 ? 'positive' : 'default'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.removed-cases',
        value: this.preview.removedCases,
        tone: this.preview.removedCases > 0 ? 'negative' : 'default'
      }
    ];
  }

  getTaskStats(): RefreshStat[] {
    return [
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.added-tasks',
        value: this.preview.addedCodingTasks,
        tone: this.preview.addedCodingTasks > 0 ? 'positive' : 'default'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.removed-tasks',
        value: this.preview.removedCodingTasks,
        tone: this.preview.removedCodingTasks > 0 ? 'negative' : 'default'
      }
    ];
  }

  close(): void {
    this.dialogRef.close(false);
  }

  confirm(): void {
    if (this.preview.canApply) {
      this.dialogRef.close(true);
    }
  }
}
