import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TestFilesUploadFailedDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';

@Component({
  selector: 'coding-box-test-files-upload-failed-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    ScrollingModule
  ],
  templateUrl: './test-files-upload-failed-dialog.component.html',
  styleUrls: ['./test-files-upload-failed-dialog.component.scss']
})
export class TestFilesUploadFailedDialogComponent {
  filterText = '';

  constructor(
    private dialogRef: MatDialogRef<TestFilesUploadFailedDialogComponent>,
    @Inject(MAT_DIALOG_DATA)
    public data: { failedFiles: TestFilesUploadFailedDto[] }
  ) {}

  get failedFiles(): TestFilesUploadFailedDto[] {
    return this.data?.failedFiles || [];
  }

  get filteredFailedFiles(): TestFilesUploadFailedDto[] {
    const all = this.failedFiles;
    const q = (this.filterText || '').trim().toUpperCase();
    if (!q) {
      return all;
    }
    return all.filter(f => {
      const filename = (f.filename || '').toUpperCase();
      const reason = (f.reason || '').toUpperCase();
      return filename.includes(q) || reason.includes(q);
    });
  }

  trackByFn(index: number, item: TestFilesUploadFailedDto): string {
    return `${item.filename}@@${index}`;
  }

  close(): void {
    this.dialogRef.close();
  }
}
