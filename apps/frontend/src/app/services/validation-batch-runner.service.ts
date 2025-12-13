import { Injectable } from '@angular/core';
import { Observable, Subscription, from, of, throwError } from 'rxjs';
import { catchError, concatMap, filter, map, switchMap, take, tap } from 'rxjs/operators';
import { BackendService } from './backend.service';
import { ValidationTaskStateService, ValidationResult } from './validation-task-state.service';
import { ValidationTaskDto } from '../models/validation-task.dto';

export type BatchValidationType =
  | 'testTakers'
  | 'variables'
  | 'variableTypes'
  | 'responseStatus'
  | 'duplicateResponses'
  | 'groupResponses';

@Injectable({
  providedIn: 'root'
})
export class ValidationBatchRunnerService {
  private readonly steps: BatchValidationType[] = [
    'testTakers',
    'variables',
    'variableTypes',
    'responseStatus',
    'duplicateResponses',
    'groupResponses'
  ];

  private runningBatches: Record<number, Subscription> = {};

  constructor(
    private backendService: BackendService,
    private validationTaskStateService: ValidationTaskStateService
  ) {}

  startBatch(
    workspaceId: number,
    options?: { force?: boolean; pollIntervalMs?: number }
  ): void {
    const current = this.validationTaskStateService.getBatchState(workspaceId);
    if (current.status === 'running') {
      return;
    }

    if (this.runningBatches[workspaceId]) {
      return;
    }

    this.validationTaskStateService.setBatchState(workspaceId, {
      status: 'running',
      startedAt: Date.now()
    });

    this.runningBatches[workspaceId] = from(this.steps).pipe(
      concatMap(type => this.runStep(workspaceId, type, options)),
      tap(() => {
        this.validationTaskStateService.setBatchState(workspaceId, {
          status: 'completed',
          startedAt: this.validationTaskStateService.getBatchState(workspaceId).startedAt,
          finishedAt: Date.now()
        });
      }),
      map(() => void 0),
      catchError(err => {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        this.validationTaskStateService.setBatchState(workspaceId, {
          status: 'failed',
          startedAt: this.validationTaskStateService.getBatchState(workspaceId).startedAt,
          finishedAt: Date.now(),
          error: message
        });
        return throwError(() => err);
      })
    ).subscribe({
      next: () => {},
      error: () => {},
      complete: () => {
        this.runningBatches[workspaceId]?.unsubscribe();
        delete this.runningBatches[workspaceId];
      }
    });
  }

  private runStep(
    workspaceId: number,
    type: BatchValidationType,
    options?: { force?: boolean; pollIntervalMs?: number }
  ): Observable<void> {
    const pollIntervalMs = options?.pollIntervalMs ?? 2000;

    const existingResult = this.validationTaskStateService.getAllValidationResults(workspaceId)[type];
    const existingTaskId = this.validationTaskStateService.getAllTaskIds(workspaceId)[type];

    if (!options?.force && existingResult && !existingTaskId) {
      return of(void 0);
    }

    if (existingTaskId) {
      // Already running (or at least known) -> do not start a second one.
      return of(void 0);
    }

    return this.backendService.createValidationTask(workspaceId, type).pipe(
      tap(createdTask => {
        this.validationTaskStateService.setTaskId(workspaceId, type, createdTask.id);
      }),
      switchMap((createdTask: ValidationTaskDto) =>
        this.backendService.pollValidationTask(workspaceId, createdTask.id, pollIntervalMs).pipe(
          filter(t => t.status === 'completed' || t.status === 'failed'),
          take(1),
          switchMap(finalTask => {
            this.validationTaskStateService.removeTaskId(workspaceId, type);

            if (finalTask.status === 'failed') {
              const result: ValidationResult = {
                status: 'failed',
                timestamp: Date.now(),
                details: { error: finalTask.error || 'Unbekannter Fehler' }
              };
              this.validationTaskStateService.setValidationResult(workspaceId, type, result);
              return of(void 0);
            }

            return this.backendService.getValidationResults(workspaceId, finalTask.id).pipe(
              tap(stepResult => {
                const validationResult = this.evaluateResult(type, stepResult);
                this.validationTaskStateService.setValidationResult(workspaceId, type, validationResult);
              }),
              map(() => void 0)
            );
          })
        )
      )
    );
  }

  private evaluateResult(type: BatchValidationType, result: unknown): ValidationResult {
    const now = Date.now();

    const asPaginated = (r: unknown): { total?: number } => (r as { total?: number }) || {};

    switch (type) {
      case 'variables':
      case 'variableTypes':
      case 'responseStatus': {
        const total = Number(asPaginated(result).total ?? 0);
        return {
          status: total > 0 ? 'failed' : 'success',
          timestamp: now,
          details: result
        };
      }

      case 'duplicateResponses': {
        const total = Number(asPaginated(result).total ?? 0);
        return {
          status: total > 0 ? 'failed' : 'success',
          timestamp: now,
          details: result
        };
      }

      case 'testTakers': {
        const r = result as { testTakersFound?: boolean; missingPersons?: unknown[] };
        const testTakersFound = Boolean(r?.testTakersFound);
        const missingPersonsCount = Array.isArray(r?.missingPersons) ? r.missingPersons.length : 0;
        const hasErrors = !testTakersFound || missingPersonsCount > 0;
        return {
          status: hasErrors ? 'failed' : 'success',
          timestamp: now,
          details: result
        };
      }

      case 'groupResponses': {
        const r = result as { testTakersFound?: boolean; allGroupsHaveResponses?: boolean };
        const testTakersFound = Boolean(r?.testTakersFound);
        const allGroupsHaveResponses = Boolean(r?.allGroupsHaveResponses);
        const hasErrors = !testTakersFound || !allGroupsHaveResponses;
        return {
          status: hasErrors ? 'failed' : 'success',
          timestamp: now,
          details: result
        };
      }

      default:
        return { status: 'success', timestamp: now, details: result };
    }
  }
}
