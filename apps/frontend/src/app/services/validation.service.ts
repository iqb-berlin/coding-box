import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  catchError,
  Observable,
  of
} from 'rxjs';
import { InvalidVariableDto } from '../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto } from '../../../../../api-dto/files/testtakers-validation.dto';
import { SERVER_URL } from '../injection-tokens';

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
}
