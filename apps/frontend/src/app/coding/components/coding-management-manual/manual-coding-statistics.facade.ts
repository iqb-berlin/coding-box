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
  set manualFreshnessJobSummary(value: ManualFreshnessJobSummary | null) { this.freshnessJobs.set(value); }
  private readonly conflictCount = signal(0);
  get openDoubleCodingConflictCount(): number { return this.conflictCount(); }
  set openDoubleCodingConflictCount(value: number) { this.conflictCount.set(value); }
  isLoadingManualCodingScopeSummary = false;
  readonly isLoadingVariableCoverage = signal(false);

  readonly isLoadingCaseCoverage = signal(false);

  readonly isLoadingCodingProgress = signal(false);

  readonly isLoadingManualCodeAvailability = signal(false);

  readonly isLoadingCodingIncompleteVariables = signal(false);

  readonly isLoadingAppliedResultsOverview = signal(false);

  readonly isLoadingKappaSummary = signal(false);

  readonly codingProgressOverview = signal<CodingProgressOverview | null>(null);

  readonly variableCoverageOverview = signal<ManualCodingPlanningSnapshot['variableCoverageOverview']>(null);

  readonly caseCoverageOverview = signal<CaseCoverageOverview | null>(null);

  readonly workspaceKappaSummary = signal<{
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

  readonly codingIncompleteVariables = signal<{
    unitName: string;
    variableId: string;
    responseCount: number;
    availableCases?: number;
    uniqueCasesAfterAggregation?: number;
  }[]>([]);

  readonly manualCodingScopeSummary = signal<ManualCodingScopeSummary | null>(null);

  readonly manualCodeAvailabilityWarnings = signal<ManualCodeAvailabilityWarningDto[]>([]);

  readonly showAllManualCodeAvailabilityWarnings = signal(false);

  readonly statusDistribution = signal<{
    [status: string]: number;
  }>({});

  readonly statusDistributionV2 = signal<{
    [status: string]: number;
  }>({});

  readonly appliedResultsOverview = signal<ManualCodingPlanningSnapshot['appliedResultsOverview']>(null);

  readonly completedJobsReadyForApply = signal<CodingJob[]>([]);

  readonly completedJobsBlockedForReview = signal<CodingJob[]>([]);

  readonly isLoadingCompletedJobsReadyForApply = signal(false);

  readonly isLoadingManualFreshnessJobSummary = signal(false);

  readonly isLoadingDoubleCodingConflictSummary = signal(false);

  readonly codingFreshnessSummary = signal<CodingFreshnessSummaryDto | null>(null);
  readonly isLoadingCodingFreshness = signal(false);
  lastCodingFreshnessRefreshAt = 0;

  cancelFreshness(): void { this.requests.get('freshness')?.unsubscribe(); }

  loadCodingFreshness(force = false): void {
    if (!force && (this.isLoadingCodingFreshness() || (this.codingFreshnessSummary() && Date.now() - this.lastCodingFreshnessRefreshAt < 30000))) return;
    this.load('freshness', id => this.testPersonCodingService.getCodingFreshness(id), loading => this.isLoadingCodingFreshness.set(loading), summary => {
      this.codingFreshnessSummary.set(summary); this.lastCodingFreshnessRefreshAt = Date.now();
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
    this.load('progress', id => this.testPersonCodingService.getCodingProgressOverview(id), value => this.isLoadingCodingProgress.set(value), overview => {
      this.codingProgressOverview.set(overview);
      if (!overview) this.failedSubject.next();
    }, () => this.codingProgressOverview.set(null));
  }

  loadVariableCoverageOverview(): void {
    this.load('variables', id => this.testPersonCodingService.getVariableCoverageOverview(id), value => this.isLoadingVariableCoverage.set(value), value => this.variableCoverageOverview.set(value), () => this.variableCoverageOverview.set(null));
  }

  loadCaseCoverageOverview(): void {
    this.load('cases', id => this.testPersonCodingService.getCaseCoverageOverview(id), value => this.isLoadingCaseCoverage.set(value), value => this.caseCoverageOverview.set(value), () => this.caseCoverageOverview.set(null));
  }

  loadWorkspaceKappaSummary(): void {
    this.load('kappa', id => this.testPersonCodingService.getWorkspaceCohensKappaSummary(id), value => this.isLoadingKappaSummary.set(value), value => this.workspaceKappaSummary.set(value), () => this.workspaceKappaSummary.set(null));
  }

  loadManualFreshnessDecisionData(): void { this.loadManualFreshnessJobSummary(); }

  loadManualFreshnessJobSummary(): void {
    this.load('jobs', id => this.codingJobBackendService.getCodingJobs(id), value => this.isLoadingManualFreshnessJobSummary.set(value), response => {
      this.manualFreshnessJobSummary = buildManualFreshnessJobSummary(response.data || []);
    }, () => { this.manualFreshnessJobSummary = null; }, () => {
      if (this.shouldLoadOpenDoubleCodingConflictSummary()) this.loadOpenDoubleCodingConflictSummary();
      else { this.openDoubleCodingConflictCount = 0; this.isLoadingDoubleCodingConflictSummary.set(false); }
    });
  }

  shouldLoadOpenDoubleCodingConflictSummary(): boolean {
    return !!this.manualFreshnessJobSummary && !this.manualFreshnessJobSummary.activeTrainingJobs &&
      !this.manualFreshnessJobSummary.openProductiveJobs;
  }

  loadOpenDoubleCodingConflictSummary(): void {
    this.load('conflicts', id => this.doubleCodedReviewApi.getDoubleCodedVariablesForReview(id, {
      page: 1, limit: 1, onlyConflicts: true, excludeTrainings: true, resolvedFilter: 'unresolved', agreementFilter: 'differ'
    }), value => this.isLoadingDoubleCodingConflictSummary.set(value), response => { this.openDoubleCodingConflictCount = response.total || 0; }, () => { this.openDoubleCodingConflictCount = 0; });
  }

  loadCodingIncompleteVariables(): void {
    this.load('incomplete', id => this.codingJobBackendService.getCodingIncompleteVariables(id), value => this.isLoadingCodingIncompleteVariables.set(value), value => this.codingIncompleteVariables.set(value), () => this.codingIncompleteVariables.set([]), () => this.loadAppliedResultsOverview());
    this.load('scope', id => this.codingJobBackendService.getManualCodingScopeSummary(id), value => { this.isLoadingManualCodingScopeSummary = value; }, value => this.manualCodingScopeSummary.set(value), () => this.manualCodingScopeSummary.set(null));
    this.load('availability', id => this.codingJobBackendService.getManualCodeAvailabilityWarnings(id), value => this.isLoadingManualCodeAvailability.set(value), value => this.setManualCodeAvailabilityWarnings(value.warnings || []), () => this.setManualCodeAvailabilityWarnings([]));
  }

  setManualCodeAvailabilityWarnings(warnings: ManualCodeAvailabilityWarningDto[]): void {
    this.manualCodeAvailabilityWarnings.set(warnings);
    this.showAllManualCodeAvailabilityWarnings.set(false);
  }

  private loadDistribution(version: 'v1' | 'v2'): void {
    const target = version === 'v1' ? this.statusDistribution : this.statusDistributionV2;
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
    this.load('applied', id => this.testPersonCodingService.getAppliedResultsOverview(id), value => this.isLoadingAppliedResultsOverview.set(value), overview => {
      this.appliedResultsOverview.set(overview ? {
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
    }, () => this.appliedResultsOverview.set(null));
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
    ), value => this.isLoadingCompletedJobsReadyForApply.set(value), completed => {
      this.completedJobsReadyForApply.set(completed);
      this.completedJobsBlockedForReview.set(completed.filter(job => job.hasIssues === true));
    }, () => { this.completedJobsReadyForApply.set([]); this.completedJobsBlockedForReview.set([]); });
  }
}
