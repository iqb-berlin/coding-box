import {
  DestroyRef, inject, Injectable, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError, defer, EMPTY, finalize, merge, Observable, of, Subject, switchMap, tap
} from 'rxjs';
import { CodingJobBackendService, ManualCodingScopeSummary } from '../../services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { Variable } from '../../models/coding-job.model';

export interface JobVariableRequest {
  workspaceId: number;
  unitName?: string;
  trainingRequired?: boolean;
  includeDeriveError?: boolean;
  editingDefinitionId?: number;
  preloadedVariables?: Variable[];
}

/** Each filter replaces both variable and scope queries. Owned by one dialog. */
@Injectable()
export class JobVariableDataFacade {
  private readonly backend = inject(CodingJobBackendService);
  private readonly app = inject(AppService);
  private readonly requests = new Subject<JobVariableRequest>();
  private readonly loaded = new Subject<Variable[]>();
  private readonly finished = new Subject<void>();
  private generation = 0;
  readonly isLoading = signal(false);
  readonly summary = signal<ManualCodingScopeSummary | null>(null);
  readonly loaded$ = this.loaded.asObservable();
  readonly finished$ = this.finished.asObservable();

  constructor() {
    this.requests.pipe(
      switchMap(request => defer(() => {
        this.generation += 1;
        const generation = this.generation;
        this.isLoading.set(true);
        if (!request.workspaceId) {
          this.summary.set(null);
          this.finished.next();
          this.isLoading.set(false);
          return EMPTY;
        }
        const variables: Observable<Variable[]> = request.preloadedVariables ? of(request.preloadedVariables) : defer(() => (
          this.backend.getCodingIncompleteVariables(
            request.workspaceId, request.unitName, request.trainingRequired, request.includeDeriveError, request.editingDefinitionId
          )
        ));
        const summary = defer(() => this.backend.getManualCodingScopeSummary(
          request.workspaceId, request.unitName, request.trainingRequired
        )).pipe(
          tap(value => this.summary.set(value)),
          catchError(() => { this.summary.set(null); return EMPTY; })
        );
        return merge(summary, variables.pipe(
          tap(value => {
            this.loaded.next(value);
            this.isLoading.set(false);
            this.finished.next();
          }),
          catchError(() => { this.finished.next(); return EMPTY; }),
          finalize(() => { if (generation === this.generation) this.isLoading.set(false); })
        )).pipe(takeUntilWorkspaceChanged(this.app, request.workspaceId));
      })),
      takeUntilDestroyed()
    ).subscribe();
    inject(DestroyRef).onDestroy(() => {
      this.requests.complete(); this.loaded.complete(); this.finished.complete();
    });
  }

  load(request: JobVariableRequest): void { this.requests.next(request); }
}
