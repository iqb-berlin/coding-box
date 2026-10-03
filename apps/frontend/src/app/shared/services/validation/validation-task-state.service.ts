import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { ValidationTaskDto } from '../../../models/validation-task.dto';

export interface ValidationResult {
  status: 'success' | 'failed' | 'not-run';
  timestamp: number;
  details?: unknown;
}

export interface ValidationBatchState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export type ValidationType =
  | 'variables'
  | 'variableTypes'
  | 'responseStatus'
  | 'testTakers'
  | 'groupResponses'
  | 'duplicateResponses';

const ALL_VALIDATION_TYPES: ValidationType[] = [
  'testTakers',
  'variables',
  'variableTypes',
  'responseStatus',
  'duplicateResponses',
  'groupResponses'
];

@Injectable({
  providedIn: 'root'
})
export class ValidationTaskStateService {
  // Store task details by workspace ID and validation type
  private readonly activeTasks = signal<Record<number, Record<string, ValidationTaskDto>>>({});

  // Store validation results by workspace ID and validation type
  private readonly validationResults = signal<Record<number, Record<string, ValidationResult>>>({});

  // Store batch status by workspace ID
  private readonly batchState = signal<Record<number, ValidationBatchState>>({});

  private activeTasks$ = new BehaviorSubject<Record<number, Record<string, ValidationTaskDto>>>({});
  private validationResults$ = new BehaviorSubject<Record<number, Record<string, ValidationResult>>>({});
  private batchState$ = new BehaviorSubject<Record<number, ValidationBatchState>>({});

  observeTaskIds(workspaceId: number): Observable<Record<string, ValidationTaskDto>> {
    return new Observable(subscriber => {
      const sub = this.activeTasks$.subscribe(all => subscriber.next(all[workspaceId] || {}));
      return () => sub.unsubscribe();
    });
  }

  observeValidationResults(workspaceId: number): Observable<Record<string, ValidationResult>> {
    return new Observable(subscriber => {
      const sub = this.validationResults$.subscribe(all => subscriber.next(all[workspaceId] || {}));
      return () => sub.unsubscribe();
    });
  }

  observeBatchState(workspaceId: number): Observable<ValidationBatchState> {
    return new Observable(subscriber => {
      const sub = this.batchState$.subscribe(all => subscriber.next(all[workspaceId] || { status: 'idle' }));
      return () => sub.unsubscribe();
    });
  }

  getBatchState(workspaceId: number): ValidationBatchState {
    return this.batchState()[workspaceId] || { status: 'idle' };
  }

  setBatchState(workspaceId: number, state: ValidationBatchState): void {
    this.batchState.update(all => ({ ...all, [workspaceId]: state }));
    this.batchState$.next(this.batchState());
  }

  setTaskId(workspaceId: number, type: ValidationType, task: ValidationTaskDto): void {
    this.activeTasks.update(all => ({ ...all, [workspaceId]: { ...all[workspaceId], [type]: task } }));
    this.activeTasks$.next(this.activeTasks());
  }

  removeTaskId(workspaceId: number, type: ValidationType): void {
    if (!this.activeTasks()[workspaceId]) return;
    this.activeTasks.update(all => {
      const tasks = { ...all[workspaceId] };
      delete tasks[type];
      return { ...all, [workspaceId]: tasks };
    });
    this.activeTasks$.next(this.activeTasks());
  }

  getAllTaskIds(workspaceId: number): Record<string, ValidationTaskDto> {
    return this.activeTasks()[workspaceId] || {};
  }

  setValidationResult(workspaceId: number, type: ValidationType, result: ValidationResult): void {
    this.validationResults.update(all => ({ ...all, [workspaceId]: { ...all[workspaceId], [type]: result } }));
    this.validationResults$.next(this.validationResults());
  }

  getAllValidationResults(workspaceId: number): Record<string, ValidationResult> {
    return this.validationResults()[workspaceId] || {};
  }

  hasAnyValidationResult(workspaceId: number): boolean {
    const results = this.getAllValidationResults(workspaceId);
    return Object.keys(results).length > 0;
  }

  hasCompleteValidationResults(workspaceId: number): boolean {
    const results = this.getAllValidationResults(workspaceId);
    return ALL_VALIDATION_TYPES.every(type => Boolean(results[type]));
  }

  invalidateWorkspace(workspaceId: number): void {
    if (this.activeTasks()[workspaceId]) {
      this.activeTasks.update(all => {
        const next = { ...all };
        delete next[workspaceId];
        return next;
      });
      this.activeTasks$.next(this.activeTasks());
    }
    if (this.validationResults()[workspaceId]) {
      this.validationResults.update(all => {
        const next = { ...all };
        delete next[workspaceId];
        return next;
      });
      this.validationResults$.next(this.validationResults());
    }
    if (this.batchState()[workspaceId]) {
      this.batchState.update(all => {
        const next = { ...all };
        delete next[workspaceId];
        return next;
      });
      this.batchState$.next(this.batchState());
    }
  }
}
