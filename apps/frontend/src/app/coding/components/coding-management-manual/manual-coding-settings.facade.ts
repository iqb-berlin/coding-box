import {
  DestroyRef, Injectable, computed, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  EMPTY,
  Observable, Subject,
  catchError,
  concatMap,
  debounceTime,
  finalize,
  map,
  of,
  tap
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ResponseMatchingFlag } from '../../../shared/services/workspace/workspace-settings.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestPersonCodingService } from '../../services/test-person-coding.service';

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
  private readonly initialSettingsLoadedSubject = new Subject<void>();
  private readonly settledSubject = new Subject<void>();

  private readonly thresholdSavedSubject = new Subject<void>();
  private readonly thresholdSavingSubject = new Subject<boolean>();
  private workspaceGeneration = 0;
  private thresholdIntent = 0;
  private readonly isSavingThresholdState = signal(false);
  private readonly thresholdChanges = new Subject<AggregationThresholdChange>();
  private readonly responseMatchingFlagsState = signal<readonly ResponseMatchingFlag[]>([]);

  private readonly persistedFlags = signal<readonly ResponseMatchingFlag[]>([]);
  get persistedResponseMatchingFlags(): readonly ResponseMatchingFlag[] { return this.persistedFlags(); }

  readonly aggregationOptionFlags: readonly ResponseMatchingFlag[] = [
    ResponseMatchingFlag.IGNORE_CASE,
    ResponseMatchingFlag.IGNORE_WHITESPACE
  ];

  private readonly isLoadingMatchingModeState = signal(false);

  private readonly isSavingMatchingModeState = signal(false);

  private readonly duplicateAggregationThresholdState = signal(2);

  readonly initialSettingsLoaded$ = this.initialSettingsLoadedSubject.asObservable();
  readonly settled$ = this.settledSubject.asObservable();
  readonly thresholdSaved$ = this.thresholdSavedSubject.asObservable();
  readonly thresholdSaving$ = this.thresholdSavingSubject.asObservable();
  readonly isSavingThreshold = this.isSavingThresholdState.asReadonly();
  readonly responseMatchingFlags = this.responseMatchingFlagsState.asReadonly();
  readonly isLoadingMatchingMode = this.isLoadingMatchingModeState.asReadonly();
  readonly isSavingMatchingMode = this.isSavingMatchingModeState.asReadonly();
  readonly duplicateAggregationThreshold = this.duplicateAggregationThresholdState.asReadonly();
  readonly hasUnsavedChanges = computed(() => !this.areMatchingFlagsEqual(
    this.getPersistableResponseMatchingFlags(), this.persistedResponseMatchingFlags
  ));

  restoreSettings(
    settings: { flags: readonly ResponseMatchingFlag[]; threshold: number },
    localFlags: readonly ResponseMatchingFlag[] = settings.flags
  ): void {
    this.persistedFlags.set([...settings.flags]);
    this.responseMatchingFlagsState.set([...localFlags]);
    this.updateThreshold(settings.threshold);
  }

  updateLocalMatchingFlags(flags: readonly ResponseMatchingFlag[]): void {
    this.responseMatchingFlagsState.set([...flags]);
  }

  updateThreshold(value: number | string | null | undefined): number {
    const threshold = this.normalizeAggregationThreshold(value);
    this.duplicateAggregationThresholdState.set(threshold);
    return threshold;
  }

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
            this.persistedFlags.set([...result.flags]);
            this.responseMatchingFlagsState.set(this.buildResponseMatchingFlagsAfterSettingsSave(result.flags, localFlags));
            this.duplicateAggregationThresholdState.set(this.normalizeAggregationThreshold(result.threshold));
            this.thresholdSavedSubject.next();
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
      this.thresholdSavedSubject.complete();
      this.thresholdSavingSubject.complete();
      this.initialSettingsLoadedSubject.complete();
      this.settledSubject.complete();
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
    this.isSavingThresholdState.set(saving);
    this.thresholdSavingSubject.next(saving);
  }

  loadInitialSettings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.initialSettingsLoadedSubject.next();
      return;
    }

    this.isLoadingMatchingModeState.set(true);

    this.testPersonCodingService
      .getAggregationSettings(workspaceId)
      .pipe(
        finalize(() => {
          this.isLoadingMatchingModeState.set(false);
          this.settledSubject.next();
        }),
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: settings => {
          this.restoreSettings(settings);
          this.initialSettingsLoadedSubject.next();
        },
        error: () => {
          this.responseMatchingFlagsState.set([]);
          this.persistedFlags.set([]);
          this.duplicateAggregationThresholdState.set(2);
          this.initialSettingsLoadedSubject.next();
        }
      });
  }

  getSelectedAggregationOptionFlags(
    flags: readonly ResponseMatchingFlag[] = this.responseMatchingFlags()
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
    flags: readonly ResponseMatchingFlag[] = this.responseMatchingFlags()
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

    this.isSavingMatchingModeState.set(true);
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
            this.restoreSettings(result, localFlagsAfterSave);
            if (showSuccessMessage) {
              this.showSuccess(
                this.translateService.instant(
                  'coding-management-manual.response-matching.save-success'
                )
              );
            }
          },
          error: () => {
            this.responseMatchingFlagsState.set(rollbackFlags);
            this.isSavingMatchingModeState.set(false);
            this.showError(
              this.translateService.instant(
                'coding-management-manual.response-matching.save-error'
              )
            );
          }
        }),
        finalize(() => {
          this.isSavingMatchingModeState.set(false);
        }),
        map(() => undefined)
      );
  }

  areMatchingFlagsEqual(
    previous: readonly ResponseMatchingFlag[],
    current: readonly ResponseMatchingFlag[]
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
