import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Observable, Subject, Subscription, catchError, finalize, merge, of, switchMap, timer
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import {
  FlatResponseFilterOptionsResponse, FlatResponseFrequenciesResponse, FlatResponseFrequencyItem, FlatResponseFrequencyRequestCombo,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { FlatResponseRow } from './test-results-flat-table.models';

export type FlatResponseQuery = Parameters<TestResultService['getFlatResponses']>[1];

function emptyFilterOptions(): FlatResponseFilterOptionsResponse {
  return {
    codes: [],
    groups: [],
    logins: [],
    booklets: [],
    units: [],
    responses: [],
    responseStatuses: [],
    tags: [],
    processingDurations: [],
    unitProgresses: [],
    sessionBrowsers: [],
    sessionOs: [],
    sessionScreens: [],
    sessionIds: []
  };
}

/** Owns one table's requests and workspace-scoped caches. */
@Injectable()
export class TestResultsFlatTableDataFacade {
  private readonly app = inject(AppService);
  private readonly backend = inject(TestResultService);
  private readonly notes = inject(UnitNoteService);
  private readonly destroyRef = inject(DestroyRef);
  private pageRequest?: Subscription;
  private optionsRequest?: Subscription;
  private notesRequest?: Subscription;
  private frequenciesRequest?: Subscription;
  private readonly rowsState = signal<FlatResponseRow[]>([]);
  private readonly totalState = signal(0);
  private readonly loadingState = signal(false);
  private readonly optionsState = signal(emptyFilterOptions());
  private readonly noteIdsState = signal(new Set<number>());
  private readonly frequenciesState = signal(new Map<string, { total: number; values: FlatResponseFrequencyItem[] }>());
  private readonly loadingFrequenciesState = signal(false);
  private readonly errors = new Subject<HttpErrorResponse>();

  readonly rows = this.rowsState.asReadonly();
  readonly total = this.totalState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly options = this.optionsState.asReadonly();
  readonly noteIds = this.noteIdsState.asReadonly();
  readonly loadingFrequencies = this.loadingFrequenciesState.asReadonly();
  readonly errors$ = this.errors.asObservable();

  constructor() {
    this.app.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(() => this.reset());
    this.destroyRef.onDestroy(() => this.errors.complete());
  }

  loadOptions(retryAfterMutation = false): void {
    this.optionsRequest?.unsubscribe();
    const workspaceId = this.app.selectedWorkspaceId;
    if (!workspaceId) return;
    const refreshes = retryAfterMutation ? merge(of(0), timer(1000), timer(3000)) : of(0);
    this.optionsRequest = refreshes.pipe(
      // Replace the previous request before asking the backend for its successor.
      switchMap(() => this.backend.getFlatResponseFilterOptions(workspaceId, {})),
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(options => this.optionsState.set(options));
  }

  loadPage(query: FlatResponseQuery): void {
    this.cancelPage();
    const workspaceId = this.app.selectedWorkspaceId;
    if (!workspaceId) return;
    this.loadingState.set(true);
    this.pageRequest = this.backend.getFlatResponses(workspaceId, query, { suppressGlobalHttpError: true }).pipe(
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loadingState.set(false))
    ).subscribe({
      next: response => {
        const rows = (response.data || []).map(row => ({
          ...row,
          tags: Array.isArray(row.tags) ? row.tags : [],
          logAnomalies: Array.isArray(row.logAnomalies) ? row.logAnomalies : []
        }));
        this.totalState.set(response.total);
        this.rowsState.set(rows);
        this.loadNotes(rows, workspaceId);
        this.loadFrequencies(rows, workspaceId);
      },
      error: (error: HttpErrorResponse) => this.errors.next(error)
    });
  }

  cancelPage(): void {
    this.pageRequest?.unsubscribe();
    this.notesRequest?.unsubscribe();
    this.frequenciesRequest?.unsubscribe();
    this.loadingState.set(false);
    this.loadingFrequenciesState.set(false);
    this.noteIdsState.set(new Set());
  }

  invalidateCaches(): void {
    this.frequenciesState.set(new Map());
  }

  frequencySummary(row: FlatResponseRow): string {
    const key = `${encodeURIComponent(String(row.unit || '').trim())}:${encodeURIComponent(String(row.response || '').trim())}`;
    const entry = this.frequenciesState().get(key);
    const match = entry?.values?.find(value => String(value.value ?? '') === String(row.responseValue ?? ''));
    if (!match) return '';
    const probability = Math.max(0, Math.min(1, Number(match.p || 0))).toFixed(3);
    return `p=${probability.startsWith('0') ? probability.slice(1) : probability} (n=${match.count || 0})`;
  }

  private reset(): void {
    this.cancelPage();
    this.optionsRequest?.unsubscribe();
    this.rowsState.set([]);
    this.totalState.set(0);
    this.optionsState.set(emptyFilterOptions());
    this.invalidateCaches();
  }

  private loadNotes(rows: FlatResponseRow[], workspaceId: number): void {
    const unitIds = [...new Set(rows.map(row => row.unitId).filter(Boolean))];
    if (unitIds.length === 0) return;
    this.notesRequest = this.notes.getNotesForMultipleUnits(workspaceId, unitIds).pipe(
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: notes => this.noteIdsState.set(new Set(Object.entries(notes || {})
        .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
        .map(([id]) => Number(id)))),
      error: () => this.noteIdsState.set(new Set())
    });
  }

  private loadFrequencies(rows: FlatResponseRow[], workspaceId: number): void {
    const requests = new Map<string, FlatResponseFrequencyRequestCombo>();
    rows.forEach(row => {
      const unitKey = String(row.unit || '').trim();
      const variableId = String(row.response || '').trim();
      if (!unitKey || !variableId) return;
      const key = `${encodeURIComponent(unitKey)}:${encodeURIComponent(variableId)}`;
      const value = String(row.responseValue ?? '');
      if (this.frequenciesState().get(key)?.values?.some(item => String(item.value ?? '') === value)) return;
      const request = requests.get(key) || { unitKey, variableId, values: [] };
      if (!request.values.includes(value)) request.values.push(value);
      requests.set(key, request);
    });
    const combinations = [...requests.values()];
    if (combinations.length === 0) return;
    const batches: Observable<FlatResponseFrequenciesResponse>[] = [];
    for (let index = 0; index < combinations.length; index += 25) {
      batches.push(this.backend.getFlatResponseFrequencies(workspaceId, combinations.slice(index, index + 25)).pipe(
        catchError(() => of({} as FlatResponseFrequenciesResponse))
      ));
    }
    this.loadingFrequenciesState.set(true);
    this.frequenciesRequest = merge(...batches).pipe(
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loadingFrequenciesState.set(false))
    ).subscribe(response => {
      this.frequenciesState.update(current => {
        const next = new Map(current);
        Object.entries(response).forEach(([key, incoming]) => {
          const existing = next.get(key);
          const values = new Map<string, FlatResponseFrequencyItem>();
          existing?.values?.forEach(value => values.set(String(value.value ?? ''), value));
          incoming.values?.forEach(value => values.set(String(value.value ?? ''), value));
          next.set(key, { total: incoming.total ?? existing?.total ?? 0, values: [...values.values()] });
        });
        return next;
      });
    });
  }
}
