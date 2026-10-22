/* NgRx hides underscore-prefixed properties from the public store API. */
/* eslint no-underscore-dangle: ["error", { "allow": ["_errors", "_downloads", "_cancelExports", "_originalStatistics", "_isLoading", "_isExporting", "_useWeightedMean", "_useCodeLevel"] }] */
import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  patchState, signalStore, withComputed, withHooks, withMethods, withProps, withState
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import {
  EMPTY, Subject, catchError, defer, exhaustMap, finalize, switchMap, takeUntil, tap
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

interface ReliabilityRequest {
  context: TrainingReliabilityContext;
  isCurrent: () => boolean;
}

/** Dialog-local SignalStore pilot: state is protected; views use commands and read-only signals. */
export const TrainingReliabilityFacade = signalStore(
  withState({
    _originalStatistics: null as KappaStatistics | null,
    _isLoading: false,
    _isExporting: false,
    _useWeightedMean: true,
    _useCodeLevel: true
  }),
  withProps(() => {
    const errors = new Subject<'load' | 'export'>();
    const downloads = new Subject<{ blob: Blob; trainingId: number }>();
    return {
      _errors: errors,
      _downloads: downloads,
      _cancelExports: new Subject<void>(),
      errors$: errors.asObservable(),
      downloads$: downloads.asObservable()
    };
  }),
  withComputed(({
    _originalStatistics, _useWeightedMean, _useCodeLevel, _isLoading, _isExporting
  }) => ({
    originalStatistics: computed(() => _originalStatistics()),
    useWeightedMean: computed(() => _useWeightedMean()),
    useCodeLevel: computed(() => _useCodeLevel()),
    isLoading: computed(() => _isLoading()),
    isExporting: computed(() => _isExporting()),
    statistics: computed(() => {
      const original = _originalStatistics();
      return original ? withMeanAgreement(original, _useWeightedMean()) : null;
    })
  })),
  withComputed(({ statistics }) => ({
    variableKappaSummaries: computed<VariableKappaSummary[]>(() => (
      statistics()?.variables.map(variable => ({
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
    ))
  })),
  withMethods((store, backend = inject(CodingTrainingBackendService), appService = inject(AppService)) => {
    const load = rxMethod<ReliabilityRequest | null>(switchMap(request => {
      // switchMap tears down the previous request before the next loading state is set.
      patchState(store, { _originalStatistics: null, _isLoading: !!request });
      if (!request) return EMPTY;
      const { context, isCurrent } = request;
      return defer(() => backend.getTrainingCohensKappa(
        context.workspaceId, context.trainingId, context.weighted, context.level, context.coderIds
      )).pipe(
        takeUntilWorkspaceChanged(appService, context.workspaceId),
        tap(_originalStatistics => {
          if (isCurrent()) patchState(store, { _originalStatistics, _isLoading: false });
        }),
        catchError(() => { if (isCurrent()) store._errors.next('load'); return EMPTY; }),
        finalize(() => patchState(store, { _isLoading: false }))
      );
    }));
    const exportCsv = rxMethod<ReliabilityRequest>(exhaustMap(({ context, isCurrent }) => defer(() => {
      patchState(store, { _isExporting: true });
      return backend.exportTrainingReliabilityAsCsv(
        context.workspaceId, context.trainingId, context.weighted, context.level, context.coderIds
      );
    }).pipe(
      takeUntilWorkspaceChanged(appService, context.workspaceId),
      takeUntil(store._cancelExports),
      tap(blob => { if (isCurrent()) store._downloads.next({ blob, trainingId: context.trainingId }); }),
      catchError(() => { if (isCurrent()) store._errors.next('export'); return EMPTY; }),
      finalize(() => patchState(store, { _isExporting: false }))
    )));
    const snapshot = (context: TrainingReliabilityContext): TrainingReliabilityContext => ({
      ...context, coderIds: [...context.coderIds]
    });
    return {
      load(context: TrainingReliabilityContext, isCurrent: () => boolean): void {
        load({ context: snapshot(context), isCurrent });
      },
      exportCsv(context: TrainingReliabilityContext, isCurrent: () => boolean): void {
        exportCsv({ context: snapshot(context), isCurrent });
      },
      /** Paging refreshes statistics while preserving a full-cohort CSV export. */
      resetStatistics(): void { load(null); },
      reset(): void { load(null); store._cancelExports.next(); },
      setWeightingMethod(weighted: boolean): void { patchState(store, { _useWeightedMean: weighted }); },
      setCalculationLevel(codeLevel: boolean): void { patchState(store, { _useCodeLevel: codeLevel }); }
    };
  }),
  withHooks({
    onInit(store) {
      const appService = inject(AppService);
      let workspaceId = appService.selectedWorkspaceId;
      appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
        if (id !== workspaceId) { workspaceId = id; store.reset(); }
      });
    },
    onDestroy(store) {
      store.reset();
      patchState(store, { _originalStatistics: null, _isLoading: false, _isExporting: false });
      store._cancelExports.complete();
      store._errors.complete();
      store._downloads.complete();
    }
  })
);
