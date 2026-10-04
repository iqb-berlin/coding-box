import {
  Component, Inject, OnDestroy, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  private readonly destroyRef = inject(DestroyRef);

  private readonly contentPoolIntegrationService = inject(
    ContentPoolIntegrationService
  );

  private readonly dialogRef = inject(
    MatDialogRef<ContentPoolImportDialogComponent>
  );

  readonly acps = signal<ContentPoolAcpSummary[]>([]);

  readonly selectedAcpId = signal('');

  readonly isLoadingAcps = signal(false);

  readonly isImporting = signal(false);

  readonly hasLoadedAcps = signal(false);

  readonly errorMessage = signal('');

  readonly importProgress = signal<ContentPoolImportAcpProgress | undefined>(undefined);

  private importSubscription?: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) readonly data: ContentPoolImportDialogData
  ) {}

  ngOnDestroy(): void {
    this.importSubscription?.unsubscribe();
  }

  loadAcps(): void {
    this.errorMessage.set('');
    this.isLoadingAcps.set(true);
    this.hasLoadedAcps.set(false);
    this.selectedAcpId.set('');
    this.acps.set([]);

    this.contentPoolIntegrationService
      .listAccessibleAcps(this.data.workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.isLoadingAcps.set(false);
          this.hasLoadedAcps.set(true);
          this.acps.set(response.acps || []);
          if (this.acps().length === 0) {
            this.errorMessage.set('Keine ACPs gefunden oder kein Zugriff vorhanden.');
          }
        },
        error: error => {
          this.isLoadingAcps.set(false);
          this.errorMessage.set(this.extractErrorMessage(error, 'ACP-Liste konnte nicht aus dem Content Pool geladen werden.'));
        }
      });
  }

  importAcp(): void {
    if (!this.selectedAcpId()) {
      this.errorMessage.set('Bitte ein ACP auswählen.');
      return;
    }

    this.errorMessage.set('');
    this.isImporting.set(true);
    this.importProgress.set({
      jobId: '',
      status: 'pending',
      phase: 'queued',
      message: 'Import wird vorbereitet...',
      processedFiles: 0,
      totalFiles: 0,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.importSubscription?.unsubscribe();

    this.importSubscription = this.contentPoolIntegrationService
      .importAcpWithProgress(this.data.workspaceId, {
        acpId: this.selectedAcpId()
      })
      .subscribe({
        next: progress => {
          this.importProgress.set(progress);

          if (progress.status === 'failed') {
            this.isImporting.set(false);
            this.errorMessage.set(progress.error ||
    'ACP konnte nicht importiert werden.');
            return;
          }

          if (progress.status === 'completed' && progress.result) {
            this.isImporting.set(false);
            this.dialogRef.close({
              success: true,
              acpId: this.selectedAcpId(),
              result: progress.result
            });
          }
        },
        error: error => {
          this.isImporting.set(false);
          this.errorMessage.set(this.extractErrorMessage(error, 'ACP konnte nicht importiert werden.'));
        }
      });
  }

  get importProgressMode(): 'determinate' | 'indeterminate' {
    return this.importProgress()?.totalFiles || this.importProgress()?.progress ?
      'determinate' :
      'indeterminate';
  }

  get importProgressValue(): number {
    const progress = this.importProgress()?.progress || 0;
    return Math.max(0, Math.min(100, progress));
  }

  get importProgressText(): string {
    const importProgressSnapshot = this.importProgress();

    if (!importProgressSnapshot) {
      return '';
    }

    if (
      importProgressSnapshot.phase === 'downloading-files' &&
      importProgressSnapshot.totalFiles > 0
    ) {
      const currentFile = importProgressSnapshot.currentFileName ?
        `: ${importProgressSnapshot.currentFileName}` :
        '';
      return `Datei ${importProgressSnapshot.processedFiles} von ${importProgressSnapshot.totalFiles}${currentFile}`;
    }

    return importProgressSnapshot.message;
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
