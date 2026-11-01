import {
  DestroyRef, Injectable, WritableSignal, computed, inject, signal
} from '@angular/core';
import {
  Observable, Subject, Subscription, finalize, takeUntil
} from 'rxjs';
import { AppService } from '../../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../../shared/utils/workspace-request.operator';
import {
  getSecondAutocodingFreshnessWarnings, isCodingFreshnessOpenWarning, isSecondAutocodingWaitingForManualCoding
} from '../../../../shared/utils/coding-freshness-text.util';
import { AppliedResultsOverview, TestPersonCodingService } from '../../../services/test-person-coding.service';
import { CodingBackgroundJobsService } from '../../../services/coding-background-jobs.service';
import {
  CodingFreshnessScopeDto, CodingFreshnessSummaryDto
} from '../../../../../../../../api-dto/coding/coding-freshness.dto';
import { AutocodingReadinessDto } from '../../../../../../../../api-dto/coding/autocoding-readiness.dto';

type RequestSlot = 'freshness' | 'scope' | 'applied' | 'readiness';

/** View-local status data; scheduling statistics/table refreshes stays with the view coordinator. */
@Injectable()
export class CodingStatusDataFacade {
  readonly codingFreshnessSummary = signal<CodingFreshnessSummaryDto | null>(null);
  readonly codingFreshnessScope = signal<CodingFreshnessScopeDto | null>(null);
  readonly isLoadingCodingFreshness = signal(false);
  readonly autocodingReadiness = signal<AutocodingReadinessDto | null>(null);
  readonly isLoadingAutocodingReadiness = signal(false);
  readonly autocodingReadinessLoadFailed = signal(false);
  readonly manualAppliedResultsOverview = signal<AppliedResultsOverview | null>(null);
  readonly isLoadingManualAppliedResultsOverview = signal(false);
  readonly manualAppliedResultsOverviewLoadFailed = signal(false);
  readonly hasLoadedFullCodingStatusOverview = signal(false);

  readonly allWarnings = computed(() => (this.codingFreshnessSummary()?.items || []).filter(isCodingFreshnessOpenWarning));
  readonly secondAutocodingWarnings = computed(() => getSecondAutocodingFreshnessWarnings(this.allWarnings()));
  readonly isSecondAutocodingWaiting = computed(() => isSecondAutocodingWaitingForManualCoding(
    this.allWarnings(), this.manualAppliedResultsOverview(), this.manualAppliedResultsOverviewLoadFailed()
  ));

  readonly warnings = computed(() => this.allWarnings().filter(item => !(item.version === 'v3' && this.isSecondAutocodingWaiting())));
  readonly shouldShowSecondAutocodingWaiting = computed(() => this.isSecondAutocodingWaiting() && this.warnings().length === 0);
  readonly hasWarnings = computed(() => this.warnings().length > 0 || this.shouldShowSecondAutocodingWaiting());
  readonly chipWarnings = computed(() => {
    if (this.warnings().length > 0) return this.warnings();
    return this.shouldShowSecondAutocodingWaiting() ? this.secondAutocodingWarnings() : [];
  });

  private readonly app = inject(AppService);
  private readonly backend = inject(TestPersonCodingService);
  private readonly jobs = inject(CodingBackgroundJobsService);
  private readonly deferredRefresh = new Subject<boolean>();
  private readonly destroyed = new Subject<void>();
  private readonly requests = new Map<RequestSlot, Subscription>();
  private disposed = false;

  readonly deferredRefresh$ = this.deferredRefresh.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  loadCodingFreshness(loadScopeOnWarnings = true): void {
    const workspaceId = this.workspace(false);
    if (!workspaceId) return;
    this.requests.get('scope')?.unsubscribe();
    this.request('freshness', workspaceId, this.backend.getCodingFreshness(workspaceId), summary => {
      this.codingFreshnessSummary.set(summary);
      if (loadScopeOnWarnings && this.hasWarnings()) this.loadCodingFreshnessScope();
      else this.codingFreshnessScope.set(null);
      if (!loadScopeOnWarnings && this.secondAutocodingWarnings().length > 0) this.loadManualAppliedResultsOverview();
    }, this.isLoadingCodingFreshness);
  }

  loadCodingFreshnessScope(): void {
    const workspaceId = this.workspace();
    if (!workspaceId) return;
    this.request('scope', workspaceId, this.backend.getCodingFreshnessScope(workspaceId), scope => this.codingFreshnessScope.set(scope));
  }

  loadManualAppliedResultsOverview(): void {
    if (this.disposed) return;
    if (!this.app.selectedWorkspaceId) {
      this.manualAppliedResultsOverview.set(null);
      this.manualAppliedResultsOverviewLoadFailed.set(false);
      return;
    }
    const workspaceId = this.workspace(false);
    if (!workspaceId) return;
    this.manualAppliedResultsOverviewLoadFailed.set(false);
    this.request('applied', workspaceId, this.backend.getAppliedResultsOverview(workspaceId), overview => {
      this.manualAppliedResultsOverview.set(overview);
      this.manualAppliedResultsOverviewLoadFailed.set(overview === null);
    }, this.isLoadingManualAppliedResultsOverview);
  }

  loadAutocodingReadiness(forceRefresh = false): void {
    const workspaceId = this.workspace(forceRefresh);
    if (!workspaceId) return;
    this.autocodingReadinessLoadFailed.set(false);
    this.request('readiness', workspaceId, this.backend.getAutocodingReadiness(workspaceId, 1, forceRefresh), readiness => {
      this.autocodingReadiness.set(readiness);
      this.hasLoadedFullCodingStatusOverview.set(true);
    }, this.isLoadingAutocodingReadiness, () => {
      this.autocodingReadiness.set(null);
      this.autocodingReadinessLoadFailed.set(true);
    });
  }

  loadCachedAutocodingReadiness(): void {
    const workspaceId = this.workspace();
    if (!workspaceId || this.jobs.isStatusCheckGuardActive(workspaceId)) return;
    const overview = this.backend.getCachedCodingStatusOverview(workspaceId, 1);
    if (overview) {
      this.requests.get('readiness')?.unsubscribe();
      this.codingFreshnessSummary.set(overview.codingFreshness);
      this.autocodingReadiness.set(overview.autocodingReadiness);
      this.manualAppliedResultsOverview.set(overview.appliedResultsOverview);
      this.autocodingReadinessLoadFailed.set(false);
      this.manualAppliedResultsOverviewLoadFailed.set(false);
      this.hasLoadedFullCodingStatusOverview.set(true);
      return;
    }
    this.request('readiness', workspaceId, this.backend.getCachedAutocodingReadiness(workspaceId, 1), readiness => {
      if (readiness) {
        this.autocodingReadiness.set(readiness);
        this.autocodingReadinessLoadFailed.set(false);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyed.next();
    this.destroyed.complete();
    this.deferredRefresh.complete();
    this.requests.clear();
  }

  private workspace(forceRefresh?: boolean): number | null {
    if (this.disposed || !this.app.selectedWorkspaceId) return null;
    const workspaceId = this.app.selectedWorkspaceId;
    if (forceRefresh !== undefined && this.jobs.isStatusCheckGuardActive(workspaceId)) {
      this.deferredRefresh.next(forceRefresh);
      return null;
    }
    return workspaceId;
  }

  private request<T>(
    slot: RequestSlot,
    workspaceId: number,
    source: Observable<T>,
    next: (value: T) => void,
    loading?: WritableSignal<boolean>,
    error?: (failure: unknown) => void
  ): void {
    // Release the old request before marking its replacement as loading.
    this.requests.get(slot)?.unsubscribe();
    loading?.set(true);
    const subscription = source.pipe(
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntil(this.destroyed),
      finalize(() => loading?.set(false))
    ).subscribe({ next, error });
    this.requests.set(slot, subscription);
  }
}
