import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  catchError,
  defer,
  expand,
  filter,
  finalize,
  forkJoin,
  last,
  map,
  of,
  switchMap,
  takeUntil,
  tap,
  timer
} from 'rxjs';
import { CodingStatusRevisionDto } from '../../../../../../api-dto/coding/coding-status-revision.dto';
import { CodingFreshnessSummaryDto } from '../../../../../../api-dto/coding/coding-freshness.dto';
import type { ManualCodeAvailabilityWarningDto } from '../../../../../../api-dto/coding/manual-code-availability.dto';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { CodingJob } from '../models/coding-job.model';
import {
  ManualCodingScopeSummary,
  CodingJobBackendService
} from './coding-job-backend.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { DoubleCodedReviewApiService } from './double-coded-review-api.service';
import {
  AppliedResultsOverview,
  CaseCoverageOverview,
  CodingProgressOverview,
  TestPersonCodingService
} from './test-person-coding.service';
import {
  ManualCodingStatusSnapshot,
  ManualCodingSnapshotTarget,
  ManualCodingSnapshotDisplayParameters,
  PlanningStatusState
} from './coding-status-snapshot.model';
import { CodingStatusSnapshotService } from './coding-status-snapshot.service';
import { AppService } from '../../core/services/app.service';

export type ManualPlanningLoadState =
  'notLoaded' | 'loading' | 'loaded' | 'stale';

export interface ManualVariableCoverageOverview {
  totalVariables: number;
  coveredVariables: number;
  coveredByDraft: number;
  coveredByPendingReview: number;
  coveredByApproved: number;
  conflictedVariables: number;
  missingVariables: number;
  partiallyAbgedeckteVariablen?: number;
  fullyAbgedeckteVariablen?: number;
  coveragePercentage: number;
  variableCaseCounts: Array<{
    unitName: string;
    variableId: string;
    caseCount: number;
  }>;
  coverageByStatus: {
    draft: string[];
    pending_review: string[];
    approved: string[];
    conflicted: Array<{
      variableKey: string;
      conflictingDefinitions: Array<{
        id: number;
        name?: string;
        status: string;
      }>;
    }>;
  };
  statusTotalVariables?: number;
  coveredSourceVariableCount?: number;
  coveredSourceResponseCount?: number;
}

export interface ManualPlanningIncompleteVariable {
  unitName: string;
  variableId: string;
  responseCount: number;
  availableCases?: number;
  uniqueCasesAfterAggregation?: number;
}

export interface ManualFreshnessJobSummary {
  activeTrainingJobs: number;
  openProductiveJobs: number;
  completedProductiveJobs: number;
  staleSourceJobs: number;
}

export type ManualAppliedResultsOverview = AppliedResultsOverview & {
  totalIncompleteVariables: number;
  finalStatusBreakdown: {
    codingComplete: number;
    invalid: number;
    codingError: number;
    other: number;
  };
};

export interface ManualPlanningStatusData {
  responseAnalysis: ResponseAnalysisDto;
  variableCoverageOverview: ManualVariableCoverageOverview;
  caseCoverageOverview: CaseCoverageOverview;
  codingProgressOverview: CodingProgressOverview | null;
  codingIncompleteVariables: ManualPlanningIncompleteVariable[];
  manualCodingScopeSummary: ManualCodingScopeSummary;
  manualCodeAvailabilityWarnings: ManualCodeAvailabilityWarningDto[];
  appliedResultsOverview: ManualAppliedResultsOverview | null;
  codingFreshnessSummary: CodingFreshnessSummaryDto;
  manualFreshnessJobSummary: ManualFreshnessJobSummary | null;
  openDoubleCodingConflictCount: number;
}

export interface ManualPlanningStatusViewState {
  loadState: ManualPlanningLoadState;
  data: ManualPlanningStatusData | null;
  restoredSnapshot: ManualCodingStatusSnapshot | null;
  presentation: ManualPlanningStatusPresentation | null;
}

export interface ManualPlanningStatusPresentation {
  planningStatus: PlanningStatusState;
  displayParameters: ManualCodingSnapshotDisplayParameters;
  nextTarget: ManualCodingSnapshotTarget;
}

export interface ManualPlanningLoadOptions {
  workspaceId: number;
  userId: number;
  forceRefresh: boolean;
  aggregationThreshold: number;
  emptyPage: number;
  emptyLimit: number;
  duplicatePage: number;
  duplicateLimit: number;
  currentResponseAnalysis: ResponseAnalysisDto | null;
  loadResponseAnalysis: boolean;
  canOpenCompletion: boolean;
}

interface PlanningValidationError extends Error {
  kind: 'revision-changed' | 'invalid-revision';
}

interface PlanningLoadResult {
  startRevision: CodingStatusRevisionDto;
  endRevision: CodingStatusRevisionDto;
  data: ManualPlanningStatusData;
}

const MAXIMUM_REVISION_RETRIES = 1;
const RESPONSE_ANALYSIS_POLL_INTERVAL_MS = 5000;

@Injectable()
export class ManualPlanningStatusFacade implements OnDestroy {
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly codingJobBackendService = inject(CodingJobBackendService);
  private readonly doubleCodedReviewApi = inject(DoubleCodedReviewApiService);
  private readonly statisticsService = inject(CodingStatisticsService);
  private readonly snapshotService = inject(CodingStatusSnapshotService);
  private readonly destroy$ = new Subject<void>();
  private readonly loadRequests$ = new Subject<ManualPlanningLoadOptions | null>();
  private restoreGeneration = 0;
  private readonly viewStateSubject =
    new BehaviorSubject<ManualPlanningStatusViewState>({
      loadState: 'notLoaded',
      data: null,
      restoredSnapshot: null,
      presentation: null
    });

  readonly viewState$ = this.viewStateSubject.asObservable();

  constructor() {
    this.loadRequests$
      .pipe(
        switchMap(options => (options ? this.runLoad(options) : EMPTY)),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  get viewState(): ManualPlanningStatusViewState {
    return this.viewStateSubject.value;
  }

  restore(
    userId: number,
    workspaceId: number,
    canOpenCompletion: boolean
  ): Observable<void> {
    const restoreGeneration = this.restoreGeneration + 1;
    this.restoreGeneration = restoreGeneration;
    return this.snapshotService.restoreManual(userId, workspaceId).pipe(
      tap(snapshot => {
        const current = this.viewStateSubject.value;
        if (restoreGeneration !== this.restoreGeneration ||
            current.loadState === 'loading' || current.loadState === 'loaded' ||
            !this.isCurrentContext(userId, workspaceId)) {
          return;
        }
        this.viewStateSubject.next({
          ...current,
          restoredSnapshot: snapshot,
          presentation: snapshot ?
            this.deriveRestoredPresentation(snapshot, canOpenCompletion) :
            null
        });
      }),
      map(() => undefined)
    );
  }

  load(options: ManualPlanningLoadOptions): void {
    if (this.viewStateSubject.value.loadState === 'loading') {
      return;
    }
    this.restoreGeneration += 1;
    this.viewStateSubject.next({
      loadState: 'loading',
      data: null,
      restoredSnapshot: null,
      presentation: null
    });
    this.loadRequests$.next(options);
  }

  invalidate(): void {
    this.restoreGeneration += 1;
    this.loadRequests$.next(null);
    this.viewStateSubject.next({
      loadState: 'stale',
      data: null,
      restoredSnapshot: null,
      presentation: null
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.loadRequests$.complete();
    this.viewStateSubject.complete();
  }

  private runLoad(
    options: ManualPlanningLoadOptions,
    revisionRetryCount = 0
  ): Observable<void> {
    return defer(() => {
      if (options.forceRefresh || revisionRetryCount > 0) {
        this.testPersonCodingService.invalidateCodingStatusCache(
          options.workspaceId
        );
      }
      return this.loadAndValidate(options);
    }).pipe(
      tap(result => this.completeLoad(options, result)),
      map(() => undefined),
      catchError((error: unknown) => {
        if (this.isRevisionChangedError(error) &&
            revisionRetryCount < MAXIMUM_REVISION_RETRIES) {
          return this.runLoad(options, revisionRetryCount + 1);
        }
        if (this.isPlanningValidationError(error)) {
          this.testPersonCodingService.invalidateCodingStatusCache(
            options.workspaceId
          );
        }
        this.viewStateSubject.next({
          loadState: 'stale',
          data: null,
          restoredSnapshot: null,
          presentation: null
        });
        return EMPTY;
      })
    );
  }

  private loadAndValidate(
    options: ManualPlanningLoadOptions
  ): Observable<PlanningLoadResult> {
    return this.snapshotService
      .getRevision(options.workspaceId, { fresh: true })
      .pipe(
        switchMap(startRevision => {
          this.assertStableRevision(startRevision, options.workspaceId);
          return this.loadPlanningData(options).pipe(
            switchMap(data => this.snapshotService.getRevision(
              options.workspaceId,
              { fresh: true }
            ).pipe(
              map(endRevision => ({
                startRevision,
                endRevision,
                data
              }))
            ))
          );
        }),
        tap(({ startRevision, endRevision, data }) => {
          this.assertMatchingRevisions(
            startRevision,
            endRevision,
            data.codingFreshnessSummary,
            options.workspaceId
          );
        })
      );
  }

  private loadPlanningData(
    options: ManualPlanningLoadOptions
  ): Observable<ManualPlanningStatusData> {
    const workspaceId = options.workspaceId;
    return forkJoin({
      responseAnalysis: this.getResponseAnalysis(options),
      variableCoverageOverview: this.testPersonCodingService
        .getVariableCoverageOverview(workspaceId, { failOnError: true }),
      caseCoverageOverview: this.testPersonCodingService
        .getCaseCoverageOverview(workspaceId, { failOnError: true }),
      codingProgressOverview: this.testPersonCodingService
        .getCodingProgressOverview(workspaceId, { failOnError: true }),
      codingIncompleteVariables: this.codingJobBackendService
        .getCodingIncompleteVariables(workspaceId),
      manualCodingScopeSummary: this.codingJobBackendService
        .getManualCodingScopeSummary(workspaceId),
      manualCodeAvailability: this.codingJobBackendService
        .getManualCodeAvailabilityWarnings(workspaceId),
      appliedAndStatistics: forkJoin({
        applied: this.testPersonCodingService
          .getAppliedResultsOverview(workspaceId, { failOnError: true }),
        statistics: this.statisticsService.getCodingStatistics(
          workspaceId,
          'v2',
          { failOnError: true }
        )
      }),
      codingFreshnessSummary: this.testPersonCodingService
        .getCodingFreshness(workspaceId, { failOnError: true }),
      jobs: this.loadJobsAndConflicts(workspaceId)
    }).pipe(
      map(result => {
        const incompleteVariables = result.codingIncompleteVariables;
        const statistics = result.appliedAndStatistics.statistics.statusCounts;
        const applied = result.appliedAndStatistics.applied;
        return {
          responseAnalysis: result.responseAnalysis,
          variableCoverageOverview: result.variableCoverageOverview,
          caseCoverageOverview: result.caseCoverageOverview,
          codingProgressOverview: result.codingProgressOverview,
          codingIncompleteVariables: incompleteVariables,
          manualCodingScopeSummary: result.manualCodingScopeSummary,
          manualCodeAvailabilityWarnings:
            result.manualCodeAvailability.warnings || [],
          appliedResultsOverview: applied ? {
            ...applied,
            totalIncompleteVariables: incompleteVariables.length,
            finalStatusBreakdown: {
              codingComplete: statistics['5'] || 0,
              invalid: statistics['7'] || 0,
              codingError: statistics['9'] || 0,
              other: 0
            }
          } : null,
          codingFreshnessSummary: result.codingFreshnessSummary,
          manualFreshnessJobSummary: result.jobs.summary,
          openDoubleCodingConflictCount: result.jobs.openConflictCount
        };
      })
    );
  }

  private getResponseAnalysis(
    options: ManualPlanningLoadOptions
  ): Observable<ResponseAnalysisDto> {
    if (!options.loadResponseAnalysis && options.currentResponseAnalysis) {
      return of(options.currentResponseAnalysis);
    }

    const request = () => this.testPersonCodingService.getResponseAnalysis(
      options.workspaceId,
      options.aggregationThreshold,
      options.emptyPage,
      options.emptyLimit,
      options.duplicatePage,
      options.duplicateLimit
    );

    return defer(() => {
      let needsGuardHandoff = false;
      return request().pipe(
        tap(analysis => {
          needsGuardHandoff = analysis.isCalculating === true;
          this.testPersonCodingService.setResponseAnalysisGuardRunning(
            options.workspaceId,
            needsGuardHandoff
          );
        }),
        expand(analysis => (analysis.isCalculating ?
          timer(RESPONSE_ANALYSIS_POLL_INTERVAL_MS).pipe(switchMap(request)) :
          EMPTY)),
        filter(analysis => analysis.isCalculating !== true),
        last(),
        tap(() => {
          needsGuardHandoff = false;
        }),
        finalize(() => {
          if (needsGuardHandoff) {
            this.testPersonCodingService.trackResponseAnalysisGuardUntilComplete(
              options.workspaceId,
              options.aggregationThreshold
            );
          }
        })
      );
    });
  }

  private loadJobsAndConflicts(workspaceId: number): Observable<{
    summary: ManualFreshnessJobSummary;
    openConflictCount: number;
  }> {
    return this.codingJobBackendService.getCodingJobs(workspaceId).pipe(
      map(response => this.buildJobSummary(response.data || [])),
      switchMap(summary => {
        if (summary.activeTrainingJobs > 0 || summary.openProductiveJobs > 0) {
          return of({ summary, openConflictCount: 0 });
        }
        return this.doubleCodedReviewApi.getDoubleCodedVariablesForReview(
          workspaceId,
          {
            page: 1,
            limit: 1,
            onlyConflicts: true,
            excludeTrainings: true,
            resolvedFilter: 'unresolved',
            agreementFilter: 'differ'
          }
        ).pipe(map(response => ({
          summary,
          openConflictCount: response.total || 0
        })));
      })
    );
  }

  private completeLoad(
    options: ManualPlanningLoadOptions,
    result: PlanningLoadResult
  ): void {
    if (!this.isCurrentContext(options.userId, options.workspaceId)) {
      this.viewStateSubject.next({
        loadState: 'stale',
        data: null,
        restoredSnapshot: null,
        presentation: null
      });
      return;
    }
    const presentation = this.derivePresentation(
      result.data,
      options.canOpenCompletion
    );
    const snapshot = this.buildSnapshot(options, result, presentation);
    this.snapshotService.saveManual(snapshot);
    this.viewStateSubject.next({
      loadState: 'loaded',
      data: result.data,
      restoredSnapshot: null,
      presentation
    });
  }

  derivePresentation(
    data: ManualPlanningStatusData,
    canOpenCompletion: boolean
  ): ManualPlanningStatusPresentation {
    const displayParameters = this.getDisplayParameters(data);
    const planningStatus = this.getPlanningStatus(data);
    return {
      planningStatus,
      displayParameters,
      nextTarget: this.deriveNextTarget(
        planningStatus,
        displayParameters,
        canOpenCompletion
      )
    };
  }

  deriveRestoredPresentation(
    snapshot: ManualCodingStatusSnapshot,
    canOpenCompletion: boolean
  ): ManualPlanningStatusPresentation {
    return {
      planningStatus: snapshot.planningStatus,
      displayParameters: snapshot.displayParameters,
      nextTarget: this.deriveNextTarget(
        snapshot.planningStatus,
        snapshot.displayParameters,
        canOpenCompletion
      )
    };
  }

  deriveNextTarget(
    planningStatus: PlanningStatusState,
    displayParameters: ManualCodingSnapshotDisplayParameters,
    canOpenCompletion: boolean
  ): ManualCodingSnapshotTarget {
    return this.getNextTarget(
      planningStatus,
      displayParameters,
      canOpenCompletion
    );
  }

  private buildSnapshot(
    options: ManualPlanningLoadOptions,
    result: PlanningLoadResult,
    presentation: ManualPlanningStatusPresentation
  ): Omit<ManualCodingStatusSnapshot, 'schemaVersion' | 'checkedAt' | 'surface'> {
    return {
      userId: options.userId,
      workspaceId: options.workspaceId,
      revision: result.endRevision.revision,
      statusRevision: result.endRevision.statusRevision,
      planningStatus: presentation.planningStatus,
      displayParameters: presentation.displayParameters,
      freshness: result.data.codingFreshnessSummary,
      nextTarget: presentation.nextTarget,
      fullyChecked: true
    };
  }

  private getPlanningStatus(data: ManualPlanningStatusData): PlanningStatusState {
    if (this.hasPreparationRefreshTarget(data)) return 'preparation-required';
    if (data.manualCodeAvailabilityWarnings.length > 0 ||
        data.variableCoverageOverview.conflictedVariables > 0) return 'warning';
    if (data.variableCoverageOverview.missingVariables > 0 ||
        data.caseCoverageOverview.effectiveUnassignedCases > 0) {
      return 'planning-incomplete';
    }

    const summary = data.manualFreshnessJobSummary;
    if ((summary?.activeTrainingJobs ?? 0) > 0) return 'training-ready';
    if (data.codingProgressOverview &&
        (summary ? summary.openProductiveJobs > 0 :
          this.hasOpenCodingCases(data))) {
      return 'execution-ready';
    }
    if (data.openDoubleCodingConflictCount > 0) {
      return 'double-coding-review-ready';
    }
    if ((summary?.staleSourceJobs ?? 0) > 0) return 'stale-source-review';
    if (this.isCompletionComplete(data)) return 'complete';
    if (data.codingProgressOverview && data.appliedResultsOverview &&
        (summary ? summary.completedProductiveJobs > 0 :
          this.hasCompletionReadyProgress(data))) return 'completion-ready';
    if (!data.codingProgressOverview) return 'progress-unavailable';
    return 'planning-ready';
  }

  private hasPreparationRefreshTarget(data: ManualPlanningStatusData): boolean {
    const analysis = data.responseAnalysis;
    const referenceRawCases = data.codingProgressOverview?.responseAnalysisRawCases ??
      data.caseCoverageOverview.responseAnalysisRawCases ??
      data.appliedResultsOverview?.responseAnalysisRawCases ??
      (data.manualCodingScopeSummary.manualResponseCount +
       data.manualCodingScopeSummary.coveredSourceResponseCount);
    const analysisOutdated = !analysis.isCalculating &&
      referenceRawCases > 0 &&
      analysis.aggregationSummary.rawCases !== referenceRawCases;
    const hasPreparationWarnings = analysis.emptyResponses.totalUncoded > 0 ||
      (!analysis.aggregationSummary.aggregationActive &&
       analysis.duplicateValues.total > 0);
    return hasPreparationWarnings || analysisOutdated;
  }

  private isCompletionComplete(data: ManualPlanningStatusData): boolean {
    const applied = data.appliedResultsOverview;
    const hasScope = this.hasManualCodingProgressScope(data);
    const openCases = this.getOpenCodingCases(data);
    return hasScope && (applied?.completionPercentage ?? 0) >= 100 &&
      openCases === 0;
  }

  private hasCompletionReadyProgress(data: ManualPlanningStatusData): boolean {
    return this.hasManualCodingProgressScope(data) &&
      !!data.codingProgressOverview &&
      !!data.appliedResultsOverview &&
      this.getOpenCodingCases(data) === 0;
  }

  private hasManualCodingProgressScope(data: ManualPlanningStatusData): boolean {
    const progress = data.codingProgressOverview;
    const applied = data.appliedResultsOverview;
    return (progress?.totalCasesToCode ?? 0) > 0 ||
      (progress?.rawTotalCasesToCode ?? 0) > 0 ||
      (applied?.totalIncompleteResponses ?? 0) > 0 ||
      (applied?.rawTotalIncompleteResponses ?? 0) > 0 ||
      (applied?.appliedResponses ?? 0) > 0 ||
      (applied?.remainingResponses ?? 0) > 0;
  }

  private getOpenCodingCases(data: ManualPlanningStatusData): number {
    const progress = data.codingProgressOverview;
    return progress ?
      Math.max(0, progress.totalCasesToCode - progress.completedCases) :
      data.appliedResultsOverview?.remainingResponses || 0;
  }

  private hasOpenCodingCases(data: ManualPlanningStatusData): boolean {
    return this.getOpenCodingCases(data) > 0;
  }

  private getDisplayParameters(
    data: ManualPlanningStatusData
  ): ManualCodingSnapshotDisplayParameters {
    return {
      variableConflicts: data.variableCoverageOverview.conflictedVariables || 0,
      missingVariables: data.variableCoverageOverview.missingVariables || 0,
      unassignedCases: data.caseCoverageOverview.effectiveUnassignedCases || 0,
      activeTrainingJobs:
        data.manualFreshnessJobSummary?.activeTrainingJobs ?? 0,
      staleSourceJobs: data.manualFreshnessJobSummary?.staleSourceJobs ?? 0,
      openDoubleCodingConflicts: data.openDoubleCodingConflictCount,
      manualCodeAvailabilityWarnings:
        data.manualCodeAvailabilityWarnings.length
    };
  }

  private getNextTarget(
    status: PlanningStatusState,
    display: ManualCodingSnapshotDisplayParameters,
    canOpenCompletion: boolean
  ): ManualCodingSnapshotTarget {
    if (display.manualCodeAvailabilityWarnings > 0 &&
        display.variableConflicts === 0) {
      return {
        tab: 'planning',
        sectionId: 'manual-variable-coverage',
        action: 'navigate'
      };
    }
    switch (status) {
      case 'preparation-required':
        return { tab: 'preparation', sectionId: 'manual-preparation', action: 'navigate' };
      case 'warning':
        return {
          tab: 'planning',
          sectionId: display.variableConflicts > 0 ?
            'manual-planning' : 'manual-variable-coverage',
          action: 'navigate'
        };
      case 'training-ready':
        return { tab: 'training', sectionId: 'manual-support', action: 'navigate' };
      case 'execution-ready':
      case 'stale-source-review':
        return { tab: 'execution', sectionId: 'manual-execution', action: 'navigate' };
      case 'double-coding-review-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'double-coding-review'
        };
      case 'completion-ready':
      case 'complete':
        return {
          tab: canOpenCompletion ? 'completion' : 'execution',
          sectionId: canOpenCompletion ? 'manual-completion' : 'manual-execution',
          action: 'navigate'
        };
      default:
        return { tab: 'planning', sectionId: 'manual-planning', action: 'navigate' };
    }
  }

  private buildJobSummary(jobs: CodingJob[]): ManualFreshnessJobSummary {
    return jobs.reduce<ManualFreshnessJobSummary>((summary, job) => {
      if (job.freshnessStatus === 'stale_source') summary.staleSourceJobs += 1;
      const training = !!job.training?.id || !!job.training_id;
      const active = !['completed', 'review', 'results_applied'].includes(job.status) &&
        (job.status === 'open' || (job.openUnits ?? 0) > 0 ||
         (job.totalUnits ?? 0) > 0);
      if (training) {
        if (active) summary.activeTrainingJobs += 1;
        return summary;
      }
      if (active) {
        summary.openProductiveJobs += 1;
        return summary;
      }
      const totalUnits = job.totalUnits ?? 0;
      const completed = job.status !== 'results_applied' &&
        (['completed', 'review'].includes(job.status) ||
         (totalUnits > 0 && (job.openUnits ?? 0) === 0 &&
          (job.codedUnits ?? 0) >= totalUnits));
      if (completed && job.freshnessStatus !== 'stale_source') {
        summary.completedProductiveJobs += 1;
      }
      return summary;
    }, {
      activeTrainingJobs: 0,
      openProductiveJobs: 0,
      completedProductiveJobs: 0,
      staleSourceJobs: 0
    });
  }

  private assertStableRevision(
    revision: CodingStatusRevisionDto,
    workspaceId: number
  ): void {
    if (revision.workspaceId !== workspaceId || !revision.stable) {
      throw Object.assign(
        new Error('Unstable planning status revision'),
        { kind: 'invalid-revision' as const }
      );
    }
  }

  private assertMatchingRevisions(
    start: CodingStatusRevisionDto,
    end: CodingStatusRevisionDto,
    freshness: CodingFreshnessSummaryDto,
    workspaceId: number
  ): void {
    this.assertStableRevision(end, workspaceId);
    if (start.workspaceId !== end.workspaceId ||
        start.revision !== end.revision ||
        start.statusRevision !== end.statusRevision) {
      throw Object.assign(
        new Error('Planning status revision changed while loading'),
        { kind: 'revision-changed' as const }
      );
    }
    if (freshness.currentRevision !== end.revision) {
      throw Object.assign(
        new Error('Freshness revision does not match planning revision'),
        { kind: 'invalid-revision' as const }
      );
    }
  }

  private isPlanningValidationError(
    error: unknown
  ): error is PlanningValidationError {
    return error instanceof Error &&
      ['revision-changed', 'invalid-revision'].includes(
        (error as Partial<PlanningValidationError>).kind ?? ''
      );
  }

  private isRevisionChangedError(
    error: unknown
  ): error is PlanningValidationError & { kind: 'revision-changed' } {
    return this.isPlanningValidationError(error) &&
      error.kind === 'revision-changed';
  }

  private isCurrentContext(userId: number, workspaceId: number): boolean {
    return this.appService.authData.userId === userId &&
      this.appService.selectedWorkspaceId === workspaceId;
  }
}
