import {
  DestroyRef, Injectable, computed, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY, Observable, Subject, Subscription, catchError, defer, finalize, filter, takeUntil
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { KappaStatistics, VariableKappaSummary, withMeanAgreement } from './training-reliability';

export interface TrainingReliabilityContext {
  workspaceId: number;
  trainingId: number;
  coderIds: number[];
  weighted: boolean;
  level: 'code' | 'score';
}

/** Reliability requests and derived statistics belong to one comparison dialog. */
@Injectable()
export class TrainingReliabilityFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly backend = inject(CodingTrainingBackendService);
  private readonly cancel$ = new Subject<void>();
  private request?: Subscription;
  private requestId = 0;
  readonly errors$ = new Subject<'load' | 'export'>();
  readonly isLoading = signal(false);
  readonly isExporting = signal(false);
  readonly statistics = signal<KappaStatistics | null>(null);
  readonly originalStatistics = signal<KappaStatistics | null>(null);
  readonly useWeightedMean = signal(true);
  readonly useCodeLevel = signal(true);
  readonly variableKappaSummaries = computed<VariableKappaSummary[]>(() => (
    this.statistics()?.variables.map(variable => ({
      key: `${variable.unitName}::${variable.variableId}`,
      unitName: variable.unitName,
      variableId: variable.variableId,
      meanKappa: variable.meanKappa ?? null,
      meanBrennanPredigerKappa: variable.meanBrennanPredigerKappa ?? null,
      fleissKappa: variable.fleissKappa ?? null,
      fleissCaseCount: variable.fleissCaseCount ?? 0,
      fleissPossibleCaseCount: variable.fleissPossibleCaseCount ?? 0,
      meanAgreement: variable.meanAgreement ?? null,
      caseCount: variable.caseCount ?? 0,
      validPairCount: variable.validPairCount ?? 0
    })) ?? []
  ));

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id === workspaceId) return;
      workspaceId = id;
      this.reset();
    });
    this.destroyRef.onDestroy(() => { this.reset(); this.cancel$.complete(); this.errors$.complete(); });
  }

  reset(): void {
    this.requestId += 1;
    this.request?.unsubscribe();
    this.cancel$.next();
    this.isLoading.set(false);
    this.statistics.set(null);
    this.originalStatistics.set(null);
  }

  load(context: TrainingReliabilityContext, isCurrent: () => boolean): void {
    this.reset();
    const requestId = this.requestId;
    this.isLoading.set(true);
    this.request = this.backend.getTrainingCohensKappa(context.workspaceId, context.trainingId, context.weighted, context.level, [...context.coderIds])
      .pipe(takeUntilWorkspaceChanged(this.appService, context.workspaceId), takeUntilDestroyed(this.destroyRef), finalize(() => {
        if (requestId === this.requestId) this.isLoading.set(false);
      }))
      .subscribe({
        next: statistics => {
          if (requestId !== this.requestId || !isCurrent()) return;
          this.originalStatistics.set(statistics);
          this.filterStatistics();
          this.isLoading.set(false);
        },
        error: () => { if (requestId === this.requestId && isCurrent()) this.errors$.next('load'); }
      });
  }

  filterStatistics(): void {
    const statistics = this.originalStatistics();
    this.statistics.set(statistics ? withMeanAgreement(statistics, this.useWeightedMean()) : null);
  }

  calculateMeanAgreement(): void {
    const statistics = this.statistics();
    if (statistics) this.statistics.set(withMeanAgreement(statistics, this.useWeightedMean()));
  }

  exportCsv(context: TrainingReliabilityContext, isCurrent: () => boolean): Observable<Blob> {
    return defer(() => {
      if (this.isExporting()) return EMPTY;
      this.isExporting.set(true);
      return this.backend.exportTrainingReliabilityAsCsv(context.workspaceId, context.trainingId, context.weighted, context.level, [...context.coderIds]).pipe(
        takeUntil(this.cancel$),
        filter(() => isCurrent()),
        catchError(() => { if (isCurrent()) this.errors$.next('export'); return EMPTY; }),
        finalize(() => this.isExporting.set(false))
      );
    }).pipe(takeUntilWorkspaceChanged(this.appService, context.workspaceId), takeUntilDestroyed(this.destroyRef));
  }
}
