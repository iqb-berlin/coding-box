import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import type { ManualCodingTab } from './manual-coding-planning';

type ConcreteCodingJobsReloadScope = 'productive' | 'training';
export type CodingJobsReloadScope = 'active' | 'productive' | 'training' | 'rendered';

/** Read deferred views at reload time, without importing their component classes. */
export interface ManualCodingJobViews {
  activeTab: () => ManualCodingTab;
  productive: () => { loadCodingJobs(): void } | undefined;
  training: () => { loadCodingJobs(): void } | undefined;
  coderTrainings: () => { loadCoderTrainings(): void } | undefined;
}

/** Synchronizes job lists after changes while keeping hidden/deferred lists idle. */
@Injectable()
export class ManualCodingJobsRefreshFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly definitionChanges = new Subject<CodingJobsReloadScope>();
  readonly definitionChanges$ = this.definitionChanges.pipe(
    debounceTime(500),
    takeUntilDestroyed(this.destroyRef)
  );

  private readonly pendingScopes = new Set<ConcreteCodingJobsReloadScope>();
  private pendingReloadTimer?: ReturnType<typeof setTimeout>;
  private views: ManualCodingJobViews = {
    activeTab: () => 'preparation',
    productive: () => undefined,
    training: () => undefined,
    coderTrainings: () => undefined
  };

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.pendingReloadTimer) clearTimeout(this.pendingReloadTimer);
    });
  }

  connectViews(views: ManualCodingJobViews): void {
    this.views = views;
  }

  definitionChanged(scope: CodingJobsReloadScope = 'active'): void {
    this.definitionChanges.next(scope);
  }

  reload(scope: CodingJobsReloadScope = 'active'): void {
    const scopes = this.concreteScopes(scope);
    scopes.forEach(target => {
      const view = target === 'productive' ? this.views.productive() : this.views.training();
      if (view) {
        view.loadCodingJobs();
        this.pendingScopes.delete(target);
      } else {
        this.pendingScopes.add(target);
      }
    });
    if (scopes.includes('training')) this.views.coderTrainings()?.loadCoderTrainings();
  }

  refreshAfterDataChange(scope: CodingJobsReloadScope): void {
    this.concreteScopes(scope).forEach(target => {
      if (this.scopesForTab(this.views.activeTab()).includes(target)) {
        this.reload(target);
      } else {
        this.pendingScopes.add(target);
      }
    });
  }

  reloadPendingForTab(tab: ManualCodingTab): void {
    this.scopesForTab(tab)
      .filter(scope => this.pendingScopes.has(scope))
      .forEach(scope => this.reload(scope));
  }

  schedulePendingForTab(tab: ManualCodingTab): void {
    if (!this.scopesForTab(tab).some(scope => this.pendingScopes.has(scope))) return;

    if (this.pendingReloadTimer) clearTimeout(this.pendingReloadTimer);
    this.pendingReloadTimer = setTimeout(() => {
      this.pendingReloadTimer = undefined;
      this.reloadPendingForTab(tab);
    }, 0);
  }

  private concreteScopes(scope: CodingJobsReloadScope): ConcreteCodingJobsReloadScope[] {
    switch (scope) {
      case 'productive': return ['productive'];
      case 'training': return ['training'];
      case 'rendered': return ['productive', 'training'];
      default: return this.scopesForTab(this.views.activeTab());
    }
  }

  private scopesForTab(tab: ManualCodingTab): ConcreteCodingJobsReloadScope[] {
    switch (tab) {
      case 'execution': return ['productive'];
      case 'training': return ['training'];
      default: return [];
    }
  }
}
