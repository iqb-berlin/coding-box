import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  TestFilesUploadConflictDto,
  TestFilesUploadFailedDto,
  TestFilesUploadUploadedDto
} from '../../../../../../../api-dto/files/test-files-upload-result.dto';

export type TestFilesUploadResultDialogData = {
  attempted: number;
  uploadedFiles: TestFilesUploadUploadedDto[];
  failedFiles: TestFilesUploadFailedDto[];
  remainingConflicts: TestFilesUploadConflictDto[];
  overwriteSelectedCount?: number;
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
    @Inject(MAT_DIALOG_DATA) public data: TestFilesUploadResultDialogData
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
    return this.uploadedFiles.length;
  }

  get failedCount(): number {
    return this.failedFiles.length;
  }

  get remainingConflictsCount(): number {
    return this.remainingConflicts.length;
  }

  private matchesQuery(parts: Array<string | undefined | null>, q: string): boolean {
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
    return this.uploadedFiles.filter(f => this.matchesQuery([f.filename, f.fileId, f.fileType], q));
  }

  get filteredFailedFiles(): TestFilesUploadFailedDto[] {
    const q = this.filterText;
    return this.failedFiles.filter(f => this.matchesQuery([f.filename, f.reason], q));
  }

  get filteredRemainingConflicts(): TestFilesUploadConflictDto[] {
    const q = this.filterText;
    return this.remainingConflicts.filter(f => this.matchesQuery([f.filename, f.fileId, f.fileType], q));
  }

  trackByUploaded(index: number, item: TestFilesUploadUploadedDto): string {
    return `${item.fileId || ''}@@${item.filename}@@${item.fileType || ''}@@${index}`;
  }

  trackByFailed(index: number, item: TestFilesUploadFailedDto): string {
    return `${item.filename}@@${index}`;
  }

  trackByConflict(index: number, item: TestFilesUploadConflictDto): string {
    return `${item.fileId}@@${item.filename}@@${item.fileType || ''}@@${index}`;
  }

  close(): void {
    this.dialogRef.close();
  }
}
