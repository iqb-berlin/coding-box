import { TranslateModule } from '@ngx-translate/core';
import {
  Component, viewChild, ChangeDetectionStrategy, inject
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatListModule, MatSelectionList } from '@angular/material/list';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { getFileTypeLabel } from '../../utils/file-utils';

export type TestFilesZipExportOptions = {
  fileTypes: string[];
};

export type TestFilesZipExportOptionsDialogData = {
  availableFileTypes: string[];
  selectedFileTypes?: string[];
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-files-zip-export-options-dialog',
  standalone: true,
  imports: [TranslateModule,
    MatDialogModule,
    MatButtonModule,
    MatListModule,
    FormsModule
  ],
  template: `
    <h1 mat-dialog-title>{{ 'ui-text.test-files-zip-export-options-dialog.export-optionen' | translate }}</h1>
    <div mat-dialog-content>
      <p>{{ 'ui-text.test-files-zip-export-options-dialog.waehlen-sie-aus-welche-dateitypen-im-zip-enthalten-sein-sollen' | translate }}</p>

      <div class="selection-actions">
        <button mat-button (click)="selectAll()">{{ 'manual-coding-export.select-all' | translate }}</button>
        <button mat-button (click)="deselectAll()">{{ 'manual-coding-export.deselect-all' | translate }}</button>
      </div>

      <div class="list-container">
        <mat-selection-list
          #fileTypesList
          (selectionChange)="onSelectionChange()"
        >
          @for (type of dialogData.availableFileTypes; track type) {
          <mat-list-option [value]="type" [selected]="data.fileTypes.includes(type)">{{ getFileTypeLabel(type) }}</mat-list-option>
          }
        </mat-selection-list>
      </div>
    </div>

    <div mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">{{ 'cancel' | translate }}</button>
      <button mat-raised-button color="primary" (click)="download()">
        {{ 'ui-text.test-files-zip-export-options-dialog.download' | translate }}
      </button>
    </div>
  `,
  styles: [
    `
      .list-container {
        height: 380px;
        overflow-y: auto;
        border: 1px solid #ccc;
        margin-top: 10px;
      }

      .selection-actions {
        display: flex;
        gap: 10px;
        margin-top: 10px;
        margin-bottom: 5px;
      }
    `
  ]
})
export class TestFilesZipExportOptionsDialogComponent {
  private readonly uiTranslate = injectUiTranslator();

  private dialogRef = inject<MatDialogRef<TestFilesZipExportOptionsDialogComponent>>(MatDialogRef);
  protected dialogData = inject<TestFilesZipExportOptionsDialogData>(MAT_DIALOG_DATA);

  readonly fileTypesList = viewChild.required<MatSelectionList>('fileTypesList');

  protected data: TestFilesZipExportOptions = {
    fileTypes: []
  };

  protected getFileTypeLabel = getFileTypeLabel.bind(undefined, this.uiTranslate);

  constructor() {
    const dialogData = this.dialogData;

    this.data.fileTypes = [
      ...(dialogData.selectedFileTypes || dialogData.availableFileTypes || [])
    ];
  }

  protected onSelectionChange(): void {
    this.data.fileTypes = this.fileTypesList().selectedOptions.selected.map(
      option => option.value
    );
  }

  protected selectAll(): void {
    this.fileTypesList().selectAll();
    this.onSelectionChange();
  }

  protected deselectAll(): void {
    this.fileTypesList().deselectAll();
    this.onSelectionChange();
  }

  protected download(): void {
    this.dialogRef.close(this.data);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }
}
