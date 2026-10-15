import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-results-upload-options-dialog',
  standalone: true,
  imports: [
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
  private dialogRef = inject<MatDialogRef<TestResultsUploadOptionsDialogComponent, TestResultsUploadOptionsDialogResult | undefined>>(MatDialogRef);
  protected data = inject<TestResultsUploadOptionsDialogData>(MAT_DIALOG_DATA);

  protected overwriteMode: OverwriteMode;
  protected scope: UploadScope;
  protected groupName = '';
  protected bookletName = '';
  protected unitNameOrAlias = '';
  protected variableId = '';
  protected subform = '';

  constructor() {
    const data = this.data;

    this.overwriteMode = data.defaultOverwriteMode || 'skip';
    this.scope = data.defaultScope || 'person';
  }

  protected close(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
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
