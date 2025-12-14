import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class ValidationTaskStateService {
  // Store task IDs by workspace ID and validation type
  private activeTasks: Record<number, Record<string, number>> = {};

  // Store validation results by workspace ID and validation type
  private validationResults: Record<number, Record<string, ValidationResult>> = {};

  // Store batch status by workspace ID
  private batchState: Record<number, ValidationBatchState> = {};

  private activeTasks$ = new BehaviorSubject<Record<number, Record<string, number>>>({});
  private validationResults$ = new BehaviorSubject<Record<number, Record<string, ValidationResult>>>({});
  private batchState$ = new BehaviorSubject<Record<number, ValidationBatchState>>({});

  observeTaskIds(workspaceId: number): Observable<Record<string, number>> {
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
    return this.batchState[workspaceId] || { status: 'idle' };
  }

  setBatchState(workspaceId: number, state: ValidationBatchState): void {
    this.batchState[workspaceId] = state;
    this.batchState$.next({ ...this.batchState });
  }

  setTaskId(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses', taskId: number): void {
    if (!this.activeTasks[workspaceId]) {
      this.activeTasks[workspaceId] = {};
    }
    this.activeTasks[workspaceId][type] = taskId;
    this.activeTasks$.next({ ...this.activeTasks });
  }

  removeTaskId(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses'): void {
    if (this.activeTasks[workspaceId]) {
      delete this.activeTasks[workspaceId][type];
      this.activeTasks$.next({ ...this.activeTasks });
    }
  }

  getAllTaskIds(workspaceId: number): Record<string, number> {
    return this.activeTasks[workspaceId] || {};
  }

  setValidationResult(
    workspaceId: number,
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'duplicateResponses',
    result: ValidationResult
  ): void {
    if (!this.validationResults[workspaceId]) {
      this.validationResults[workspaceId] = {};
    }
    this.validationResults[workspaceId][type] = result;
    this.validationResults$.next({ ...this.validationResults });
  }

  getAllValidationResults(workspaceId: number): Record<string, ValidationResult> {
    return this.validationResults[workspaceId] || {};
  }
}
