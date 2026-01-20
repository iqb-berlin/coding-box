import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
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
    MatSelectModule,
    MatOptionModule,
    ScrollingModule
  ],
  templateUrl: './test-results-upload-result-dialog.component.html',
  styleUrls: ['./test-results-upload-result-dialog.component.scss']
})
export class TestResultsUploadResultDialogComponent {
  filterText = '';
  selectedCategory: string | null = null;

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
    let filtered = this.issues;

    // Filter by category
    if (this.selectedCategory) {
      filtered = filtered.filter(i => i.category === this.selectedCategory);
    }

    // Filter by search text
    const q = (this.filterText || '').trim().toUpperCase();
    if (q) {
      filtered = filtered.filter(i => {
        const parts = [i.level, i.message, i.fileName, i.category, String(i.rowIndex ?? '')]
          .filter(Boolean)
          .map(s => String(s).toUpperCase());
        return parts.some(p => p.includes(q));
      });
    }

    return filtered;
  }

  get statusCounts(): Array<{ status: string; count: number }> {
    const map = (this.result.responseStatusCounts || {}) as Record<string, number>;
    return Object.entries(map)
      .map(([status, count]) => ({ status, count: Number(count) }))
      .sort((a, b) => a.status.localeCompare(b.status));
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      log_format: 'Log Format',
      unit_not_found: 'Unit Not Found',
      invalid_unit: 'Invalid Unit',
      other: 'Other'
    };
    return labels[category] || category;
  }

  trackByIssue(index: number, item: TestResultsUploadIssueDto): string {
    return `${item.level}@@${item.fileName || ''}@@${item.rowIndex || ''}@@${item.message}@@${index}`;
  }

  detailView: 'booklets' | 'units' = 'booklets';
  detailFilterText = '';

  get bookletDetails(): { name: string; hasLog: boolean }[] {
    return this.result.logMetrics?.bookletDetails || [];
  }

  get unitDetails(): { bookletName: string; unitKey: string; hasLog: boolean }[] {
    return this.result.logMetrics?.unitDetails || [];
  }

  get filteredBookletDetails(): { name: string; hasLog: boolean }[] {
    const q = (this.detailFilterText || '').trim().toUpperCase();
    let list = this.bookletDetails;
    if (q) {
      list = list.filter(b => b.name.toUpperCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  get filteredUnitDetails(): { bookletName: string; unitKey: string; hasLog: boolean }[] {
    const q = (this.detailFilterText || '').trim().toUpperCase();
    let list = this.unitDetails;
    if (q) {
      list = list.filter(u => u.bookletName.toUpperCase().includes(q) ||
        u.unitKey.toUpperCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const cmpBooklet = a.bookletName.localeCompare(b.bookletName);
      if (cmpBooklet !== 0) return cmpBooklet;
      return a.unitKey.localeCompare(b.unitKey);
    });
  }

  trackByBookletDetail(index: number, item: { name: string; hasLog: boolean }): string {
    return `${item.name}-${item.hasLog}`;
  }

  trackByUnitDetail(index: number, item: { bookletName: string; unitKey: string; hasLog: boolean }): string {
    return `${item.bookletName}-${item.unitKey}-${item.hasLog}`;
  }

  onCategoryChange(): void {
    // Trigger change detection
  }

  close(): void {
    this.dialogRef.close();
  }
}
