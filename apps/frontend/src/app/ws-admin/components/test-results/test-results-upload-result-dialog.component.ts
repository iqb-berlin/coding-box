import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TestResultsUploadIssueDto, TestResultsUploadResultDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

export type TestResultsUploadResultDialogData = {
  resultType: 'logs' | 'responses';
  result: TestResultsUploadResultDto;
};

@Component({
  selector: 'coding-box-test-results-upload-result-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatTabsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    ScrollingModule
  ],
  templateUrl: './test-results-upload-result-dialog.component.html',
  styleUrls: ['./test-results-upload-result-dialog.component.scss']
})
export class TestResultsUploadResultDialogComponent {
  filterText = '';

  constructor(
    private dialogRef: MatDialogRef<TestResultsUploadResultDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsUploadResultDialogData
  ) {}

  get result(): TestResultsUploadResultDto {
    return this.data.result;
  }

  get issues(): TestResultsUploadIssueDto[] {
    return this.result.issues || [];
  }

  get filteredIssues(): TestResultsUploadIssueDto[] {
    const q = (this.filterText || '').trim().toUpperCase();
    if (!q) {
      return this.issues;
    }
    return this.issues.filter(i => {
      const parts = [i.level, i.message, i.fileName, String(i.rowIndex ?? '')]
        .filter(Boolean)
        .map(s => String(s).toUpperCase());
      return parts.some(p => p.includes(q));
    });
  }

  get statusCounts(): Array<{ status: string; count: number }> {
    const map = (this.result.responseStatusCounts || {}) as Record<string, number>;
    return Object.entries(map)
      .map(([status, count]) => ({ status, count: Number(count) }))
      .sort((a, b) => a.status.localeCompare(b.status));
  }

  trackByIssue(index: number, item: TestResultsUploadIssueDto): string {
    return `${item.level}@@${item.fileName || ''}@@${item.rowIndex || ''}@@${item.message}@@${index}`;
  }

  close(): void {
    this.dialogRef.close();
  }
}
