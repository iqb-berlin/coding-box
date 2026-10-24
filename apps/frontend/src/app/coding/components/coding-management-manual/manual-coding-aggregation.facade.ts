import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable, Subject, of, switchMap, tap
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { ResponseMatchingFlag } from '../../../shared/services/workspace/workspace-settings.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ApplyDuplicateAggregationDialogComponent, ApplyDuplicateAggregationDialogData } from './apply-duplicate-aggregation-dialog.component';
import { ApplyEmptyCodingDialogComponent } from './apply-empty-coding-dialog.component';
import { ManualCodingAnalysisFacade } from './manual-coding-analysis.facade';
import { ManualCodingSettingsFacade } from './manual-coding-settings.facade';

/** Aggregation writes, confirmations and analysis restart belong to one view lifetime. */
@Injectable()
export class ManualCodingAggregationFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly settings = inject(ManualCodingSettingsFacade);
  private readonly analysis = inject(ManualCodingAnalysisFacade);
  private readonly codingJobBackendService = inject(CodingJobBackendService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translateService = inject(TranslateService);
  private readonly refreshRequested = new Subject<{ scope: 'all' | 'aggregation'; includeResponseAnalysis?: boolean }>();
  readonly refreshRequested$ = this.refreshRequested.asObservable();
  private readonly applyingEmpty = signal(false);
  private readonly applyingAggregation = signal(false);
  readonly isApplyingEmptyCoding = this.applyingEmpty.asReadonly();
  readonly isApplyingDuplicateAggregation = this.applyingAggregation.asReadonly();
  private readonly responseMatchingFlags = this.settings.responseMatchingFlags;
  private readonly duplicateAggregationThreshold = this.settings.duplicateAggregationThreshold;
  private readonly isLoadingMatchingMode = () => this.settings.isLoadingMatchingMode();
  private readonly isSavingMatchingMode = () => this.settings.isSavingMatchingMode();
  private readonly responseAnalysis = this.analysis.responseAnalysis;
  private readonly isLoadingResponseAnalysis = this.analysis.isLoadingResponseAnalysis;
  private get persistedResponseMatchingFlags(): readonly ResponseMatchingFlag[] { return this.settings.persistedResponseMatchingFlags; }
  private get isDuplicateAggregationActive(): boolean { return !this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION); }

  constructor() {
    this.settings.thresholdSaving$.pipe(takeUntilDestroyed()).subscribe(saving => this.applyingAggregation.set(saving));
    this.destroyRef.onDestroy(() => this.refreshRequested.complete());
  }

  private loadResponseAnalysis(): void { this.analysis.loadResponseAnalysis(); }
  private setResponseAnalysisGuardActive(active: boolean): void { this.analysis.setResponseAnalysisGuardActive(active); }

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

  hasMatchingFlag(flag: ResponseMatchingFlag): boolean {
    return this.responseMatchingFlags().includes(flag);
  }

  hasUnsavedResponseMatchingChanges(): boolean {
    return this.settings.hasUnsavedChanges();
  }

  hasPendingAggregationOptionsWithoutAggregation(): boolean {
    return this.hasMatchingFlag(ResponseMatchingFlag.NO_AGGREGATION) &&
      this.getSelectedAggregationOptionFlags().length > 0;
  }

  onAggregationModeChanged(aggregateResponses: boolean): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.isLoadingMatchingMode() ||
      this.isSavingMatchingMode() ||
      this.isApplyingDuplicateAggregation() ||
      this.isLoadingResponseAnalysis() ||
      this.responseAnalysis()?.isCalculating ||
      aggregateResponses === this.isDuplicateAggregationActive
    ) {
      return;
    }

    const rollbackFlags = [...this.responseMatchingFlags()];
    const optionFlags = this.getSelectedAggregationOptionFlags();
    this.settings.updateLocalMatchingFlags(this.buildLocalResponseMatchingFlags(aggregateResponses, optionFlags));
    this.analysis.resetPages();
    this.restartAnalysis(rollbackFlags);
  }

  toggleMatchingFlag(flag: ResponseMatchingFlag): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.isLoadingMatchingMode() ||
      this.isSavingMatchingMode() ||
      this.isApplyingDuplicateAggregation()
    ) {
      return;
    }

    if (flag === ResponseMatchingFlag.NO_AGGREGATION) {
      this.onAggregationModeChanged(this.hasMatchingFlag(flag));
      return;
    }

    const selectedOptionFlags = this.getSelectedAggregationOptionFlags();
    const nextOptionFlags = selectedOptionFlags.includes(flag) ?
      selectedOptionFlags.filter(f => f !== flag) :
      [...selectedOptionFlags, flag];

    this.settings.updateLocalMatchingFlags(this.buildLocalResponseMatchingFlags(this.isDuplicateAggregationActive, nextOptionFlags));
    this.analysis.resetPages();
  }

  private getSelectedAggregationOptionFlags(
    flags: readonly ResponseMatchingFlag[] = this.responseMatchingFlags()
  ): ResponseMatchingFlag[] { return this.settings.getSelectedAggregationOptionFlags(flags); }

  private buildLocalResponseMatchingFlags(
    aggregateResponses: boolean,
    optionFlags: ResponseMatchingFlag[]
  ): ResponseMatchingFlag[] { return this.settings.buildLocalResponseMatchingFlags(aggregateResponses, optionFlags); }

  private getPersistableResponseMatchingFlags(
    flags: readonly ResponseMatchingFlag[] = this.responseMatchingFlags()
  ): ResponseMatchingFlag[] { return this.settings.getPersistableResponseMatchingFlags(flags); }

  private saveResponseMatchingMode(
    flags: ResponseMatchingFlag[],
    options: {
      localFlagsAfterSave?: ResponseMatchingFlag[];
      rollbackFlags?: ResponseMatchingFlag[];
      showSuccessMessage?: boolean;
    } = {}
  ): Observable<void> { return this.settings.saveResponseMatchingMode(flags, options); }

  private onResponseMatchingModeChanged(): void {
    this.restartAnalysis();
    this.refreshRequested.next({ scope: 'aggregation', includeResponseAnalysis: false });
  }

  private areMatchingFlagsEqual(
    previous: readonly ResponseMatchingFlag[],
    current: readonly ResponseMatchingFlag[]
  ): boolean { return this.settings.areMatchingFlagsEqual(previous, current); }

  restartAnalysis(rollbackResponseMatchingFlags?: ResponseMatchingFlag[]): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    const targetMatchingFlags = this.getPersistableResponseMatchingFlags();
    const localFlagsAfterSave = [...this.responseMatchingFlags()];
    const shouldSaveMatchingMode = !this.areMatchingFlagsEqual(
      targetMatchingFlags,
      this.persistedResponseMatchingFlags
    );
    const shouldRefreshAggregationDependentViews = shouldSaveMatchingMode;
    let settingsReadyForAnalysis = !shouldSaveMatchingMode;

    this.analysis.beginAnalysis();
    const saveMatchingMode$ = shouldSaveMatchingMode ?
      this.saveResponseMatchingMode(
        targetMatchingFlags,
        {
          localFlagsAfterSave,
          rollbackFlags: rollbackResponseMatchingFlags,
          showSuccessMessage: false
        }
      ) :
      of(undefined);

    saveMatchingMode$
      .pipe(
        tap(() => {
          settingsReadyForAnalysis = true;
        }),
        switchMap(() => this.codingJobBackendService
          .triggerResponseAnalysis(
            workspaceId,
            this.normalizeAggregationThreshold(this.duplicateAggregationThreshold())
          )),
        takeUntilWorkspaceChanged(this.appService),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.setResponseAnalysisGuardActive(true);
          this.snackBar.open('Antwortanalyse wurde gestartet.', 'OK', { duration: 3000 });
          if (shouldRefreshAggregationDependentViews) {
            this.refreshRequested.next({ scope: 'aggregation', includeResponseAnalysis: false });
          }
          this.loadResponseAnalysis(); // Start polling
        },
        error: error => {
          this.setResponseAnalysisGuardActive(false);
          this.analysis.analysisStartFailed();
          if (settingsReadyForAnalysis) {
            this.snackBar.open(
              `Fehler beim Starten der Antwortanalyse: ${error.message || error}`,
              'OK',
              { duration: 3000 }
            );
          }
        }
      });
  }

  onApplyEmptyResponseCoding(canApply: boolean, missing: { code: number; score: number | null } | null): void {
    if (!canApply) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    const emptyResponseMissing = missing;
    if (!workspaceId || !this.responseAnalysis() || !emptyResponseMissing) {
      return;
    }

    const uncodedCount = (this.responseAnalysis()?.emptyResponses?.totalUncoded || 0);
    if (uncodedCount === 0) {
      return;
    }

    // Show Material Dialog confirmation
    const dialogRef = this.dialog.open(ApplyEmptyCodingDialogComponent, {
      width: '550px',
      data: {
        count: uncodedCount,
        code: emptyResponseMissing.code,
        score: emptyResponseMissing.score
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((confirmed: unknown) => {
      if (!confirmed) {
        return;
      }

      this.applyingEmpty.set(true);

      this.testPersonCodingService
        .applyEmptyResponseCoding(workspaceId)
        .pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result: { success: boolean; updatedCount: number; message: string; }) => {
            this.applyingEmpty.set(false);

            if (result.success) {
              this.showSuccess(
                this.translateService.instant(
                  'coding-management-manual.response-analysis.apply-empty-coding-success',
                  { count: result.updatedCount }
                )
              );

              // Refresh analysis and statistics
              this.restartAnalysis();
              this.refreshRequested.next({ scope: 'all' });
            } else {
              this.showError(
                this.translateService.instant(
                  'coding-management-manual.response-analysis.apply-empty-coding-error',
                  { error: result.message }
                )
              );
            }
          },
          error: () => {
            this.applyingEmpty.set(false);
            this.showError(
              this.translateService.instant(
                'coding-management-manual.response-analysis.apply-empty-coding-error',
                { error: 'Unbekannter Fehler' }
              )
            );
          }
        });
    });
  }

  onApplyDuplicateAggregation(): void {
    const responseAnalysisValue = this.responseAnalysis();

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !responseAnalysisValue) {
      return;
    }

    // Filter groups that meet the threshold
    const groupsMeetingThreshold = responseAnalysisValue.duplicateValues.groups.filter(
      group => group.occurrences.length >= this.duplicateAggregationThreshold()
    );

    if (groupsMeetingThreshold.length === 0) {
      this.showError(
        this.translateService.instant(
          'coding-management-manual.duplicate-aggregation.no-groups-meet-threshold',
          { threshold: this.duplicateAggregationThreshold() }
        )
      );
      return;
    }

    const totalResponsesInGroups = groupsMeetingThreshold.reduce(
      (sum, group) => sum + group.occurrences.length,
      0
    );

    // Show confirmation dialog
    const dialogData: ApplyDuplicateAggregationDialogData = {
      duplicateGroups: groupsMeetingThreshold.length,
      totalResponses: totalResponsesInGroups,
      threshold: this.duplicateAggregationThreshold()
    };

    const dialogRef = this.dialog.open(ApplyDuplicateAggregationDialogComponent, {
      width: '550px',
      data: dialogData
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((confirmed: unknown) => {
      if (!confirmed) {
        return;
      }

      this.applyingAggregation.set(true);

      this.testPersonCodingService
        .applyDuplicateAggregation(
          workspaceId,
          this.duplicateAggregationThreshold(),
          true
        )
        .pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: result => {
            this.applyingAggregation.set(false);

            if (result.success) {
              this.showSuccess(
                this.translateService.instant(
                  'coding-management-manual.duplicate-aggregation.success',
                  {
                    aggregatedResponses: result.aggregatedResponses,
                    aggregatedGroups: result.aggregatedGroups,
                    uniqueCases: result.uniqueCodingCases
                  }
                )
              );

              // Sync with matching flag: Clear 'NO_AGGREGATION' when applying
              this.saveResponseMatchingMode(
                this.responseMatchingFlags().filter(f => f !== ResponseMatchingFlag.NO_AGGREGATION)
              )
                .pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
                .subscribe(() => {
                  this.onResponseMatchingModeChanged();
                });
            } else {
              this.showError(
                this.translateService.instant(
                  'coding-management-manual.duplicate-aggregation.error',
                  { error: result.message }
                )
              );
            }
          },
          error: () => {
            this.applyingAggregation.set(false);
            this.showError(
              this.translateService.instant(
                'coding-management-manual.duplicate-aggregation.error',
                { error: 'Unbekannter Fehler' }
              )
            );
          }
        });
    });
  }

  onDeactivateDuplicateAggregation(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translateService.instant('coding-management-manual.duplicate-aggregation.deactivate-dialog-title'),
        message: this.translateService.instant('coding-management-manual.duplicate-aggregation.deactivate-confirm'),
        confirmButtonText: this.translateService.instant('coding-management-manual.duplicate-aggregation.deactivate-confirm-button'),
        cancelButtonText: this.translateService.instant('coding-management-manual.duplicate-aggregation.cancel')
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((confirmed: unknown) => {
      if (!confirmed) {
        return;
      }

      this.applyingAggregation.set(true);

      this.testPersonCodingService
        .applyDuplicateAggregation(
          workspaceId,
          this.duplicateAggregationThreshold(),
          false // Deactivate
        )
        .pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: result => {
            this.applyingAggregation.set(false);

            if (result.success) {
              this.showSuccess(result.message);

              // Sync with matching flag: Set 'NO_AGGREGATION' when deactivating
              this.saveResponseMatchingMode([ResponseMatchingFlag.NO_AGGREGATION])
                .pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
                .subscribe(() => {
                  this.onResponseMatchingModeChanged();
                });
            } else {
              this.showError(result.message);
            }
          },
          error: () => {
            this.applyingAggregation.set(false);
            this.showError('Fehler beim Deaktivieren der Aggregation');
          }
        });
    });
  }

  onThresholdChanged(newValue: number | string | null): void {
    if (this.responseAnalysis()?.isCalculating || this.isSavingMatchingMode()) {
      return;
    }
    const normalizedValue = this.normalizeAggregationThreshold(newValue);
    if (this.duplicateAggregationThreshold() !== normalizedValue) {
      this.settings.updateThreshold(normalizedValue);
    }
    this.analysis.resetPages();
    this.settings.saveThreshold(normalizedValue);
  }

  private normalizeAggregationThreshold(value: number | string | null | undefined): number { return this.settings.normalizeAggregationThreshold(value); }
}
