import { Component, Inject, OnInit } from '@angular/core';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogTitle, MatDialogContent, MatDialogActions
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { StandaloneUnitSchemerComponent } from '../schemer/unit-schemer.component';
import { UnitScheme } from '../schemer/unit-scheme.interface';
import { FileService } from '../../../shared/services/file/file.service';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';

import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';

export interface SchemeEditorDialogData {
  workspaceId: number;
  fileId: string;
  fileName: string;
  content: string;
  readOnly?: boolean;
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
    TranslateModule,
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
      <button mat-button (click)="close()">{{ 'close' | translate }}</button>
      @if (!data.readOnly) {
        <button mat-button color="primary" [disabled]="!hasChanges" (click)="save()">{{ 'save' | translate }}</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    mat-dialog-content {
      flex: 1;
      padding: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
    }

    unit-schemer-standalone {
      display: block;
      height: 100%;
      width: 100%;
    }

    .raw-json {
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    mat-dialog-actions {
      margin: 0 !important;
      padding: 0 !important;
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
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw.toString?.() ?? String(raw);
    }
  }

  constructor(
    public dialogRef: MatDialogRef<SchemeEditorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SchemeEditorDialogData,
    private snackBar: MatSnackBar,
    private fileService: FileService,
    private translate: TranslateService,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    this.loadSchemerHtml();

    this.unitScheme = {
      scheme: this.data.content,
      schemeType: 'iqb-standard@3.2'
    };
    this.fileService.getVariableInfoForScheme(this.data.workspaceId, this.data.fileName)
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
            this.translate.instant('coding.schemer.load-error'),
            'OK',
            { duration: 5000 }
          );
        }
      });
  }

  loadSchemerHtml(): void {
    this.isLoading = true;

    this.fileService.getFilesList(this.data.workspaceId, 1, 10000, 'Schemer')
      .subscribe({
        next: response => {
          if (response.data && response.data.length > 0) {
            const sortedFiles = [...response.data].sort((a, b) => {
              if (!a.created_at || !b.created_at) return 0;
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });

            const latestFile = sortedFiles[0];

            this.fileService.downloadFile(this.data.workspaceId, latestFile.id)
              .subscribe({
                next: fileDownload => {
                  try {
                    this.schemerHtml = base64ToUtf8(fileDownload.base64Data);
                    this.isLoading = false;
                  } catch (error) {
                    this.snackBar.open(
                      this.translate.instant('coding.schemer.decode-error'),
                      'Error',
                      { duration: 3000 }
                    );
                  }
                },
                error: () => {
                  this.snackBar.open(
                    this.translate.instant('coding.schemer.download-error'),
                    'Error',
                    { duration: 3000 }
                  );
                }
              });
          }
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('coding.schemer.fetch-error'),
            'Error',
            { duration: 3000 }
          );
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
    this.snackBar.open(
      this.translate.instant('coding.schemer.schemer-error', { error }),
      'Error',
      { duration: 3000 }
    );
  }

  close(): void {
    if (this.hasChanges) {
      const confirmRef = this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: {
          title: this.translate.instant('coding.schemer.unsaved-changes-title'),
          content: this.translate.instant('coding.schemer.unsaved-changes-content'),
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

    const schemeFilename = this.data.fileName;
    this.fileService.getFilesList(this.data.workspaceId, 1, 10000, 'Resource')
      .subscribe({
        next: response => {
          const existingFile = response.data?.find(file => file.filename === schemeFilename && file.file_type === 'Resource');
          if (existingFile) {
            this.fileService.deleteFiles(this.data.workspaceId, [existingFile.id])
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

    this.fileService.uploadTestFiles(this.data.workspaceId, formData)
      .subscribe(result => {
        const conflicts = result.conflicts || [];
        const ok = result.failed === 0 && conflicts.length === 0;
        if (ok) {
          this.snackBar.open(
            this.translate.instant('coding.schemer.save-success'),
            'Success',
            { duration: 3000 }
          );
          this.dialogRef.close(true);
        } else {
          this.snackBar.open(
            this.translate.instant('coding.schemer.save-error'),
            'Error',
            { duration: 3000 }
          );
        }
      });
  }
}
