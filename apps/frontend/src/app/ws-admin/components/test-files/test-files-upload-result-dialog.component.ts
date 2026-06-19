import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import {
  TestFilesUploadConflictDto,
  TestFilesUploadFailedDto,
  TestFilesUploadUploadedDto
} from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

export type TestFilesUploadResultDialogData = {
  workspaceId?: number;
  attempted: number;
  uploadedCount?: number;
  failedCount?: number;
  remainingConflictsCount?: number;
  uploadedFiles: TestFilesUploadUploadedDto[];
  failedFiles: TestFilesUploadFailedDto[];
  remainingConflicts: TestFilesUploadConflictDto[];
  overwriteSelectedCount?: number;
  issues?: TestResultsUploadIssueDto[];
};

@Component({
  selector: 'coding-box-test-files-upload-result-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTabsModule,
    ScrollingModule
  ],
  templateUrl: './test-files-upload-result-dialog.component.html',
  styleUrls: ['./test-files-upload-result-dialog.component.scss']
})
export class TestFilesUploadResultDialogComponent {
  filterText = '';

  constructor(
    private dialogRef: MatDialogRef<TestFilesUploadResultDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TestFilesUploadResultDialogData,
    private router: Router
  ) {}

  get attempted(): number {
    return this.data?.attempted || 0;
  }

  get overwriteSelectedCount(): number {
    return this.data?.overwriteSelectedCount || 0;
  }

  get uploadedFiles(): TestFilesUploadUploadedDto[] {
    return this.data?.uploadedFiles || [];
  }

  get failedFiles(): TestFilesUploadFailedDto[] {
    return this.data?.failedFiles || [];
  }

  get remainingConflicts(): TestFilesUploadConflictDto[] {
    return this.data?.remainingConflicts || [];
  }

  get uploadedCount(): number {
    return this.data?.uploadedCount ?? this.uploadedFiles.length;
  }

  get failedCount(): number {
    return this.data?.failedCount ?? this.failedFiles.length;
  }

  get remainingConflictsCount(): number {
    return this.data?.remainingConflictsCount ?? this.remainingConflicts.length;
  }

  get issues(): TestResultsUploadIssueDto[] {
    return this.data.issues || [];
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

  get hasCodingFreshnessWarning(): boolean {
    return this.issues.some(issue => issue.category === 'coding_freshness');
  }

  get canCheckCodingStatus(): boolean {
    return !!this.data.workspaceId && this.hasCodingFreshnessWarning;
  }

  private matchesQuery(
    parts: Array<string | undefined | null>,
    q: string
  ): boolean {
    const qq = (q || '').trim().toUpperCase();
    if (!qq) {
      return true;
    }
    return parts
      .map(p => (p || '').toUpperCase())
      .some(p => p.includes(qq));
  }

  get filteredUploadedFiles(): TestFilesUploadUploadedDto[] {
    const q = this.filterText;
    return this.uploadedFiles.filter(f => this.matchesQuery([f.filename, f.fileId, f.fileType], q)
    );
  }

  get filteredFailedFiles(): TestFilesUploadFailedDto[] {
    const q = this.filterText;
    return this.failedFiles.filter(f => this.matchesQuery([f.filename, f.reason], q)
    );
  }

  get filteredRemainingConflicts(): TestFilesUploadConflictDto[] {
    const q = this.filterText;
    return this.remainingConflicts.filter(f => this.matchesQuery([f.filename, f.fileId, f.fileType], q)
    );
  }

  trackByUploaded(index: number, item: TestFilesUploadUploadedDto): string {
    return `${item.fileId || ''}@@${item.filename}@@${
      item.fileType || ''
    }@@${index}`;
  }

  trackByFailed(index: number, item: TestFilesUploadFailedDto): string {
    return `${item.filename}@@${index}`;
  }

  trackByConflict(index: number, item: TestFilesUploadConflictDto): string {
    return `${item.fileId}@@${item.filename}@@${item.fileType || ''}@@${index}`;
  }

  trackByIssue(index: number, item: TestResultsUploadIssueDto): string {
    return `${item.level}@@${item.fileName || ''}@@${item.rowIndex || ''}@@${item.message}@@${index}`;
  }

  close(): void {
    this.dialogRef.close();
  }

  checkCodingStatus(): void {
    if (!this.data.workspaceId) {
      return;
    }

    this.dialogRef.close();
    this.router.navigate(
      [`/workspace-admin/${this.data.workspaceId}/coding/management`],
      { queryParams: { refreshCodingFreshness: '1' } }
    );
  }
}
