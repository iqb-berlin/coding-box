import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  selector: 'coding-box-test-person-coding-job-result-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatTableModule, TranslateModule],
  templateUrl: './test-person-coding-job-result-dialog.component.html',
  styleUrls: ['./test-person-coding-job-result-dialog.component.scss']
})
export class TestPersonCodingJobResultDialogComponent {
  displayedColumns = ['status', 'count'];
  statusRows: { status: string; count: number }[] = [];
  effectiveTotal = 0;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
    private dialogRef: MatDialogRef<TestPersonCodingJobResultDialogComponent>
  ) {
    const result = data.job.result;
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

  close(): void {
    this.dialogRef.close();
  }
}
