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
import {
  JobDefinitionRefreshItemDeltaDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../../api-dto/coding/job-refresh.dto';

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
  templateUrl: './job-definition-refresh-dialog.component.html',
  styleUrls: ['./job-definition-refresh-dialog.component.scss']
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
        labelKey: 'coding-job-definitions.refresh-dialog.stats.stale-jobs',
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

  getAddedItemDeltas(): JobDefinitionRefreshItemDeltaDto[] {
    return (this.preview.itemDeltas || [])
      .filter(delta => delta.addedCases > 0 || delta.addedCodingTasks > 0);
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
