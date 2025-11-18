import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogTitle, MatDialogContent, MatDialogActions
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { StandaloneUnitSchemerComponent } from '../schemer/unit-schemer.component';
import { UnitScheme } from '../schemer/unit-scheme.interface';
import { BackendService } from '../../../services/backend.service';
import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';

export interface SchemeEditorDialogData {
  workspaceId: number;
  fileId: string;
  fileName: string;
  content: string;
}

@Component({
  selector: 'app-scheme-editor-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDivider,
    StandaloneUnitSchemerComponent
  ],
  template: `
    <h2 mat-dialog-title>{{ data.fileName }}</h2>
    <mat-dialog-content>
        @if (schemerHtml && !isLoading) {
          <unit-schemer-standalone
            [schemerHtml]="schemerHtml"
            [unitScheme]="unitScheme"
            (schemeChanged)="onSchemeChanged($event)"
            (error)="onError($event)">
          </unit-schemer-standalone>
        } @else {
          <pre class="raw-json">{{ prettyScheme }}</pre>
        }
    </mat-dialog-content>
    <mat-divider></mat-divider>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Abbrechen</button>
      <button mat-button color="primary" [disabled]="!hasChanges" (click)="save()">Speichern</button>
    </mat-dialog-actions>
  `,
  styles: [`

    .raw-json {
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 12px;
      border-radius: 4px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    unit-schemer-standalone {
      display: block;
      height: 100%;
      width: 100%;
    }
  `]
})
export class SchemeEditorDialogComponent implements OnInit {
  schemerHtml = '';
  isLoading = true;
  hasChanges = false;

  unitScheme: UnitScheme = {
    scheme: '',
    schemeType: 'iqb-standard@3.2'
  };

  get prettyScheme(): string {
    const raw = this.unitScheme?.scheme ?? '';
    if (!raw) return '';
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw.toString?.() ?? String(raw);
    }
  }

  constructor(
    public dialogRef: MatDialogRef<SchemeEditorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SchemeEditorDialogData,
    private snackBar: MatSnackBar,
    private backendService: BackendService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadSchemerHtml();

    this.unitScheme = {
      scheme: this.data.content,
      schemeType: 'iqb-standard@3.2'
    };
    this.backendService.getVariableInfoForScheme(this.data.workspaceId, this.data.fileName)
      .subscribe({
        next: variables => {
          if (variables && variables.length > 0) {
            this.unitScheme = {
              ...this.unitScheme,
              variables
            };
          }
        },
        error: () => {
          this.snackBar.open(
            'Failed to load variable information for the scheme. The schemer will work without variable validation.',
            'OK',
            { duration: 5000 }
          );
        }
      });
  }

  loadSchemerHtml(): void {
    this.isLoading = true;

    this.backendService.getFilesList(this.data.workspaceId, 1, 10000, 'Schemer')
      .subscribe({
        next: response => {
          if (response.data && response.data.length > 0) {
            const sortedFiles = [...response.data].sort((a, b) => {
              if (!a.created_at || !b.created_at) return 0;
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });

            const latestFile = sortedFiles[0];

            this.backendService.downloadFile(this.data.workspaceId, latestFile.id)
              .subscribe({
                next: fileDownload => {
                  try {
                    const decodedContent = atob(fileDownload.base64Data);
                    this.schemerHtml = decodedContent;
                    this.isLoading = false;
                  } catch (error) {
                    this.snackBar.open('Failed to decode schemer HTML', 'Error', { duration: 3000 });
                  }
                },
                error: () => {
                  this.snackBar.open('Failed to download schemer HTML', 'Error', { duration: 3000 });
                }
              });
          }
        },
        error: () => {
          this.snackBar.open('Failed to fetch schemer files', 'Error', { duration: 3000 });
        }
      });
  }

  onSchemeChanged(scheme: UnitScheme): void {
    if (!scheme.variables && this.unitScheme.variables) {
      scheme.variables = this.unitScheme.variables;
    }
    this.unitScheme = scheme;
    this.hasChanges = true;
  }

  onError(error: string): void {
    this.snackBar.open(`Schemer error: ${error}`, 'Error', { duration: 3000 });
  }

  close(): void {
    if (this.hasChanges) {
      const confirmRef = this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: {
          title: 'Ungespeicherte Änderungen',
          content: 'Sie haben ungespeicherte Änderungen. Möchten Sie wirklich schließen?',
          confirmButtonLabel: 'Ja',
          showCancel: true
        }
      });

      confirmRef.afterClosed().subscribe(result => {
        if (result === true) {
          this.dialogRef.close(false);
        }
      });
    } else {
      this.dialogRef.close(false);
    }
  }

  save(): void {
    if (!this.hasChanges) {
      this.dialogRef.close(false);
      return;
    }

    // Always save to the same location as the scheme was loaded from: {fileId}.VOCS
    const schemeFilename = `${this.data.fileId}.VOCS`;
    this.backendService.getFilesList(this.data.workspaceId, 1, 10000, 'Resource')
      .subscribe({
        next: response => {
          // Find existing VOCS file with the same filename
          const existingFile = response.data?.find(file => file.filename === schemeFilename && file.file_type === 'Resource');

          if (existingFile) {
            // Delete the existing file
            this.backendService.deleteFiles(this.data.workspaceId, [existingFile.id])
              .subscribe(deleteSuccess => {
                if (deleteSuccess) {
                  this.uploadSchemeFile(schemeFilename);
                } else {
                  this.snackBar.open('Failed to update scheme', 'Error', { duration: 3000 });
                }
              });
          } else {
            this.uploadSchemeFile(schemeFilename);
          }
        },
        error: () => {
          this.snackBar.open('Failed to fetch files list', 'Error', { duration: 3000 });
        }
      });
  }

  private uploadSchemeFile(filename: string): void {
    const blob = new Blob([this.unitScheme.scheme], { type: 'application/octet-stream' });
    const file = new File([blob], filename, { type: 'application/octet-stream' });

    const formData = new FormData();
    formData.append('files', file);

    this.backendService.uploadTestFiles(this.data.workspaceId, formData)
      .subscribe(uploadSuccess => {
        if (uploadSuccess) {
          this.snackBar.open('Scheme saved successfully', 'Success', { duration: 3000 });
          this.dialogRef.close(true);
        } else {
          this.snackBar.open('Failed to save scheme', 'Error', { duration: 3000 });
        }
      });
  }
}
