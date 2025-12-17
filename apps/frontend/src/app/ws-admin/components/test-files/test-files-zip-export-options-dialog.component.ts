import { CommonModule } from '@angular/common';
import {
  Component, Inject, ViewChild, AfterViewInit
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatListModule, MatSelectionList } from '@angular/material/list';

export type TestFilesZipExportOptions = {
  fileTypes: string[];
};

export type TestFilesZipExportOptionsDialogData = {
  availableFileTypes: string[];
  selectedFileTypes?: string[];
};

@Component({
  selector: 'coding-box-test-files-zip-export-options-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatListModule,
    FormsModule
  ],
  template: `
    <h1 mat-dialog-title>Export-Optionen</h1>
    <div mat-dialog-content>
      <p>Wählen Sie aus, welche Dateitypen im ZIP enthalten sein sollen.</p>

      <div class="selection-actions">
        <button mat-button (click)="selectAll()">Alle auswählen</button>
        <button mat-button (click)="deselectAll()">Alle abwählen</button>
      </div>

      <div class="list-container">
        <mat-selection-list
          #fileTypesList
          (selectionChange)="onSelectionChange()"
        >
          @for (type of dialogData.availableFileTypes; track type) {
          <mat-list-option [value]="type">{{ type }}</mat-list-option>
          }
        </mat-selection-list>
      </div>
    </div>

    <div mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Abbrechen</button>
      <button mat-raised-button color="primary" (click)="download()">
        Download
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
export class TestFilesZipExportOptionsDialogComponent implements AfterViewInit {
  @ViewChild('fileTypesList') fileTypesList!: MatSelectionList;

  data: TestFilesZipExportOptions = {
    fileTypes: []
  };

  constructor(
    private dialogRef: MatDialogRef<TestFilesZipExportOptionsDialogComponent>,
    @Inject(MAT_DIALOG_DATA)
    public dialogData: TestFilesZipExportOptionsDialogData
  ) {
    this.data.fileTypes = [
      ...(dialogData.selectedFileTypes || dialogData.availableFileTypes || [])
    ];
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.fileTypesList && this.data.fileTypes.length > 0) {
        this.fileTypesList.options.forEach(option => {
          if (this.data.fileTypes.includes(option.value)) {
            option.selected = true;
          }
        });
      }
    });
  }

  onSelectionChange(): void {
    this.data.fileTypes = this.fileTypesList.selectedOptions.selected.map(
      option => option.value
    );
  }

  selectAll(): void {
    this.fileTypesList.selectAll();
    this.onSelectionChange();
  }

  deselectAll(): void {
    this.fileTypesList.deselectAll();
    this.onSelectionChange();
  }

  download(): void {
    this.dialogRef.close(this.data);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
