import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable, filter, finalize, take, takeUntil
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CoderTraining } from '../../models/coder-training.model';
import { JobDefinition } from '../../services/coding-job-backend.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { ManualCodingExportDialogComponent, ManualCodingExportDialogResult } from '../manual-coding-export-dialog/manual-coding-export-dialog.component';
import { ManualCodingExportScopeFacade } from './manual-coding-export-scope.facade';
import { ManualCodingExportFacade, ManualExportDecision, ManualExportWorksheetWarning } from './manual-coding-export.facade';
import { createManualCodingExportConfig } from './manual-coding-export-plan';

/** Owns export selection, worksheet confirmation and startup for one manual-coding view. */
@Injectable()
export class ManualCodingExportWorkflowFacade {
  private readonly uiTranslate = injectUiTranslator();
  private readonly appService = inject(AppService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translateService = inject(TranslateService);
  private readonly exportScope = inject(ManualCodingExportScopeFacade);
  private readonly exports = inject(ManualCodingExportFacade);

  openTrainingExport(trainings: CoderTraining[]): void {
    if (!trainings.some(training => Number.isFinite(training.id))) {
      this.showError(this.uiTranslate('ui-text.coding-management-manual.trainings-loading'));
      return;
    }
    if (!this.ensureCodersReady()) return;
    this.openDialog('training', trainings, []);
  }

  openExecutionExport(renderedDefinitions?: JobDefinition[]): void {
    if (!this.exportScope.ensureDefinitionsReady(renderedDefinitions !== undefined)) {
      this.showError(this.uiTranslate('ui-text.coding-management-manual.definitions-loading'));
      return;
    }
    if (!this.ensureCodersReady()) return;
    this.openDialog('execution', [], this.exportScope.getDefinitions(renderedDefinitions));
  }

  private openDialog(context: 'training' | 'execution', trainings: CoderTraining[], definitions: JobDefinition[]): void {
    const scopeIds = (context === 'training' ? trainings : definitions)
      .map(item => item.id).filter((id): id is number => Number.isFinite(id));
    const dialogRef = this.dialog.open(ManualCodingExportDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      data: {
        context,
        coders: this.exportScope.coders(),
        jobDefinitions: context === 'execution' ? this.getJobDefinitionExportOptions(definitions) : undefined,
        coderTrainings: context === 'training' ? trainings : undefined
      }
    });
    this.observeDialog(dialogRef).subscribe((result?: ManualCodingExportDialogResult) => {
      if (result) this.start(context, result, scopeIds);
    });
  }

  private ensureCodersReady(): boolean {
    if (this.exportScope.ensureCodersReady()) return true;
    this.showError(this.uiTranslate('ui-text.coding-management-manual.coders-loading'));
    return false;
  }

  private observeDialog<T, R>(dialogRef: MatDialogRef<T, R>): Observable<R | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    const unregisterClose = this.destroyRef.onDestroy(() => dialogRef.close?.());
    this.appService.selectedWorkspaceId$.pipe(
      filter(id => id !== workspaceId), take(1), takeUntil(dialogRef.afterClosed()), takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => dialogRef.close?.());
    return dialogRef.afterClosed().pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef), finalize(() => { unregisterClose(); dialogRef.close?.(); })
    );
  }

  private showError(message: string): void {
    this.snackBar.open(message, this.uiTranslate('deferred-view.close'), { duration: 5000, panelClass: ['error-snackbar'] });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, this.uiTranslate('deferred-view.close'), { duration: 5000, panelClass: ['success-snackbar'] });
  }

  start(
    context: 'training' | 'execution',
    result: ManualCodingExportDialogResult,
    scopeIds: number[] = []
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError(this.uiTranslate('ui-text.coding-management-manual.no-workspace'));
      return;
    }

    const config = createManualCodingExportConfig(context, result, this.appService.userId, scopeIds);
    this.exports.start(workspaceId, config, warning => this.confirmLargeExport(warning))
      .subscribe(outcome => {
        if (outcome === 'started') this.showSuccess(this.uiTranslate('ui-text.coding-management-manual.export-started'));
        if (outcome === 'estimate-failed') this.showError(this.translateService.instant('manual-coding-export.worksheet-estimate-failed'));
      });
  }

  private confirmLargeExport(warning: ManualExportWorksheetWarning): Observable<ManualExportDecision> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '560px',
      data: {
        title: this.translateService.instant('manual-coding-export.too-many-worksheets-title'),
        message: this.translateService.instant('manual-coding-export.too-many-worksheets-message', warning),
        confirmButtonText: this.translateService.instant('manual-coding-export.too-many-worksheets-continue'),
        alternativeButtonText: this.translateService.instant('manual-coding-export.too-many-worksheets-compact'),
        alternativeButtonValue: 'compact',
        cancelButtonText: this.translateService.instant('cancel')
      }
    });
    return this.observeDialog(dialogRef);
  }

  private getJobDefinitionExportOptions(definitions: JobDefinition[]): { id: number; label: string }[] {
    return definitions
      .filter(jobDefinition => Number.isFinite(jobDefinition.id))
      .map(jobDefinition => {
        const variableCount = jobDefinition.assignedVariables?.length ?? 0;
        const bundleCount = jobDefinition.assignedVariableBundles?.length ?? 0;
        const status = jobDefinition.status ? ` (${jobDefinition.status})` : '';
        return {
          id: jobDefinition.id as number,
          label: this.uiTranslate('ui-text.coding-management-manual.variable-bundle-summary', {
            value1: getJobDefinitionDisplayLabel(jobDefinition), status: status, variableCount: variableCount, bundleCount: bundleCount
          })
        };
      });
  }
}
