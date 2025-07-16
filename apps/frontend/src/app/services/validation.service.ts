import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  Observable,
  of,
  interval,
  switchMap,
  takeWhile,
  map,
  forkJoin
} from 'rxjs';
import { InvalidVariableDto } from '../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto } from '../../../../../api-dto/files/testtakers-validation.dto';
import { SERVER_URL } from '../injection-tokens';
import { ValidationTaskDto } from '../models/validation-task.dto';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class ValidationService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  validateVariables(workspaceId: number, page: number = 1, limit: number = 10): Observable<PaginatedResponse<InvalidVariableDto>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedResponse<InvalidVariableDto>>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/validate-variables`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of({
        data: [],
        total: 0,
        page,
        limit
      }))
    );
  }

  validateVariableTypes(workspaceId: number, page: number = 1, limit: number = 10): Observable<PaginatedResponse<InvalidVariableDto>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedResponse<InvalidVariableDto>>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/validate-variable-types`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of({
        data: [],
        total: 0,
        page,
        limit
      }))
    );
  }

  validateResponseStatus(workspaceId: number, page: number = 1, limit: number = 10): Observable<PaginatedResponse<InvalidVariableDto>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedResponse<InvalidVariableDto>>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/validate-response-status`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of({
        data: [],
        total: 0,
        page,
        limit
      }))
    );
  }

  validateTestTakers(workspaceId: number): Observable<TestTakersValidationDto> {
    return this.http.get<TestTakersValidationDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/validate-testtakers`,
      { headers: this.authHeader }
    ).pipe(
      catchError(() => of({
        testTakersFound: false,
        totalGroups: 0,
        totalLogins: 0,
        totalBookletCodes: 0,
        missingPersons: []
      }))
    );
  }

  validateGroupResponses(workspaceId: number, page: number = 1, limit: number = 10): Observable<{
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
    total: number;
    page: number;
    limit: number;
  }> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<{
      testTakersFound: boolean;
      groupsWithResponses: { group: string; hasResponse: boolean }[];
      allGroupsHaveResponses: boolean;
      total: number;
      page: number;
      limit: number;
    }>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/validate-group-responses`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of({
        testTakersFound: false,
        groupsWithResponses: [],
        allGroupsHaveResponses: false,
        total: 0,
        page,
        limit
      }))
    );
  }

  deleteInvalidResponses(workspaceId: number, responseIds: number[]): Observable<number> {
    const params = new HttpParams().set('responseIds', responseIds.join(','));
    return this.http.delete<number>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/invalid-responses`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of(0))
    );
  }

  deleteAllInvalidResponses(workspaceId: number, validationType: 'variables' | 'variableTypes' | 'responseStatus'): Observable<number> {
    const params = new HttpParams().set('validationType', validationType);
    return this.http.delete<number>(
      `${this.serverUrl}admin/workspace/${workspaceId}/files/all-invalid-responses`,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(() => of(0))
    );
  }

  createValidationTask(
    workspaceId: number,
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses',
    page?: number,
    limit?: number,
    additionalData?: Record<string, unknown>
  ): Observable<ValidationTaskDto> {
    let params = new HttpParams().set('type', type);

    if (page) {
      params = params.set('page', page.toString());
    }

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    // Add additional data as query parameters if provided
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            params = params.set(key, value.join(','));
          } else {
            params = params.set(key, String(value));
          }
        }
      });
    }

    return this.http.post<ValidationTaskDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/validation-tasks`,
      null,
      { headers: this.authHeader, params }
    ).pipe(
      catchError(error => {
        console.error(`Error creating validation task: ${error.message}`);
        throw error;
      })
    );
  }

  createDeleteResponsesTask(
    workspaceId: number,
    responseIds: number[]
  ): Observable<ValidationTaskDto> {
    return this.createValidationTask(
      workspaceId,
      'deleteResponses',
      undefined,
      undefined,
      { responseIds }
    );
  }

  createDeleteAllResponsesTask(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus'
  ): Observable<ValidationTaskDto> {
    return this.createValidationTask(
      workspaceId,
      'deleteAllResponses',
      undefined,
      undefined,
      { validationType }
    );
  }

  getValidationTask(workspaceId: number, taskId: number): Observable<ValidationTaskDto> {
    return this.http.get<ValidationTaskDto>(
      `${this.serverUrl}admin/workspace/${workspaceId}/validation-tasks/${taskId}`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        console.error(`Error getting validation task: ${error.message}`);
        throw error;
      })
    );
  }

  getValidationTasks(workspaceId: number): Observable<ValidationTaskDto[]> {
    return this.http.get<ValidationTaskDto[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/validation-tasks`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        console.error(`Error getting validation tasks: ${error.message}`);
        throw error;
      })
    );
  }

  getValidationResults(workspaceId: number, taskId: number): Observable<unknown> {
    return this.http.get<unknown>(
      `${this.serverUrl}admin/workspace/${workspaceId}/validation-tasks/${taskId}/results`,
      { headers: this.authHeader }
    ).pipe(
      catchError(error => {
        console.error(`Error getting validation results: ${error.message}`);
        throw error;
      })
    );
  }

  pollValidationTask(
    workspaceId: number,
    taskId: number,
    pollInterval: number = 2000
  ): Observable<ValidationTaskDto> {
    return interval(pollInterval).pipe(
      switchMap(() => this.getValidationTask(workspaceId, taskId)),
      takeWhile(task => task.status === 'pending' || task.status === 'processing', true)
    );
  }

  getLastValidationResults(
    workspaceId: number
  ): Observable<Record<string, { task: ValidationTaskDto; result: unknown }>> {
    return this.getValidationTasks(workspaceId).pipe(
      switchMap(tasks => {
        // Filter completed tasks and group by validation type
        const completedTasks = tasks.filter(task => task.status === 'completed');
        const tasksByType: Record<string, ValidationTaskDto[]> = {};

        for (const task of completedTasks) {
          if (!tasksByType[task.validation_type]) {
            tasksByType[task.validation_type] = [];
          }
          tasksByType[task.validation_type].push(task);
        }

        // Get the most recent task for each type
        const latestTasks: Record<string, ValidationTaskDto> = {};
        for (const type in tasksByType) {
          if (Object.prototype.hasOwnProperty.call(tasksByType, type)) {
            // Sort by creation date in descending order
            tasksByType[type].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            latestTasks[type] = tasksByType[type][0];
          }
        }

        const resultObservables: Array<Observable<[string, { task: ValidationTaskDto; result: unknown }]>> = [];

        for (const type in latestTasks) {
          if (Object.prototype.hasOwnProperty.call(latestTasks, type)) {
            const task = latestTasks[type];
            resultObservables.push(
              this.getValidationResults(workspaceId, task.id).pipe(
                map<unknown, [string, { task: ValidationTaskDto; result: unknown }]>(
                  result => [type, { task, result }] as [string, { task: ValidationTaskDto; result: unknown }]
                ),
                catchError(error => {
                  console.error(`Error getting results for task ${task.id}: ${error.message}`);
                  return of([type, { task, result: null }] as [string, { task: ValidationTaskDto; result: unknown }]);
                })
              )
            );
          }
        }

        if (resultObservables.length === 0) {
          return of<Record<string, { task: ValidationTaskDto; result: unknown }>>({});
        }

        return forkJoin<[string, { task: ValidationTaskDto; result: unknown }][]>(resultObservables).pipe(
          map<[string, { task: ValidationTaskDto; result: unknown }][], Record<string, { task: ValidationTaskDto; result: unknown }>>(results => {
            const resultMap: Record<string, { task: ValidationTaskDto; result: unknown }> = {};
            for (const [type, data] of results) {
              resultMap[type] = data;
            }
            return resultMap;
          })
        );
      }),
      catchError(error => {
        console.error(`Error getting last validation results: ${error.message}`);
        return of<Record<string, { task: ValidationTaskDto; result: unknown }>>({});
      })
    );
  }
}
