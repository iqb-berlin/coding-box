import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ValidationStateService } from '../../services/validation-state.service';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';
import { ImportComparisonDialogComponent, ImportComparisonData } from '../import-comparison-dialog/import-comparison-dialog.component';
import { CodingImportFormatDialogComponent, CodingImportFormatDialogData, CodingImportFormatDialogResult } from './coding-import-format-dialog.component';
import { detectCodingImportFormat } from './coding-import-file';

/** One import attempt, scoped to the manual coding view and its workspace. */
@Injectable()
export class ManualCodingImportFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly validationStateService = inject(ValidationStateService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translateService = inject(TranslateService);
  readonly isImporting = signal(false);
  private controller?: AbortController;
  private ownsValidation = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancel());
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) { this.cancel(); workspaceId = id; }
    });
  }

  cancel(): void {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
      if (this.ownsValidation) this.validationStateService.resetValidation();
      this.ownsValidation = false;
    }
    this.controller = undefined;
    this.isImporting.set(false);
  }

  async importFile(file: File): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const workspaceId = this.appService.selectedWorkspaceId;
    const isCurrent = (): boolean => !controller.signal.aborted && !this.destroyRef.destroyed &&
      workspaceId === this.appService.selectedWorkspaceId;
    this.isImporting.set(true);

    try {
      if (!workspaceId) {
        const errorMsg = this.translateService.instant(
          'coding-management-manual.errors.no-workspace-selected'
        );
        this.showError(errorMsg);
        this.isImporting.set(false);
        return;
      }

      const detection = await detectCodingImportFormat(file);
      if (!isCurrent()) return;
      const dialogRef = this.dialog.open<CodingImportFormatDialogComponent, CodingImportFormatDialogData, CodingImportFormatDialogResult | undefined>(CodingImportFormatDialogComponent, { width: '720px', maxWidth: '95vw', data: detection });
      controller.signal.addEventListener('abort', () => dialogRef.close(), { once: true });
      const dialogResult = await firstValueFrom(
        dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef))
      );

      if (!isCurrent()) return;
      if (!dialogResult) {
        this.isImporting.set(false);
        return;
      }

      this.ownsValidation = true;
      this.validationStateService.startValidation();
      this.validationStateService.updateProgress(
        10,
        this.translateService.instant(
          'coding-management-manual.progress.file-processing'
        )
      );
      const fileData = await this.fileToBase64(file, controller.signal);
      if (!isCurrent()) return;

      await this.testPersonCodingService.importExternalCodingWithProgress(
        workspaceId,
        {
          file: fileData,
          fileName: file.name,
          previewOnly: true,
          sourceFormat: dialogResult.sourceFormat,
          sourceVersion: dialogResult.sourceVersion,
          scoreMode: dialogResult.scoreMode,
          existingCodingMode: dialogResult.existingCodingMode
        },
        (progress: number, message: string) => {
          if (!isCurrent()) return;
          this.validationStateService.updateProgress(progress, message);
        },
        // onComplete callback
        (result: ExternalCodingImportResultDto) => {
          if (!isCurrent()) return;
          this.ownsValidation = false;
          this.validationStateService.resetValidation();

          // Open the preview dialog with confirmation options
          this.dialog.open(ImportComparisonDialogComponent, {
            width: '95vw',
            maxWidth: '95vw',
            height: '90vh',
            data: {
              message: result.message,
              processedRows: result.processedRows,
              updatedRows: result.updatedRows,
              errors: result.errors,
              affectedRows: result.affectedRows,
              isPreview: true,
              workspaceId: workspaceId,
              fileData: fileData,
              fileName: file.name,
              sourceFormat: dialogResult.sourceFormat,
              sourceVersion: dialogResult.sourceVersion,
              scoreMode: dialogResult.scoreMode,
              existingCodingMode: dialogResult.existingCodingMode
            } as ImportComparisonData
          });

          this.showSuccess(
            this.translateService.instant(
              'coding-management-manual.success.preview-completed',
              {
                updatedRows: result.updatedRows,
                processedRows: result.processedRows
              }
            )
          );

          if (result.errors && result.errors.length > 0) {
            this.showError(
              this.translateService.instant('error.general', {
                error: `${result.errors.length} Warnungen aufgetreten. Details in der Konsole.`
              })
            );
          }

          this.isImporting.set(false);
        },
        // onError callback
        (error: string) => {
          if (!isCurrent()) return;
          this.ownsValidation = false;
          this.validationStateService.setValidationError(
            `Import fehlgeschlagen: ${error}`
          );
          this.showError(
            this.translateService.instant(
              'coding-management-manual.errors.import-failed'
            )
          );
          this.isImporting.set(false);
        },
        controller.signal
      );
    } catch (error) {
      if (!isCurrent()) return;
      this.ownsValidation = false;
      this.validationStateService.setValidationError(
        this.translateService.instant(
          'coding-management-manual.errors.import-failed'
        )
      );
      this.showError(
        this.translateService.instant(
          'coding-management-manual.errors.import-failed'
        )
      );
      this.isImporting.set(false);
    } finally {
      if (isCurrent()) { this.isImporting.set(false); this.controller = undefined; }
    }
  }

  private fileToBase64(file: File, abortSignal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abort = (): void => { reader.abort(); reject(new Error('Import cancelled')); };
      abortSignal.addEventListener('abort', abort, { once: true });
      const cleanup = (): void => abortSignal.removeEventListener('abort', abort);
      reader.onload = () => { cleanup(); resolve((reader.result as string).split(',')[1]); };
      reader.onerror = error => { cleanup(); reject(error); };
      reader.onabort = () => { cleanup(); reject(new Error('Import cancelled')); };
      if (abortSignal.aborted) { abort(); return; }
      reader.readAsDataURL(file);
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['success-snackbar']
    });
  }
}
