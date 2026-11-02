import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Subject, Subscription, finalize, takeUntil
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { PersonTestResult, QuickSearchResultItem, TestResultService } from '../../../shared/services/test-result/test-result.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import {
  Booklet, TestResultPerson, Response, Unit, UnitLog, UnitResult
} from './test-results.models';

@Injectable()
export class TestResultsDetailsFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testResultService = inject(TestResultService);
  private readonly unitNoteService = inject(UnitNoteService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  private readonly selectedResultRequestsCancelled = new Subject<void>();
  private unitNotesRequest?: Subscription;
  private selectedUnitNotesRequest?: Subscription;

  readonly booklets = signal<Booklet[]>([]);
  readonly responses = signal<Response[]>([]);
  readonly logs = signal<UnitLog[]>([]);
  readonly bookletLogs = signal<{
    [key: string]: unknown;
  }[]>([]);

  readonly selectedUnit = signal<Unit | undefined>(undefined);
  readonly testPerson = signal<TestResultPerson | null>(null);
  readonly selectedBooklet = signal<Booklet | string>('');
  readonly isLoadingBooklets = signal<boolean>(false);
  readonly unitTags = signal<UnitTagDto[]>([]);
  readonly unitTagsMap = signal<Map<number, UnitTagDto[]>>(new Map());
  readonly unitNotes = signal<UnitNoteDto[]>([]);
  readonly unitNotesMap = signal<Map<number, UnitNoteDto[]>>(new Map());

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) { workspaceId = id; this.resetSelectedResultDetails(); }
    });
    this.destroyRef.onDestroy(() => { this.selectedResultRequestsCancelled.complete(); });
  }

  onRowClick(row: TestResultPerson): void {
    this.loadPerson(row);
  }

  private loadPerson(row: TestResultPerson, target?: QuickSearchResultItem): void {
    this.resetSelectedResultDetails();
    this.testPerson.set(row);
    this.isLoadingBooklets.set(true);
    this.testResultService
      .getPersonTestResults(this.appService.selectedWorkspaceId, row.id).pipe(
        takeUntil(this.selectedResultRequestsCancelled), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => { if (!this.destroyRef.destroyed) this.isLoadingBooklets.set(false); })
      )
      .subscribe({
        next: (booklets: PersonTestResult[]) => {
          this.selectedBooklet.set('');
          this.booklets.set(booklets as unknown as Booklet[]);
          this.sortBooklets();
          this.sortBookletUnits();
          this.loadAllUnitTags();
          this.loadAllUnitNotes();
          this.isLoadingBooklets.set(false);
          if (target) this.selectSearchTarget(target);
        },
        error: () => {
          this.isLoadingBooklets.set(false);
          this.snackBar.open(this.translate.instant('test-results-page.details.load-error'), this.translate.instant('error.error_title'), { duration: 3000 });
        }
      });
  }

  sortBooklets(): void {
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }
    this.booklets.update(value => {
      const next = [...value];
      next.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.localeCompare(nameB);
      });
      return next;
    });
  }

  sortBookletUnits(): void {
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }

    this.booklets.update(booklets => booklets.map(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        const units = [...booklet.units].sort((a, b) => {
          const aliasA = a.alias || a.name || '';
          const aliasB = b.alias || b.name || '';
          return aliasA.localeCompare(aliasB);
        });
        return { ...booklet, units };
      }
      return booklet;
    }));
  }

  toggleResponseExpansion(responseId: number): void {
    this.responses.update(responses => responses.map(response => (response.id === responseId ? {
      ...response, expanded: !response.expanded
    } : response)));
  }

  loadAllUnitTags(): void {
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }
    const next = new Map<number, UnitTagDto[]>();
    this.booklets().forEach(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        booklet.units.forEach(unit => {
          if (unit.id && unit.tags) {
            next.set(unit.id, unit.tags);
          }
        });
      }
    });
    this.unitTagsMap.set(next);
  }

  loadAllUnitNotes(): void {
    this.unitNotesRequest?.unsubscribe();
    this.unitNotesMap.set(new Map());
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }
    const unitIds: number[] = [];
    this.booklets().forEach(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        booklet.units.forEach(unit => {
          if (unit.id) {
            unitIds.push(unit.id);
          }
        });
      }
    });

    if (unitIds.length === 0) {
      return;
    }

    this.unitNotesRequest = this.unitNoteService
      .getNotesForMultipleUnits(this.appService.selectedWorkspaceId, unitIds).pipe(
        takeUntil(this.selectedResultRequestsCancelled), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: notesByUnitId => {
          this.unitNotesMap.update(value => {
            const next = new Map(value);
            const existingUnitIds = new Set(this.booklets().flatMap(booklet => booklet.units.map(unit => unit.id)));
            Object.entries(notesByUnitId).forEach(([unitId, notes]) => {
              if (existingUnitIds.has(Number(unitId))) next.set(Number(unitId), notes as UnitNoteDto[]);
            });
            return next;
          });
        },
        error: () => {
          this.snackBar.open(this.translate.instant('test-results-page.details.notes-error'), this.translate.instant('error.error_title'), {
            duration: 3000
          });
        }
      });
  }

  onUnitClick(unit: Unit, booklet: Booklet): void {
    const mappedResponses = unit.results.map((response: UnitResult) => ({
      ...response,
      status: response.status,
      expanded: false
    }));
    this.responses.set(Array.from(mappedResponses));
    this.selectedBooklet.set(booklet.name);

    this.responses.update(value => {
      const next = [...value];
      next.sort((a: Response, b: Response) => {
        if (a.status === 'VALUE_CHANGED' && b.status !== 'VALUE_CHANGED') {
          return -1;
        }
        if (a.status !== 'VALUE_CHANGED' && b.status === 'VALUE_CHANGED') {
          return 1;
        }
        return a.variableid.localeCompare(b.variableid);
      });
      return next;
    });

    this.logs.set(unit.logs);
    this.selectedUnit.set(unit);

    this.loadUnitTags();
    this.loadUnitNotes();
  }

  loadUnitTags(): void {
    const selectedUnitSnapshot = this.selectedUnit();

    if (selectedUnitSnapshot && selectedUnitSnapshot.id) {
      this.unitTags.set(this.unitTagsMap().get(selectedUnitSnapshot.id as number) || []);
    } else {
      this.unitTags.set([]);
    }
  }

  loadUnitNotes(): void {
    this.selectedUnitNotesRequest?.unsubscribe();
    this.unitNotes.set([]);
    const selectedUnitSnapshot = this.selectedUnit();

    if (selectedUnitSnapshot && selectedUnitSnapshot.id) {
      const unitId = selectedUnitSnapshot.id as number;
      if (this.unitNotesMap().has(unitId)) {
        this.unitNotes.set(this.unitNotesMap().get(unitId) || []);
      } else {
        this.selectedUnitNotesRequest = this.unitNoteService
          .getUnitNotes(this.appService.selectedWorkspaceId, unitId).pipe(takeUntil(this.selectedResultRequestsCancelled), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: notes => {
              this.unitNotes.set(notes);
              this.unitNotesMap.update(value => {
                const next = new Map(value);
                next.set(unitId, notes);
                return next;
              });
            },
            error: () => {
              this.snackBar.open(this.translate.instant('test-results-page.details.notes-error'), this.translate.instant('error.error_title'), {
                duration: 3000
              });
            }
          });
      }
    } else {
      this.unitNotes.set([]);
    }
  }

  setSelectedBooklet(booklet: Booklet) {
    this.selectedBooklet.set(booklet.name);
  }

  resetSelectedResultDetails(): void {
    this.selectedResultRequestsCancelled.next();
    this.selectedUnitNotesRequest?.unsubscribe();
    this.isLoadingBooklets.set(false);
    this.booklets.set([]);
    this.responses.set([]);
    this.logs.set([]);
    this.bookletLogs.set([]);
    this.selectedUnit.set(undefined);
    this.testPerson.set(null);
    this.selectedBooklet.set('');
    this.unitTagsMap.set(new Map());
    this.unitNotesMap.set(new Map());
    this.unitTags.set([]);
    this.unitNotes.set([]);
  }

  openQuickSearchBrowserTarget(item: QuickSearchResultItem): void {
    if (!item.personId || !this.appService.selectedWorkspaceId) {
      this.snackBar.open(this.translate.instant('test-results-page.details.invalid-target'), 'OK', { duration: 3000 });
      return;
    }
    this.loadPerson({
      id: item.personId, code: item.personCode || '', group: item.personGroup || '', login: item.personLogin || '', uploaded_at: new Date()
    }, item);
  }

  private selectSearchTarget(item: QuickSearchResultItem): void {
    const booklet = this.findQuickSearchBooklet(item);
    if (!booklet) return;
    this.setSelectedBooklet(booklet);
    const unit = this.findQuickSearchUnit(booklet, item);
    if (!unit) return;
    this.onUnitClick(unit, booklet);
    if (item.kind === 'response' && item.variableId) {
      this.responses.update(responses => responses.map(response => ({ ...response, expanded: response.variableid === item.variableId })));
    }
  }

  removeUnit(unitId: number, bookletId: number): void {
    this.booklets.update(booklets => booklets.map(booklet => (booklet.id === bookletId ? {
      ...booklet, units: booklet.units.filter(unit => unit.id !== unitId)
    } : booklet)));
    if (this.selectedUnit()?.id === unitId) {
      this.selectedUnitNotesRequest?.unsubscribe();
      this.selectedUnit.set(undefined);
      this.responses.set([]);
      this.logs.set([]);
      this.unitTags.set([]);
      this.unitNotes.set([]);
    }
    this.unitTagsMap.update(value => { const next = new Map(value); next.delete(unitId); return next; });
    this.unitNotesMap.update(value => { const next = new Map(value); next.delete(unitId); return next; });
  }

  removeResponse(responseId: number): void {
    const updateUnit = (unit: Unit): Unit => (unit.results?.some(response => response.id === responseId) ? {
      ...unit, results: unit.results.filter(response => response.id !== responseId)
    } : unit);
    this.booklets.update(booklets => booklets.map(booklet => ({ ...booklet, units: booklet.units.map(updateUnit) })));
    this.selectedUnit.update(unit => (unit ? updateUnit(unit) : unit));
    this.responses.update(responses => responses.filter(response => response.id !== responseId));
  }

  private findQuickSearchBooklet(
    item: QuickSearchResultItem
  ): Booklet | undefined {
    if (!this.booklets() || (!item.bookletId && !item.bookletName)) {
      return undefined;
    }

    return this.booklets().find(booklet => {
      if (item.bookletId && booklet.id === item.bookletId) {
        return true;
      }
      return item.bookletName ? booklet.name === item.bookletName : false;
    });
  }

  private findQuickSearchUnit(
    booklet: Booklet,
    item: QuickSearchResultItem
  ): Unit | undefined {
    if (!booklet.units || (!item.unitId && !item.unitName && !item.unitAlias)) {
      return undefined;
    }

    return booklet.units.find(unit => {
      if (item.unitId && unit.id === item.unitId) {
        return true;
      }
      return (
        (!!item.unitName && unit.name === item.unitName) ||
        (!!item.unitAlias && unit.alias === item.unitAlias)
      );
    });
  }
}
