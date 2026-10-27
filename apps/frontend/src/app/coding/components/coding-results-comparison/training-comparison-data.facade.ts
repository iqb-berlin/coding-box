import {
  DestroyRef, inject, Injectable, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError, defer, EMPTY, finalize, map, Subject, switchMap, tap
} from 'rxjs';
import type {
  TrainingCodingComparisonPageDto, WithinTrainingCodingComparisonPageDto
} from '../../../../../../../api-dto/coding/training-comparison.dto';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingTrainingBackendService, TrainingComparisonQueryOptions } from '../../services/coding-training-backend.service';

type ComparisonContext = { mode: 'between-trainings'; trainingIds: number[] } |
{ mode: 'within-training'; trainingId: number };
export type TrainingComparisonRequest = ComparisonContext & {
  workspaceId: number;
  options: TrainingComparisonQueryOptions;
  isCurrent: () => boolean;
};
type LoadedComparison = { mode: 'between-trainings'; page: TrainingCodingComparisonPageDto } |
{ mode: 'within-training'; page: WithinTrainingCodingComparisonPageDto };

/** A dialog owns one comparison request. Replacing or closing it cancels the old page. */
@Injectable()
export class TrainingComparisonDataFacade {
  private readonly backend = inject(CodingTrainingBackendService);
  private readonly app = inject(AppService);
  private requestGeneration = 0;
  private readonly requests = new Subject<TrainingComparisonRequest | null>();
  private readonly loaded = new Subject<LoadedComparison>();
  private readonly failed = new Subject<void>();
  private readonly loading = signal(false);
  readonly isLoading = this.loading.asReadonly();
  readonly loaded$ = this.loaded.asObservable();
  readonly failed$ = this.failed.asObservable();

  constructor() {
    this.requests.pipe(
      switchMap(request => {
        this.requestGeneration += 1;
        const generation = this.requestGeneration;
        if (!request) return EMPTY;
        return defer(() => {
          this.loading.set(true);
          return request.mode === 'between-trainings' ?
            this.backend.compareTrainingCodingResults(request.workspaceId, request.trainingIds.join(','), request.options)
              .pipe(map(page => ({ mode: 'between-trainings' as const, page }))) :
            this.backend.getCachedWithinTrainingCodingResults(request.workspaceId, request.trainingId, request.options)
              .pipe(map(page => ({ mode: 'within-training' as const, page })));
        }).pipe(
          takeUntilWorkspaceChanged(this.app, request.workspaceId),
          tap(result => {
            this.loading.set(false);
            if (request.isCurrent()) this.loaded.next(result);
          }),
          catchError(() => { if (request.isCurrent()) this.failed.next(); return EMPTY; }),
          finalize(() => { if (generation === this.requestGeneration) this.loading.set(false); })
        );
      }),
      takeUntilDestroyed()
    ).subscribe();
    inject(DestroyRef).onDestroy(() => {
      this.requests.complete(); this.loaded.complete(); this.failed.complete();
    });
  }

  load(request: TrainingComparisonRequest): void {
    this.requests.next({
      ...request,
      ...(request.mode === 'between-trainings' ? { trainingIds: [...request.trainingIds] } : {}),
      options: {
        ...request.options,
        filters: { ...request.options.filters },
        selectedCoderKeys: request.options.selectedCoderKeys ? [...request.options.selectedCoderKeys] : undefined,
        selectedJobIds: request.options.selectedJobIds ? [...request.options.selectedJobIds] : undefined
      }
    });
  }

  cancel(): void { this.requests.next(null); }
}
