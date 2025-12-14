import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TestFilesUploadConflictDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';

export type TestFilesUploadConflictsDialogResult = {
  overwrite: boolean;
  overwriteFileIds?: string[];
};

@Component({
  selector: 'coding-box-test-files-upload-conflicts-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    ScrollingModule
  ],
  templateUrl: './test-files-upload-conflicts-dialog.component.html',
  styleUrls: ['./test-files-upload-conflicts-dialog.component.scss']
})
export class TestFilesUploadConflictsDialogComponent {
  filterText = '';
  private selectedFileIds = new Set<string>();

  constructor(
    private dialogRef: MatDialogRef<TestFilesUploadConflictsDialogComponent, TestFilesUploadConflictsDialogResult>,
    @Inject(MAT_DIALOG_DATA)
    public data: { conflicts: TestFilesUploadConflictDto[] }
  ) {}

  get conflicts(): TestFilesUploadConflictDto[] {
    return this.data?.conflicts || [];
  }

  get filteredConflicts(): TestFilesUploadConflictDto[] {
    const all = this.conflicts;
    const q = (this.filterText || '').trim().toUpperCase();
    if (!q) {
      return all;
    }
    return all.filter(c => {
      const filename = (c.filename || '').toUpperCase();
      const fileId = (c.fileId || '').toUpperCase();
      const fileType = (c.fileType || '').toUpperCase();
      return filename.includes(q) || fileId.includes(q) || fileType.includes(q);
    });
  }

  trackByConflict(index: number, item: TestFilesUploadConflictDto): string {
    return `${item.fileId}@@${item.filename}@@${item.fileType || ''}@@${index}`;
  }

  isSelected(c: TestFilesUploadConflictDto): boolean {
    return !!c?.fileId && this.selectedFileIds.has(c.fileId);
  }

  toggleSelected(c: TestFilesUploadConflictDto): void {
    const id = c?.fileId;
    if (!id) {
      return;
    }
    if (this.selectedFileIds.has(id)) {
      this.selectedFileIds.delete(id);
    } else {
      this.selectedFileIds.add(id);
    }
  }

  get selectedCount(): number {
    return this.selectedFileIds.size;
  }

  get allFilteredSelected(): boolean {
    const filtered = this.filteredConflicts;
    if (filtered.length === 0) {
      return false;
    }
    return filtered.every(c => !!c.fileId && this.selectedFileIds.has(c.fileId));
  }

  get someFilteredSelected(): boolean {
    const filtered = this.filteredConflicts;
    if (filtered.length === 0) {
      return false;
    }
    return filtered.some(c => !!c.fileId && this.selectedFileIds.has(c.fileId)) && !this.allFilteredSelected;
  }

  toggleSelectAllFiltered(): void {
    const filtered = this.filteredConflicts;
    if (filtered.length === 0) {
      return;
    }
    if (this.allFilteredSelected) {
      filtered.forEach(c => {
        if (c.fileId) {
          this.selectedFileIds.delete(c.fileId);
        }
      });
    } else {
      filtered.forEach(c => {
        if (c.fileId) {
          this.selectedFileIds.add(c.fileId);
        }
      });
    }
  }

  clearSelection(): void {
    this.selectedFileIds.clear();
  }

  overwrite(): void {
    const overwriteFileIds = Array.from(this.selectedFileIds);
    this.dialogRef.close({ overwrite: true, overwriteFileIds });
  }

  skip(): void {
    this.dialogRef.close({ overwrite: false });
  }
}
