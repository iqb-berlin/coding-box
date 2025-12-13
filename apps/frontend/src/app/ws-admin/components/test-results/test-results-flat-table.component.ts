import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Observable, Subject, Subscription, debounceTime, of, shareReplay, tap } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { FlatResponseFilterOptionsResponse, TestResultService } from '../../../services/test-result.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

interface FlatResponseRow {
  responseId: number;
  unitId: number;
  personId: number;
  code: string;
  group: string;
  login: string;
  booklet: string;
  unit: string;
  response: string;
  responseStatus: string;
  responseValue: string;
  tags: string[];
}

interface BookletLog {
  id: number;
  bookletid: number;
  ts: string;
  parameter: string;
  key: string;
}

interface BookletSession {
  id: number;
  browser: string;
  os: string;
  screen: string;
  ts: string;
}

interface UnitLog {
  id: number;
  unitid: number;
  ts: string;
  key: string;
  parameter: string;
}

interface UnitFromPersonTestResults {
  id: number;
  bookletid: number;
  name: string;
  alias: string | null;
  logs?: UnitLog[];
}

interface BookletFromPersonTestResults {
  id: number;
  name: string;
  logs: BookletLog[];
  sessions?: BookletSession[];
  units: UnitFromPersonTestResults[];
}

@Component({
  selector: 'coding-box-test-results-flat-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatPaginatorModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatAutocompleteModule
  ],
  templateUrl: './test-results-flat-table.component.html',
  styleUrls: ['./test-results-flat-table.component.scss']
})
export class TestResultsFlatTableComponent implements OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private testResultService = inject(TestResultService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  private unitIdsWithNotes = new Set<number>();

  private personTestResultsCache = new Map<number, Observable<BookletFromPersonTestResults[]>>();
  private personTestResultsCacheOrder: number[] = [];
  private readonly PERSON_TEST_RESULTS_CACHE_MAX = 5;

  flatDisplayedColumns: string[] = ['code', 'group', 'login', 'booklet', 'unit', 'response', 'responseValue', 'tags', 'actions'];

  flatData: FlatResponseRow[] = [];
  flatTotalRecords: number = 0;
  flatPageSize: number = 50;
  flatPageIndex: number = 0;
  isLoadingFlat: boolean = false;

  flatFilters: {
    code: string;
    group: string;
    login: string;
    booklet: string;
    unit: string;
    response: string;
    responseValue: string;
    tags: string;
  } = {
      code: '',
      group: '',
      login: '',
      booklet: '',
      unit: '',
      response: '',
      responseValue: '',
      tags: ''
    };

  flatFilterOptions: FlatResponseFilterOptionsResponse = {
    codes: [],
    groups: [],
    logins: [],
    booklets: [],
    units: [],
    responses: [],
    tags: []
  };

  private flatSearchSubject = new Subject<void>();
  private flatSearchSubscription: Subscription;
  private readonly FLAT_FILTER_DEBOUNCE_TIME = 400;

  private suppressNextFlatFilterChange = false;

  constructor() {
    this.flatSearchSubscription = this.flatSearchSubject.pipe(
      debounceTime(this.FLAT_FILTER_DEBOUNCE_TIME)
    ).subscribe(() => {
      this.fetchFlatResponses(0, this.flatPageSize);
      this.fetchFlatResponseFilterOptions();
    });

    this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
    this.fetchFlatResponseFilterOptions();
  }

  onFlatFilterOptionSelected(): void {
    this.suppressNextFlatFilterChange = true;
    this.flatPageIndex = 0;
    this.fetchFlatResponses(0, this.flatPageSize);
    this.fetchFlatResponseFilterOptions();
  }

  private filterOptions(options: string[], value: string): string[] {
    const v = (value || '').trim().toLowerCase();
    if (!v) {
      return options || [];
    }
    return (options || []).filter(o => String(o).toLowerCase().includes(v));
  }

  filteredCodes(): string[] {
    return this.filterOptions(this.flatFilterOptions.codes, this.flatFilters.code);
  }

  filteredGroups(): string[] {
    return this.filterOptions(this.flatFilterOptions.groups, this.flatFilters.group);
  }

  filteredLogins(): string[] {
    return this.filterOptions(this.flatFilterOptions.logins, this.flatFilters.login);
  }

  filteredBooklets(): string[] {
    return this.filterOptions(this.flatFilterOptions.booklets, this.flatFilters.booklet);
  }

  filteredUnits(): string[] {
    return this.filterOptions(this.flatFilterOptions.units, this.flatFilters.unit);
  }

  filteredResponses(): string[] {
    return this.filterOptions(this.flatFilterOptions.responses, this.flatFilters.response);
  }

  filteredTags(): string[] {
    return this.filterOptions(this.flatFilterOptions.tags, this.flatFilters.tags);
  }

  openBookletInfoFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId || !row.booklet) {
      return;
    }

    const normalizedBookletId = String(row.booklet).toUpperCase();

    const loadingSnackBar = this.snackBar.open(
      'Lade Testheft-Informationen...',
      '',
      { duration: 3000 }
    );

    this.backendService.getBookletInfo(
      this.appService.selectedWorkspaceId,
      normalizedBookletId
    ).subscribe({
      next: bookletInfo => {
        loadingSnackBar.dismiss();

        this.dialog.open(BookletInfoDialogComponent, {
          width: '1200px',
          height: '80vh',
          data: {
            bookletInfo,
            bookletId: normalizedBookletId
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Testheft-Informationen',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  openUnitInfoFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.getPersonTestResults(row.personId).subscribe({
      next: booklets => {
        const booklet = (booklets || []).find(b => b.name === row.booklet);
        if (!booklet) {
          this.snackBar.open(
            'Testheft nicht gefunden',
            'Info',
            { duration: 3000 }
          );
          return;
        }

        const unit = (booklet.units || []).find(u => u.id === row.unitId);
        const unitId = unit ? String(unit.name) : String(row.unit || '');
        if (!unitId) {
          this.snackBar.open(
            'Aufgabe nicht gefunden',
            'Info',
            { duration: 3000 }
          );
          return;
        }

        const loadingSnackBar = this.snackBar.open(
          'Lade Aufgaben-Informationen...',
          '',
          { duration: 3000 }
        );

        this.backendService.getUnitInfo(
          this.appService.selectedWorkspaceId,
          unitId
        ).subscribe({
          next: unitInfo => {
            loadingSnackBar.dismiss();

            this.dialog.open(UnitInfoDialogComponent, {
              width: '1200px',
              height: '80vh',
              data: {
                unitInfo,
                unitId
              }
            });
          },
          error: () => {
            loadingSnackBar.dismiss();
            this.snackBar.open(
              'Fehler beim Laden der Aufgaben-Informationen',
              'Fehler',
              { duration: 3000 }
            );
          }
        });
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Laden der Aufgaben-Informationen',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  openBookletLogsFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.backendService.getBookletLogsForUnit(this.appService.selectedWorkspaceId, row.unitId)
      .subscribe({
        next: result => {
          if (!result || !result.logs || result.logs.length === 0) {
            this.snackBar.open(
              'Keine Logs für dieses Testheft vorhanden',
              'Info',
              { duration: 3000 }
            );
            return;
          }

          this.dialog.open(LogDialogComponent, {
            width: '700px',
            data: {
              logs: result.logs,
              sessions: result.sessions,
              units: (result.units || []).map(u => ({
                ...u,
                results: []
              }))
            }
          });
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Testheft-Logs',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  openNotesFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Notizen...',
      '',
      { duration: 3000 }
    );

    this.backendService.getUnitNotes(this.appService.selectedWorkspaceId, row.unitId)
      .subscribe({
        next: notes => {
          loadingSnackBar.dismiss();

          this.dialog.open(NoteDialogComponent, {
            width: '600px',
            data: {
              unitId: row.unitId,
              notes: (notes || []) as UnitNoteDto[],
              title: `Notizen für Aufgabe: ${row.unit || row.unitId}`
            }
          });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Notizen',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  openUnitLogsFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.backendService.getUnitLogs(this.appService.selectedWorkspaceId, row.unitId)
      .subscribe({
        next: logs => {
          if (!logs || logs.length === 0) {
            this.snackBar.open(
              'Keine Logs für diese Aufgabe vorhanden',
              'Info',
              { duration: 3000 }
            );
            return;
          }

          this.dialog.open(UnitLogsDialogComponent, {
            width: '700px',
            data: {
              logs,
              title: `Logs für Aufgabe: ${row.unit || row.unitId}`
            }
          });
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Aufgaben-Logs',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  ngOnDestroy(): void {
    this.flatSearchSubscription.unsubscribe();
  }

  private getPersonTestResults(personId: number): Observable<BookletFromPersonTestResults[]> {
    if (!this.appService.selectedWorkspaceId) {
      return of([]);
    }

    if (this.personTestResultsCache.has(personId)) {
      return this.personTestResultsCache.get(personId)!;
    }

    const req$ = (this.backendService
      .getPersonTestResults(this.appService.selectedWorkspaceId, personId) as unknown as Observable<BookletFromPersonTestResults[]>)
      .pipe(
        tap({
          error: () => {
            this.personTestResultsCache.delete(personId);
          }
        }),
        shareReplay(1)
      );

    this.personTestResultsCache.set(personId, req$);
    this.personTestResultsCacheOrder = this.personTestResultsCacheOrder.filter(id => id !== personId);
    this.personTestResultsCacheOrder.push(personId);
    if (this.personTestResultsCacheOrder.length > this.PERSON_TEST_RESULTS_CACHE_MAX) {
      const evictId = this.personTestResultsCacheOrder.shift();
      if (evictId !== undefined) {
        this.personTestResultsCache.delete(evictId);
      }
    }
    return req$;
  }

  onFlatFilterChanged(): void {
    if (this.suppressNextFlatFilterChange) {
      this.suppressNextFlatFilterChange = false;
      return;
    }
    this.flatPageIndex = 0;
    this.flatSearchSubject.next();
  }

  clearFlatFilters(): void {
    this.flatFilters = {
      code: '',
      group: '',
      login: '',
      booklet: '',
      unit: '',
      response: '',
      responseValue: '',
      tags: ''
    };
    this.flatPageIndex = 0;
    this.fetchFlatResponses(0, this.flatPageSize);
    this.fetchFlatResponseFilterOptions();
  }

  private fetchFlatResponseFilterOptions(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService.getFlatResponseFilterOptions(this.appService.selectedWorkspaceId, {
      code: this.flatFilters.code,
      group: this.flatFilters.group,
      login: this.flatFilters.login,
      booklet: this.flatFilters.booklet,
      unit: this.flatFilters.unit,
      response: this.flatFilters.response,
      responseValue: this.flatFilters.responseValue,
      tags: this.flatFilters.tags
    }).subscribe(opts => {
      this.flatFilterOptions = opts;
    });
  }

  onFlatPaginatorChange(event: PageEvent): void {
    this.flatPageSize = event.pageSize;
    this.flatPageIndex = event.pageIndex;
    this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
  }

  private fetchFlatResponses(page: number, limit: number): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    const validPage = Math.max(0, page);
    this.isLoadingFlat = true;

    this.testResultService.getFlatResponses(this.appService.selectedWorkspaceId, {
      page: validPage + 1,
      limit,
      code: this.flatFilters.code,
      group: this.flatFilters.group,
      login: this.flatFilters.login,
      booklet: this.flatFilters.booklet,
      unit: this.flatFilters.unit,
      response: this.flatFilters.response,
      responseValue: this.flatFilters.responseValue,
      tags: this.flatFilters.tags
    }).subscribe(resp => {
      this.isLoadingFlat = false;
      this.flatTotalRecords = resp.total;
      this.flatData = (resp.data || []).map(r => ({
        responseId: r.responseId,
        unitId: r.unitId,
        personId: r.personId,
        code: r.code,
        group: r.group,
        login: r.login,
        booklet: r.booklet,
        unit: r.unit,
        response: r.response,
        responseStatus: r.responseStatus,
        responseValue: r.responseValue,
        tags: Array.isArray(r.tags) ? r.tags : []
      }));

      this.loadNotesPresenceForCurrentPage();
    });
  }

  hasNotesForRow(row: FlatResponseRow): boolean {
    return this.unitIdsWithNotes.has(row.unitId);
  }

  private loadNotesPresenceForCurrentPage(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const unitIds = Array.from(new Set((this.flatData || []).map(r => r.unitId).filter(id => !!id)));
    if (unitIds.length === 0) {
      this.unitIdsWithNotes = new Set<number>();
      return;
    }

    this.backendService.getNotesForMultipleUnits(this.appService.selectedWorkspaceId, unitIds)
      .subscribe({
        next: notesByUnitId => {
          const nextSet = new Set<number>();
          Object.entries(notesByUnitId || {}).forEach(([unitId, notes]) => {
            if (Array.isArray(notes) && notes.length > 0) {
              nextSet.add(Number(unitId));
            }
          });
          this.unitIdsWithNotes = nextSet;
        },
        error: () => {
          this.unitIdsWithNotes = new Set<number>();
        }
      });
  }

  replayFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Replay...',
      '',
      { duration: 3000 }
    );

    this.appService
      .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
      .subscribe({
        next: token => {
          loadingSnackBar.dismiss();
          if (!token) {
            this.snackBar.open(
              'Fehler beim Erzeugen des Authentifizierungs-Tokens',
              'Fehler',
              { duration: 3000 }
            );
            return;
          }

          this.backendService.getReplayUrl(
            this.appService.selectedWorkspaceId,
            row.responseId,
            token
          ).subscribe({
            next: result => {
              if (result && result.replayUrl) {
                window.open(result.replayUrl, '_blank');
              } else {
                this.snackBar.open(
                  'Replay-URL konnte nicht erzeugt werden',
                  'Fehler',
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                'Fehler beim Laden der Replay-URL',
                'Fehler',
                { duration: 3000 }
              );
            }
          });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Erzeugen des Authentifizierungs-Tokens',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  deleteFromFlatRow(row: FlatResponseRow): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: 'Antwort löschen',
        content: `Möchten Sie die Antwort "${row.response}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.backendService.deleteResponse(
          this.appService.selectedWorkspaceId,
          row.responseId
        ).subscribe({
          next: result => {
            if (result.success) {
              this.snackBar.open(
                `Antwort "${row.response}" wurde erfolgreich gelöscht.`,
                'Erfolg',
                { duration: 3000 }
              );
              this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
            } else {
              this.snackBar.open(
                `Fehler beim Löschen der Antwort: ${result.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 3000 }
              );
            }
          },
          error: () => {
            this.snackBar.open(
              'Fehler beim Löschen der Antwort. Bitte versuchen Sie es später erneut.',
              'Fehler',
              { duration: 3000 }
            );
          }
        });
      }
    });
  }

  trackByTag(index: number, item: string): string {
    return `${item}@@${index}`;
  }

  trackByRow(index: number, item: FlatResponseRow): number {
    return item.responseId;
  }
}
