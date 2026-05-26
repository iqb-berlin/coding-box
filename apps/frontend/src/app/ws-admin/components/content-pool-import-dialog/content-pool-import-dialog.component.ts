import {
  Component, Inject, OnDestroy, inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Subscription } from 'rxjs';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import {
  ContentPoolAcpSummary,
  ContentPoolImportAcpProgress,
  ContentPoolSettings
} from '../../models/content-pool.model';

export interface ContentPoolImportDialogData {
  workspaceId: number;
  settings: ContentPoolSettings;
}

export interface ContentPoolImportDialogResult {
  success: boolean;
  acpId: string;
  result: TestFilesUploadResultDto;
}

@Component({
  selector: 'coding-box-content-pool-import-dialog',
  templateUrl: './content-pool-import-dialog.component.html',
  styleUrls: ['./content-pool-import-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatIconModule
  ]
})
export class ContentPoolImportDialogComponent implements OnDestroy {
  private readonly contentPoolIntegrationService = inject(
    ContentPoolIntegrationService
  );

  private readonly dialogRef = inject(
    MatDialogRef<ContentPoolImportDialogComponent>
  );

  acps: ContentPoolAcpSummary[] = [];

  selectedAcpId = '';

  isLoadingAcps = false;

  isImporting = false;

  hasLoadedAcps = false;

  errorMessage = '';

  importProgress?: ContentPoolImportAcpProgress;

  private importSubscription?: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) readonly data: ContentPoolImportDialogData
  ) {}

  ngOnDestroy(): void {
    this.importSubscription?.unsubscribe();
  }

  loadAcps(): void {
    this.errorMessage = '';
    this.isLoadingAcps = true;
    this.hasLoadedAcps = false;
    this.selectedAcpId = '';
    this.acps = [];

    this.contentPoolIntegrationService
      .listAccessibleAcps(this.data.workspaceId)
      .subscribe({
        next: response => {
          this.isLoadingAcps = false;
          this.hasLoadedAcps = true;
          this.acps = response.acps || [];
          if (this.acps.length === 0) {
            this.errorMessage = 'Keine ACPs gefunden oder kein Zugriff vorhanden.';
          }
        },
        error: error => {
          this.isLoadingAcps = false;
          this.errorMessage = this.extractErrorMessage(
            error,
            'ACP-Liste konnte nicht aus dem Content Pool geladen werden.'
          );
        }
      });
  }

  importAcp(): void {
    if (!this.selectedAcpId) {
      this.errorMessage = 'Bitte ein ACP auswählen.';
      return;
    }

    this.errorMessage = '';
    this.isImporting = true;
    this.importProgress = {
      jobId: '',
      status: 'pending',
      phase: 'queued',
      message: 'Import wird vorbereitet...',
      processedFiles: 0,
      totalFiles: 0,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.importSubscription?.unsubscribe();

    this.importSubscription = this.contentPoolIntegrationService
      .importAcpWithProgress(this.data.workspaceId, {
        acpId: this.selectedAcpId
      })
      .subscribe({
        next: progress => {
          this.importProgress = progress;

          if (progress.status === 'failed') {
            this.isImporting = false;
            this.errorMessage = progress.error ||
              'ACP konnte nicht importiert werden.';
            return;
          }

          if (progress.status === 'completed' && progress.result) {
            this.isImporting = false;
            this.dialogRef.close({
              success: true,
              acpId: this.selectedAcpId,
              result: progress.result
            });
          }
        },
        error: error => {
          this.isImporting = false;
          this.errorMessage = this.extractErrorMessage(
            error,
            'ACP konnte nicht importiert werden.'
          );
        }
      });
  }

  get importProgressMode(): 'determinate' | 'indeterminate' {
    return this.importProgress?.totalFiles || this.importProgress?.progress ?
      'determinate' :
      'indeterminate';
  }

  get importProgressValue(): number {
    const progress = this.importProgress?.progress || 0;
    return Math.max(0, Math.min(100, progress));
  }

  get importProgressText(): string {
    if (!this.importProgress) {
      return '';
    }

    if (
      this.importProgress.phase === 'downloading-files' &&
      this.importProgress.totalFiles > 0
    ) {
      const currentFile = this.importProgress.currentFileName ?
        `: ${this.importProgress.currentFileName}` :
        '';
      return `Datei ${this.importProgress.processedFiles} von ${this.importProgress.totalFiles}${currentFile}`;
    }

    return this.importProgress.message;
  }

  cancel(): void {
    this.dialogRef.close({ success: false });
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    const payload = error as {
      error?: {
        message?: string | string[];
      };
    };

    if (Array.isArray(payload?.error?.message)) {
      return payload.error.message.join(', ');
    }
    if (typeof payload?.error?.message === 'string') {
      return payload.error.message;
    }
    return fallback;
  }
}
