import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { ValidationService } from './validation.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';

export type ValidationTaskType =
  | 'variables'
  | 'variableTypes'
  | 'responseStatus'
  | 'testTakers'
  | 'groupResponses'
  | 'duplicateResponses'
  | 'deleteResponses'
  | 'deleteAllResponses';

export interface RunValidationTaskResult<T = unknown> {
  createdTask: ValidationTaskDto;
  finalTask: ValidationTaskDto;
  result: T;
}

export interface DeleteTaskResult {
  deletedCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class ValidationTaskRunnerService {
  constructor(private validationService: ValidationService) { }

  runTask<T = unknown>(
    workspaceId: number,
    type: ValidationTaskType,
    options?: {
      page?: number;
      limit?: number;
      additionalData?: Record<string, unknown>;
      pollIntervalMs?: number;
    }
  ): Observable<RunValidationTaskResult<T>> {
    const pollIntervalMs = options?.pollIntervalMs ?? 2000;

    return this.validationService.createValidationTask(
      workspaceId,
      type,
      options?.page,
      options?.limit,
      options?.additionalData
    ).pipe(
      switchMap(createdTask => this.validationService.pollValidationTask(workspaceId, createdTask.id, pollIntervalMs).pipe(
        take(1),
        switchMap(finalTask => {
          if (finalTask.status === 'failed') {
            return throwError(() => new Error(finalTask.error || 'Unbekannter Fehler'));
          }

          if (finalTask.status !== 'completed') {
            return throwError(() => new Error('Unbekannter Task-Status'));
          }

          return this.validationService.getValidationResults(workspaceId, finalTask.id).pipe(
            map(result => ({
              createdTask,
              finalTask,
              result: result as T
            }))
          );
        })
      ))
    );
  }

  runDeleteResponsesTask(
    workspaceId: number,
    responseIds: number[],
    pollIntervalMs: number = 2000
  ): Observable<RunValidationTaskResult<DeleteTaskResult>> {
    return this.validationService.createDeleteResponsesTask(workspaceId, responseIds).pipe(
      switchMap(createdTask => this.validationService.pollValidationTask(workspaceId, createdTask.id, pollIntervalMs).pipe(
        take(1),
        switchMap(finalTask => {
          if (finalTask.status === 'failed') {
            return throwError(() => new Error(finalTask.error || 'Unbekannter Fehler'));
          }

          if (finalTask.status !== 'completed') {
            return throwError(() => new Error('Unbekannter Task-Status'));
          }

          return this.validationService.getValidationResults(workspaceId, finalTask.id).pipe(
            map(result => ({
              createdTask,
              finalTask,
              result: result as DeleteTaskResult
            }))
          );
        })
      ))
    );
  }

  runDeleteAllResponsesTask(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses',
    pollIntervalMs: number = 2000
  ): Observable<RunValidationTaskResult<DeleteTaskResult>> {
    return this.validationService.createDeleteAllResponsesTask(workspaceId, validationType).pipe(
      switchMap(createdTask => this.validationService.pollValidationTask(workspaceId, createdTask.id, pollIntervalMs).pipe(
        take(1),
        switchMap(finalTask => {
          if (finalTask.status === 'failed') {
            return throwError(() => new Error(finalTask.error || 'Unbekannter Fehler'));
          }

          if (finalTask.status !== 'completed') {
            return throwError(() => new Error('Unbekannter Task-Status'));
          }

          return this.validationService.getValidationResults(workspaceId, finalTask.id).pipe(
            map(result => ({
              createdTask,
              finalTask,
              result: result as DeleteTaskResult
            }))
          );
        })
      ))
    );
  }
}
