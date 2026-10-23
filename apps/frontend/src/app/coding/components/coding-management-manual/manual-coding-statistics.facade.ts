import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Observable, Subject, Subscription,
  catchError,
  finalize, map,
  of,
  switchMap
} from 'rxjs';
import { CodingFreshnessSummaryDto } from '../../../../../../../api-dto/coding/coding-freshness.dto';
import type { ManualCodeAvailabilityWarningDto } from '../../../../../../../api-dto/coding/manual-code-availability.dto';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingJob } from '../../models/coding-job.model';
import { CodingJobBackendService, ManualCodingScopeSummary } from '../../services/coding-job-backend.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { DoubleCodedReviewApiService } from '../../services/double-coded-review-api.service';
import type { ManualCodingPlanningSnapshot, ManualCodingFreshnessJobSummary as ManualFreshnessJobSummary } from '../../services/manual-coding-planning-snapshot.model';
import { CaseCoverageOverview, CodingProgressOverview, TestPersonCodingService } from '../../services/test-person-coding.service';
import { buildManualFreshnessJobSummary, hasCodingIssuesForCompletedJob, isCodingJobReadyForApply } from './manual-coding-job-summary';

/** Statistics for one mounted manual-coding view. Each query replaces its predecessor. */
@Injectable()
export class ManualCodingStatisticsFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly codingJobBackendService = inject(CodingJobBackendService);
  private readonly statisticsService = inject(CodingStatisticsService);
  private readonly doubleCodedReviewApi = inject(DoubleCodedReviewApiService);
  private readonly requests = new Map<string, Subscription>();
  private readonly settledSubject = new Subject<void>();
  readonly settled$ = this.settledSubject.asObservable();
  private readonly failedSubject = new Subject<void>();
  readonly failed$ = this.failedSubject.asObservable();
  private readonly freshnessJobs = signal<ManualFreshnessJobSummary | null>(null);
  get manualFreshnessJobSummary(): ManualFreshnessJobSummary | null { return this.freshnessJobs(); }
  private readonly conflictCount = signal(0);
  get openDoubleCodingConflictCount(): number { return this.conflictCount(); }
  private readonly scopeLoadingState = signal(false);
  readonly isLoadingManualCodingScopeSummary = this.scopeLoadingState.asReadonly();
  private readonly isLoadingVariableCoverageState = signal(false);
  readonly isLoadingVariableCoverage = this.isLoadingVariableCoverageState.asReadonly();

  private readonly isLoadingCaseCoverageState = signal(false);
  readonly isLoadingCaseCoverage = this.isLoadingCaseCoverageState.asReadonly();

  private readonly isLoadingCodingProgressState = signal(false);
  readonly isLoadingCodingProgress = this.isLoadingCodingProgressState.asReadonly();

  private readonly isLoadingManualCodeAvailabilityState = signal(false);
  readonly isLoadingManualCodeAvailability = this.isLoadingManualCodeAvailabilityState.asReadonly();

  private readonly isLoadingCodingIncompleteVariablesState = signal(false);
  readonly isLoadingCodingIncompleteVariables = this.isLoadingCodingIncompleteVariablesState.asReadonly();

  private readonly isLoadingAppliedResultsOverviewState = signal(false);
  readonly isLoadingAppliedResultsOverview = this.isLoadingAppliedResultsOverviewState.asReadonly();

  private readonly isLoadingKappaSummaryState = signal(false);
  readonly isLoadingKappaSummary = this.isLoadingKappaSummaryState.asReadonly();

  private readonly codingProgressOverviewState = signal<CodingProgressOverview | null>(null);
  readonly codingProgressOverview = this.codingProgressOverviewState.asReadonly();

  private readonly variableCoverageOverviewState = signal<ManualCodingPlanningSnapshot['variableCoverageOverview']>(null);
  readonly variableCoverageOverview = this.variableCoverageOverviewState.asReadonly();

  private readonly caseCoverageOverviewState = signal<CaseCoverageOverview | null>(null);
  readonly caseCoverageOverview = this.caseCoverageOverviewState.asReadonly();

  private readonly workspaceKappaSummaryState = signal<{
    coderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      kappa: number | null;
      agreement: number;
      totalSharedResponses: number;
      validPairs: number;
      interpretation: string;
    }>;
    workspaceSummary: {
      totalDoubleCodedResponses: number;
      totalCoderPairs: number;
      averageKappa: number | null;
      variablesIncluded: number;
      codersIncluded: number;
    };
  } | null>(null);

  readonly workspaceKappaSummary = this.workspaceKappaSummaryState.asReadonly();

  private readonly codingIncompleteVariablesState = signal<{
    unitName: string;
    variableId: string;
    responseCount: number;
    availableCases?: number;
    uniqueCasesAfterAggregation?: number;
  }[]>([]);

  readonly codingIncompleteVariables = this.codingIncompleteVariablesState.asReadonly();

  private readonly manualCodingScopeSummaryState = signal<ManualCodingScopeSummary | null>(null);
  readonly manualCodingScopeSummary = this.manualCodingScopeSummaryState.asReadonly();

  private readonly manualCodeAvailabilityWarningsState = signal<ManualCodeAvailabilityWarningDto[]>([]);
  readonly manualCodeAvailabilityWarnings = this.manualCodeAvailabilityWarningsState.asReadonly();

  private readonly showAllManualCodeAvailabilityWarningsState = signal(false);
  readonly showAllManualCodeAvailabilityWarnings = this.showAllManualCodeAvailabilityWarningsState.asReadonly();

  private readonly statusDistributionState = signal<{
    [status: string]: number;
  }>({});

  readonly statusDistribution = this.statusDistributionState.asReadonly();

  private readonly statusDistributionV2State = signal<{
    [status: string]: number;
  }>({});

  readonly statusDistributionV2 = this.statusDistributionV2State.asReadonly();

  private readonly appliedResultsOverviewState = signal<ManualCodingPlanningSnapshot['appliedResultsOverview']>(null);
  readonly appliedResultsOverview = this.appliedResultsOverviewState.asReadonly();

  private readonly completedJobsReadyForApplyState = signal<CodingJob[]>([]);
  readonly completedJobsReadyForApply = this.completedJobsReadyForApplyState.asReadonly();

  private readonly completedJobsBlockedForReviewState = signal<CodingJob[]>([]);
  readonly completedJobsBlockedForReview = this.completedJobsBlockedForReviewState.asReadonly();

  private readonly isLoadingCompletedJobsReadyForApplyState = signal(false);
  readonly isLoadingCompletedJobsReadyForApply = this.isLoadingCompletedJobsReadyForApplyState.asReadonly();

  private readonly isLoadingManualFreshnessJobSummaryState = signal(false);
  readonly isLoadingManualFreshnessJobSummary = this.isLoadingManualFreshnessJobSummaryState.asReadonly();

  private readonly isLoadingDoubleCodingConflictSummaryState = signal(false);
  readonly isLoadingDoubleCodingConflictSummary = this.isLoadingDoubleCodingConflictSummaryState.asReadonly();

  private readonly codingFreshnessSummaryState = signal<CodingFreshnessSummaryDto | null>(null);
  readonly codingFreshnessSummary = this.codingFreshnessSummaryState.asReadonly();
  private readonly isLoadingCodingFreshnessState = signal(false);
  readonly isLoadingCodingFreshness = this.isLoadingCodingFreshnessState.asReadonly();
  private lastCodingFreshnessRefreshAt = 0;

  cancelFreshness(clearSummary = false): void {
    this.requests.get('freshness')?.unsubscribe();
    if (clearSummary) this.codingFreshnessSummaryState.set(null);
    this.isLoadingCodingFreshnessState.set(false);
  }

  toggleManualCodeAvailabilityWarnings(): void {
    this.showAllManualCodeAvailabilityWarningsState.update(value => !value);
  }

  restorePlanningSnapshot(snapshot: Partial<ManualCodingPlanningSnapshot>): void {
    if (snapshot.codingProgressOverview !== undefined) this.codingProgressOverviewState.set(snapshot.codingProgressOverview);
    if (snapshot.variableCoverageOverview !== undefined) this.variableCoverageOverviewState.set(snapshot.variableCoverageOverview);
    if (snapshot.caseCoverageOverview !== undefined) this.caseCoverageOverviewState.set(snapshot.caseCoverageOverview);
    if (snapshot.codingIncompleteVariables !== undefined) this.codingIncompleteVariablesState.set([...snapshot.codingIncompleteVariables]);
    if (snapshot.manualCodingScopeSummary !== undefined) this.manualCodingScopeSummaryState.set(snapshot.manualCodingScopeSummary);
    if (snapshot.appliedResultsOverview !== undefined) this.appliedResultsOverviewState.set(snapshot.appliedResultsOverview);
    if (snapshot.manualCodeAvailabilityWarnings !== undefined) this.setManualCodeAvailabilityWarnings([...snapshot.manualCodeAvailabilityWarnings]);
    if (snapshot.manualFreshnessJobSummary !== undefined) this.freshnessJobs.set(snapshot.manualFreshnessJobSummary);
    if (snapshot.openDoubleCodingConflictCount !== undefined) this.conflictCount.set(snapshot.openDoubleCodingConflictCount);
    if (snapshot.codingFreshnessSummary !== undefined) {
      this.codingFreshnessSummaryState.set(snapshot.codingFreshnessSummary);
      this.lastCodingFreshnessRefreshAt = snapshot.codingFreshnessSummary ? Date.now() : 0;
    }
  }

  loadCodingFreshness(force = false): void {
    if (!force && (this.isLoadingCodingFreshness() || (this.codingFreshnessSummary() && Date.now() - this.lastCodingFreshnessRefreshAt < 30000))) return;
    this.load('freshness', id => this.testPersonCodingService.getCodingFreshness(id), loading => this.isLoadingCodingFreshnessState.set(loading), summary => {
      this.codingFreshnessSummaryState.set(summary); this.lastCodingFreshnessRefreshAt = Date.now();
    }, () => undefined);
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.requests.forEach(request => request.unsubscribe());
      this.settledSubject.complete();
      this.failedSubject.complete();
    });
  }

  private load<T>(
    key: string,
    source: (workspaceId: number) => Observable<T>,
    loading: (value: boolean) => void,
    accept: (value: T) => void,
    fail: () => void,
    after: () => void = () => undefined
  ): void {
    const previous = this.requests.get(key);
    const requestSlot = new Subscription();
    this.requests.set(key, requestSlot);
    previous?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.destroyRef.destroyed) { loading(false); return; }
    loading(true);
    let received = false;
    const request = source(workspaceId).pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        if (this.requests.get(key) !== requestSlot) return;
        loading(false);
        if (this.destroyRef.destroyed || this.appService.selectedWorkspaceId !== workspaceId) return;
        if (received) after();
        this.settledSubject.next();
      })
    ).subscribe({
      next: value => {
        if (this.appService.selectedWorkspaceId !== workspaceId) return;
        received = true;
        accept(value);
      },
      error: () => {
        if (this.appService.selectedWorkspaceId !== workspaceId) return;
        received = true;
        fail();
        if (['progress', 'variables', 'cases', 'jobs', 'conflicts', 'incomplete', 'scope', 'availability', 'applied'].includes(key)) this.failedSubject.next();
      }
    });
    requestSlot.add(request);
  }

  loadCodingProgressOverview(): void {
    this.load('progress', id => this.testPersonCodingService.getCodingProgressOverview(id), value => this.isLoadingCodingProgressState.set(value), overview => {
      this.codingProgressOverviewState.set(overview);
      if (!overview) this.failedSubject.next();
    }, () => this.codingProgressOverviewState.set(null));
  }

  loadVariableCoverageOverview(): void {
    this.load('variables', id => this.testPersonCodingService.getVariableCoverageOverview(id), value => this.isLoadingVariableCoverageState.set(value), value => this.variableCoverageOverviewState.set(value), () => this.variableCoverageOverviewState.set(null));
  }

  loadCaseCoverageOverview(): void {
    this.load('cases', id => this.testPersonCodingService.getCaseCoverageOverview(id), value => this.isLoadingCaseCoverageState.set(value), value => this.caseCoverageOverviewState.set(value), () => this.caseCoverageOverviewState.set(null));
  }

  loadWorkspaceKappaSummary(): void {
    this.load('kappa', id => this.testPersonCodingService.getWorkspaceCohensKappaSummary(id), value => this.isLoadingKappaSummaryState.set(value), value => this.workspaceKappaSummaryState.set(value), () => this.workspaceKappaSummaryState.set(null));
  }

  loadManualFreshnessDecisionData(): void { this.loadManualFreshnessJobSummary(); }

  loadManualFreshnessJobSummary(): void {
    this.load('jobs', id => this.codingJobBackendService.getCodingJobs(id), value => this.isLoadingManualFreshnessJobSummaryState.set(value), response => {
      this.freshnessJobs.set(buildManualFreshnessJobSummary(response.data || []));
    }, () => { this.freshnessJobs.set(null); }, () => {
      if (this.shouldLoadOpenDoubleCodingConflictSummary()) this.loadOpenDoubleCodingConflictSummary();
      else { this.conflictCount.set(0); this.isLoadingDoubleCodingConflictSummaryState.set(false); }
    });
  }

  shouldLoadOpenDoubleCodingConflictSummary(): boolean {
    return !!this.manualFreshnessJobSummary && !this.manualFreshnessJobSummary.activeTrainingJobs &&
      !this.manualFreshnessJobSummary.openProductiveJobs;
  }

  loadOpenDoubleCodingConflictSummary(): void {
    this.load('conflicts', id => this.doubleCodedReviewApi.getDoubleCodedVariablesForReview(id, {
      page: 1, limit: 1, onlyConflicts: true, excludeTrainings: true, resolvedFilter: 'unresolved', agreementFilter: 'differ'
    }), value => this.isLoadingDoubleCodingConflictSummaryState.set(value), response => { this.conflictCount.set(response.total || 0); }, () => { this.conflictCount.set(0); });
  }

  loadCodingIncompleteVariables(): void {
    this.load('incomplete', id => this.codingJobBackendService.getCodingIncompleteVariables(id), value => this.isLoadingCodingIncompleteVariablesState.set(value), value => this.codingIncompleteVariablesState.set(value), () => this.codingIncompleteVariablesState.set([]), () => this.loadAppliedResultsOverview());
    this.load('scope', id => this.codingJobBackendService.getManualCodingScopeSummary(id), value => { this.scopeLoadingState.set(value); }, value => this.manualCodingScopeSummaryState.set(value), () => this.manualCodingScopeSummaryState.set(null));
    this.load('availability', id => this.codingJobBackendService.getManualCodeAvailabilityWarnings(id), value => this.isLoadingManualCodeAvailabilityState.set(value), value => this.setManualCodeAvailabilityWarnings(value.warnings || []), () => this.setManualCodeAvailabilityWarnings([]));
  }

  setManualCodeAvailabilityWarnings(warnings: ManualCodeAvailabilityWarningDto[]): void {
    this.manualCodeAvailabilityWarningsState.set(warnings);
    this.showAllManualCodeAvailabilityWarningsState.set(false);
  }

  private loadDistribution(version: 'v1' | 'v2'): void {
    const target = version === 'v1' ? this.statusDistributionState : this.statusDistributionV2State;
    this.load(`distribution-${version}`, id => this.statisticsService.getCodingStatistics(id, version), () => undefined, statistics => target.set({
      CODING_INCOMPLETE: statistics.statusCounts['8'] || 0,
      CODING_COMPLETE: statistics.statusCounts['5'] || 0,
      INVALID: statistics.statusCounts['7'] || 0,
      CODING_ERROR: statistics.statusCounts['9'] || 0,
      INTENDED_INCOMPLETE: statistics.statusCounts['12'] || 0
    }), () => target.set({
      CODING_INCOMPLETE: 0, CODING_COMPLETE: 0, INVALID: 0, CODING_ERROR: 0
    }), () => { if (version === 'v2') this.loadAppliedResultsOverview(); });
  }

  loadStatusDistribution(): void { this.loadDistribution('v1'); }
  loadStatusDistributionV2(): void { this.loadDistribution('v2'); }

  loadAppliedResultsOverview(): void {
    this.load('applied', id => this.testPersonCodingService.getAppliedResultsOverview(id), value => this.isLoadingAppliedResultsOverviewState.set(value), overview => {
      this.appliedResultsOverviewState.set(overview ? {
        ...overview,
        totalIncompleteVariables: this.codingIncompleteVariables().length,
        finalStatusBreakdown: {
          codingComplete: this.statusDistributionV2().CODING_COMPLETE || 0,
          invalid: this.statusDistributionV2().INVALID || 0,
          codingError: this.statusDistributionV2().CODING_ERROR || 0,
          other: 0
        }
      } : null);
      if (!overview) this.failedSubject.next();
    }, () => this.appliedResultsOverviewState.set(null));
  }

  acceptCompletedJobs(completed: CodingJob[]): void {
    this.completedJobsReadyForApplyState.set(completed);
    this.completedJobsBlockedForReviewState.set(completed.filter(job => job.hasIssues === true));
  }

  loadCompletedJobsReadyForApply(): void {
    this.load('completed-jobs', id => this.codingJobBackendService.getCodingJobs(id).pipe(
      switchMap(response => {
        const jobs = (response.data || []).filter(isCodingJobReadyForApply);
        if (!jobs.length) return of([]);
        return this.codingJobBackendService.getBulkCodingProgress(id, jobs.map(job => job.id)).pipe(
          map(progress => jobs.map(job => ({ ...job, hasIssues: hasCodingIssuesForCompletedJob(job, progress[job.id]) }))),
          catchError(() => of(jobs))
        );
      })
    ), value => this.isLoadingCompletedJobsReadyForApplyState.set(value), completed => {
      this.acceptCompletedJobs(completed);
    }, () => { this.acceptCompletedJobs([]); });
  }
}
