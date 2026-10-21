import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable, Subject, EMPTY, of, map, tap, finalize, debounceTime, concatMap, catchError
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ResponseMatchingFlag } from '../../../shared/services/workspace/workspace-settings.service';

interface AggregationThresholdChange {
  threshold: number;
  workspaceId: number;
  generation: number;
  intent: number;
}

/** Local matching options and their persisted representation. */
@Injectable()
export class ManualCodingSettingsFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translateService = inject(TranslateService);
  readonly initialSettingsLoaded$ = new Subject<void>();
  readonly settled$ = new Subject<void>();

  readonly thresholdSaved$ = new Subject<void>();
  readonly thresholdSaving$ = new Subject<boolean>();
  private workspaceGeneration = 0;
  private thresholdIntent = 0;
  readonly isSavingThreshold = signal(false);
  private readonly thresholdChanges = new Subject<AggregationThresholdChange>();
  readonly responseMatchingFlags = signal<ResponseMatchingFlag[]>([]);

  persistedResponseMatchingFlags: ResponseMatchingFlag[] = [];

  readonly aggregationOptionFlags = [
    ResponseMatchingFlag.IGNORE_CASE,
    ResponseMatchingFlag.IGNORE_WHITESPACE
  ];

  readonly isLoadingMatchingMode = signal(false);

  readonly isSavingMatchingMode = signal(false);

  readonly duplicateAggregationThreshold = signal(2);

  constructor() {
    let observedWorkspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== observedWorkspaceId) {
        this.workspaceGeneration += 1;
        this.setThresholdSaving(false);
        observedWorkspaceId = id;
      }
    });
    this.thresholdChanges.pipe(
      debounceTime(1000),
      // A cancelled HTTP subscription cannot roll back a write already accepted by the server.
      concatMap(change => {
        if (!this.isCurrentThresholdChange(change)) return EMPTY;
        const localFlags = [...this.responseMatchingFlags()];
        return this.testPersonCodingService.saveAggregationSettings(
          change.workspaceId, change.threshold, this.getPersistableResponseMatchingFlags(localFlags)
        ).pipe(
          takeUntilWorkspaceChanged(this.appService, change.workspaceId),
          tap(result => {
            if (!this.isCurrentThresholdChange(change)) return;
            if (!result.success) { this.showError(result.message); return; }
            this.persistedResponseMatchingFlags = [...result.flags];
            this.responseMatchingFlags.set(this.buildResponseMatchingFlagsAfterSettingsSave(result.flags, localFlags));
            this.duplicateAggregationThreshold.set(this.normalizeAggregationThreshold(result.threshold));
            this.thresholdSaved$.next();
          }),
          catchError(() => {
            if (this.isCurrentThresholdChange(change)) this.showError('Fehler beim Speichern der Aggregationseinstellungen');
            return EMPTY;
          }),
          finalize(() => {
            if (this.isCurrentThresholdChange(change)) this.setThresholdSaving(false);
          })
        );
      }),
      takeUntilDestroyed(),
      finalize(() => this.setThresholdSaving(false))
    ).subscribe();
    this.destroyRef.onDestroy(() => {
      this.thresholdChanges.complete();
      this.thresholdSaved$.complete();
      this.thresholdSaving$.complete();
      this.initialSettingsLoaded$.complete();
      this.settled$.complete();
    });
  }

  saveThreshold(threshold: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.thresholdIntent += 1;
      this.setThresholdSaving(true);
      this.thresholdChanges.next({
        threshold, workspaceId, generation: this.workspaceGeneration, intent: this.thresholdIntent
      });
    }
  }

  private isCurrentThresholdChange(change: AggregationThresholdChange): boolean {
    return change.intent === this.thresholdIntent && change.generation === this.workspaceGeneration &&
      change.workspaceId === this.appService.selectedWorkspaceId;
  }

  private setThresholdSaving(saving: boolean): void {
    this.isSavingThreshold.set(saving);
    this.thresholdSaving$.next(saving);
  }

  loadInitialSettings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.initialSettingsLoaded$.next();
      return;
    }

    this.isLoadingMatchingMode.set(true);

    this.testPersonCodingService
      .getAggregationSettings(workspaceId)
      .pipe(
        finalize(() => {
          this.isLoadingMatchingMode.set(false);
          this.settled$.next();
        }),
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: settings => {
          this.responseMatchingFlags.set(settings.flags);
          this.persistedResponseMatchingFlags = [...settings.flags];
          this.duplicateAggregationThreshold.set(this.normalizeAggregationThreshold(settings.threshold));
          this.initialSettingsLoaded$.next();
        },
        error: () => {
          this.responseMatchingFlags.set([]);
          this.persistedResponseMatchingFlags = [];
          this.duplicateAggregationThreshold.set(2);
          this.initialSettingsLoaded$.next();
        }
      });
  }

  getSelectedAggregationOptionFlags(
    flags: ResponseMatchingFlag[] = this.responseMatchingFlags()
  ): ResponseMatchingFlag[] {
    return this.aggregationOptionFlags.filter(flag => flags.includes(flag));
  }

  buildLocalResponseMatchingFlags(
    aggregateResponses: boolean,
    optionFlags: ResponseMatchingFlag[]
  ): ResponseMatchingFlag[] {
    const selectedOptionFlags = this.getSelectedAggregationOptionFlags(optionFlags);
    return aggregateResponses ?
      selectedOptionFlags :
      [ResponseMatchingFlag.NO_AGGREGATION, ...selectedOptionFlags];
  }

  getPersistableResponseMatchingFlags(
    flags: ResponseMatchingFlag[] = this.responseMatchingFlags()
  ): ResponseMatchingFlag[] {
    const selectedOptionFlags = this.getSelectedAggregationOptionFlags(flags);
    return flags.includes(ResponseMatchingFlag.NO_AGGREGATION) ?
      [ResponseMatchingFlag.NO_AGGREGATION] :
      selectedOptionFlags;
  }

  buildResponseMatchingFlagsAfterSettingsSave(
    savedFlags: ResponseMatchingFlag[],
    localFlagsAfterSave: ResponseMatchingFlag[]
  ): ResponseMatchingFlag[] {
    return this.buildLocalResponseMatchingFlags(
      !savedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
      this.getSelectedAggregationOptionFlags(localFlagsAfterSave)
    );
  }

  saveResponseMatchingMode(
    flags: ResponseMatchingFlag[],
    options: {
      localFlagsAfterSave?: ResponseMatchingFlag[];
      rollbackFlags?: ResponseMatchingFlag[];
      showSuccessMessage?: boolean;
    } = {}
  ): Observable<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const rollbackFlags = options.rollbackFlags ?
      [...options.rollbackFlags] :
      [...this.persistedResponseMatchingFlags];
    const localFlagsAfterSave = options.localFlagsAfterSave ?
      [...options.localFlagsAfterSave] :
      undefined;
    const showSuccessMessage = options.showSuccessMessage ?? true;

    this.isSavingMatchingMode.set(true);
    return this.testPersonCodingService
      .saveAggregationSettings(
        workspaceId,
        this.normalizeAggregationThreshold(this.duplicateAggregationThreshold()),
        flags
      )
      .pipe(
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef),
        map(result => {
          if (!result.success) {
            throw new Error(result.message);
          }
          return result;
        }),
        tap({
          next: result => {
            this.persistedResponseMatchingFlags = [...result.flags];
            this.responseMatchingFlags.set(localFlagsAfterSave ?? result.flags);
            this.duplicateAggregationThreshold.set(this.normalizeAggregationThreshold(result.threshold));
            if (showSuccessMessage) {
              this.showSuccess(
                this.translateService.instant(
                  'coding-management-manual.response-matching.save-success'
                )
              );
            }
          },
          error: () => {
            this.responseMatchingFlags.set(rollbackFlags);
            this.isSavingMatchingMode.set(false);
            this.showError(
              this.translateService.instant(
                'coding-management-manual.response-matching.save-error'
              )
            );
          }
        }),
        finalize(() => {
          this.isSavingMatchingMode.set(false);
        }),
        map(() => undefined)
      );
  }

  areMatchingFlagsEqual(
    previous: ResponseMatchingFlag[],
    current: ResponseMatchingFlag[]
  ): boolean {
    if (previous.length !== current.length) {
      return false;
    }
    return previous.every(flag => current.includes(flag));
  }

  normalizeAggregationThreshold(value: number | string | null | undefined): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 2;
    }
    return Math.min(100, Math.max(2, Math.round(numericValue)));
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
