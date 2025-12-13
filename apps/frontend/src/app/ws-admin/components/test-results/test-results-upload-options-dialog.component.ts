import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';

export type OverwriteMode = 'skip' | 'merge' | 'replace';

export type UploadScope = 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response';

export type TestResultsUploadOptionsDialogData = {
  resultType: 'logs' | 'responses';
  defaultOverwriteMode?: OverwriteMode;
  defaultScope?: UploadScope;
};

export type TestResultsUploadOptionsDialogResult = {
  overwriteMode: OverwriteMode;
  scope: UploadScope;
  groupName?: string;
  bookletName?: string;
  unitNameOrAlias?: string;
  variableId?: string;
  subform?: string;
};

@Component({
  selector: 'coding-box-test-results-upload-options-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule
  ],
  templateUrl: './test-results-upload-options-dialog.component.html',
  styleUrls: ['./test-results-upload-options-dialog.component.scss']
})
export class TestResultsUploadOptionsDialogComponent {
  overwriteMode: OverwriteMode;
  scope: UploadScope;
  groupName = '';
  bookletName = '';
  unitNameOrAlias = '';
  variableId = '';
  subform = '';

  constructor(
    private dialogRef: MatDialogRef<TestResultsUploadOptionsDialogComponent, TestResultsUploadOptionsDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsUploadOptionsDialogData
  ) {
    this.overwriteMode = data.defaultOverwriteMode || 'skip';
    this.scope = data.defaultScope || 'person';
  }

  close(): void {
    this.dialogRef.close(undefined);
  }

  confirm(): void {
    this.dialogRef.close({
      overwriteMode: this.overwriteMode,
      scope: this.scope,
      groupName: this.groupName?.trim() || undefined,
      bookletName: this.bookletName?.trim() || undefined,
      unitNameOrAlias: this.unitNameOrAlias?.trim() || undefined,
      variableId: this.variableId?.trim() || undefined,
      subform: this.subform?.trim() || undefined
    });
  }
}
