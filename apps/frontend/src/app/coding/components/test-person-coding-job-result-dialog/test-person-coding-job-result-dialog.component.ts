import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { TranslateModule } from '@ngx-translate/core';
import { JobInfo } from '../../services/test-person-coding.service';

interface DialogData {
  job: JobInfo;
  formattedDuration?: string | null;
  autoCoderRun?: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-person-coding-job-result-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatTableModule, TranslateModule],
  templateUrl: './test-person-coding-job-result-dialog.component.html',
  styleUrls: ['./test-person-coding-job-result-dialog.component.scss']
})
export class TestPersonCodingJobResultDialogComponent {
  protected data = inject<DialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject<MatDialogRef<TestPersonCodingJobResultDialogComponent>>(MatDialogRef);

  protected displayedColumns = ['status', 'count'];
  protected statusRows: { status: string; count: number }[] = [];
  warnings: string[] = [];
  protected effectiveTotal = 0;

  constructor() {
    const data = this.data;

    const result = data.job.result;
    this.warnings = result?.warnings || [];
    if (result?.statusCounts) {
      const ignoredStatuses = [
        '0', '1', '2', '3', '10',
        'UNSET', 'NOT_REACHED', 'DISPLAYED', 'VALUE_CHANGED', 'PARTLY_DISPLAYED'
      ];

      this.statusRows = Object.entries(result.statusCounts)
        .filter(([status]) => !ignoredStatuses.includes(status))
        .map(([status, count]) => ({
          status: status || 'test-person-coding.jobs.table.unknown',
          count
        }));

      this.effectiveTotal = this.statusRows.reduce((sum, row) => sum + row.count, 0);
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
