import { Injectable, Injector, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable, catchError, map, of, switchMap
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { suppressGlobalHttpErrorContext } from '../../core/interceptors/http-error-context';
import { AppService, WorkspaceTokenPolicy } from '../../core/services/app.service';
import { DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS, EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES } from '../../core/services/auth-session.config';
import { WorkspaceSettingsService } from '../../shared/services/workspace/workspace-settings.service';
import {
  CohensKappaStatisticsResponse, CohensKappaScope, CohensKappaCalculationLevel, WorkspaceCohensKappaSummary
} from './coding-reliability.models';

/** Kappa queries and exports share scope and replay-token policy here. */
@Injectable({ providedIn: 'root' })
export class CodingReliabilityService {
  private readonly serverUrl = inject(SERVER_URL);
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private readonly workspaceSettingsService = inject(WorkspaceSettingsService);

  private get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
  }

  getCohensKappaStatistics(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<CohensKappaStatisticsResponse> {
    let params = new HttpParams();

    params = params.set('weightedMean', weightedMean.toString());
    params = params.set('excludeTrainings', excludeTrainings.toString());
    params = params.set('level', calculationLevel);

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }
    params = this.appendCohensKappaScopeParams(params, scope);

    return this.http
      .get<CohensKappaStatisticsResponse>(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa`,
        { headers: this.authHeader, params }
      )
      .pipe(
        catchError(() => of({
          variables: [],
          workspaceSummary: {
            totalCodedResponses: 0,
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            meanAgreement: null,
            variablesIncluded: 0,
            codersIncluded: 0,
            weightingMethod: 'weighted' as 'weighted' | 'unweighted',
            calculationLevel
          }
        })
        )
      );
  }

  exportCohensKappaSummaryAsCsv(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId,
      scope,
      calculationLevel
    );

    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/export/summary/csv`,
      {
        headers: this.authHeader,
        params,
        responseType: 'blob',
        context: suppressGlobalHttpErrorContext()
      }
    );
  }

  exportCohensKappaStatisticsAsXlsx(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId,
      scope,
      calculationLevel
    );

    return this.getReplayExportAuthToken(workspaceId).pipe(
      switchMap(authToken => this.http.get(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/export/xlsx`,
        {
          headers: this.authHeader,
          params: params.set('authToken', authToken),
          responseType: 'blob',
          context: suppressGlobalHttpErrorContext()
        }
      )
      )
    );
  }

  exportCohensKappaStatisticsAsCsv(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    unitName?: string,
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): Observable<Blob> {
    const params = this.buildCohensKappaExportParams(
      weightedMean,
      excludeTrainings,
      unitName,
      variableId,
      scope,
      calculationLevel
    );

    return this.http.get(
      `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/export/csv`,
      {
        headers: this.authHeader,
        params,
        responseType: 'blob',
        context: suppressGlobalHttpErrorContext()
      }
    );
  }

  private buildCohensKappaExportParams(
    weightedMean: boolean,
    excludeTrainings: boolean,
    unitName?: string,
    variableId?: string,
    scope?: CohensKappaScope,
    calculationLevel: CohensKappaCalculationLevel = 'code'
  ): HttpParams {
    let params = new HttpParams()
      .set('weightedMean', weightedMean.toString())
      .set('excludeTrainings', excludeTrainings.toString())
      .set('level', calculationLevel);

    if (unitName) {
      params = params.set('unitName', unitName);
    }
    if (variableId) {
      params = params.set('variableId', variableId);
    }

    return this.appendCohensKappaScopeParams(params, scope);
  }

  private appendCohensKappaScopeParams(
    params: HttpParams,
    scope?: CohensKappaScope
  ): HttpParams {
    let scopedParams = params;

    if (scope?.jobDefinitionIds?.length) {
      scopedParams = scopedParams.set(
        'jobDefinitionIds',
        scope.jobDefinitionIds.join(',')
      );
    }
    if (scope?.coderTrainingIds?.length) {
      scopedParams = scopedParams.set(
        'coderTrainingIds',
        scope.coderTrainingIds.join(',')
      );
    }
    if (scope?.coderIds?.length) {
      scopedParams = scopedParams.set('coderIds', scope.coderIds.join(','));
    }

    return scopedParams;
  }

  private getReplayExportAuthToken(workspaceId: number): Observable<string> {
    return this.workspaceSettingsService
      .getReplayUrlExportMode(workspaceId)
      .pipe(
        switchMap(mode => (mode === 'auth' ? this.createExternalReplayToken(workspaceId) : of(''))
        )
      );
  }

  private createExternalReplayToken(workspaceId: number): Observable<string> {
    const appService = this.injector.get(AppService);
    return appService.getWorkspaceTokenPolicy().pipe(
      map(policy => this.getExternalReplayTokenMaxDurationDays(policy)),
      switchMap(maxDurationDays => this.workspaceSettingsService.getReplayUrlExportTokenDurationDays(
        workspaceId,
        maxDurationDays
      )
      ),
      switchMap(durationDays => appService.createOwnToken(
        workspaceId,
        durationDays,
        EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
      )
      )
    );
  }

  private getExternalReplayTokenMaxDurationDays(
    policy: WorkspaceTokenPolicy
  ): number {
    const maxDurations = EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES.map(
      scope => policy.scopes[scope]?.maxDurationDays
    ).filter(
      (duration): duration is number => Number.isInteger(duration) && duration >= 1
    );

    return maxDurations.length ?
      Math.min(...maxDurations) :
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS;
  }

  getWorkspaceCohensKappaSummary(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true,
    scope?: CohensKappaScope
  ): Observable<WorkspaceCohensKappaSummary> {
    const params = this.appendCohensKappaScopeParams(
      new HttpParams()
        .set('weightedMean', weightedMean.toString())
        .set('excludeTrainings', excludeTrainings.toString()),
      scope
    );
    return this.http
      .get<WorkspaceCohensKappaSummary>(
        `${this.serverUrl}admin/workspace/${workspaceId}/coding/cohens-kappa/workspace-summary`,
        { headers: this.authHeader, params }
      )
      .pipe(
        catchError(() => of({
          coderPairs: [],
          workspaceSummary: {
            totalDoubleCodedResponses: 0,
            totalCoderPairs: 0,
            averageKappa: null,
            variablesIncluded: 0,
            codersIncluded: 0,
            weightingMethod: 'weighted' as 'weighted' | 'unweighted'
          }
        })
        )
      );
  }
}
