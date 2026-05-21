import {
  Component, Inject, OnDestroy, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  Subject, Subscription, debounceTime, distinctUntilChanged
} from 'rxjs';
import {
  TestResultService,
  QuickSearchResult,
  QuickSearchResultItem,
  QuickSearchResultKind
} from '../../../shared/services/test-result/test-result.service';
import { AppService } from '../../../core/services/app.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';

export interface QuickSearchTableFilters {
  code?: string;
  group?: string;
  login?: string;
  booklet?: string;
  unit?: string;
  response?: string;
  responseValue?: string;
}

export interface QuickSearchDialogResult {
  action: 'table' | 'browser';
  item: QuickSearchResultItem;
  filters?: QuickSearchTableFilters;
}

interface QuickSearchTypeOption {
  kind: QuickSearchResultKind;
  label: string;
  icon: string;
}

@Component({
  selector: 'coding-box-test-results-search',
  templateUrl: './test-results-search.component.html',
  styleUrls: ['./test-results-search.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ]
})
export class TestResultsSearchComponent implements OnInit, OnDestroy {
  searchText = '';
  isLoading = false;
  hasSearched = false;
  selectedKinds = new Set<QuickSearchResultKind>([
    'person',
    'booklet',
    'unit',
    'response'
  ]);

  readonly typeOptions: QuickSearchTypeOption[] = [
    { kind: 'person', label: 'Personen', icon: 'person' },
    { kind: 'booklet', label: 'Testhefte', icon: 'menu_book' },
    { kind: 'unit', label: 'Aufgaben', icon: 'extension' },
    { kind: 'response', label: 'Antworten', icon: 'question_answer' }
  ];

  readonly MIN_SEARCH_LENGTH = 2;
  readonly SEARCH_DEBOUNCE_TIME = 350;

  results: QuickSearchResult = this.createEmptyResult('');
  private searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;

  constructor(
    private dialogRef: MatDialogRef<TestResultsSearchComponent, QuickSearchDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: { title: string },
    private testResultService: TestResultService,
    private appService: AppService,
    private statisticsService: CodingStatisticsService,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.searchSubscription = this.searchSubject
      .pipe(debounceTime(this.SEARCH_DEBOUNCE_TIME), distinctUntilChanged())
      .subscribe(query => this.runSearch(query));
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
  }

  onSearchChange(): void {
    this.searchSubject.next(this.searchText);
  }

  toggleKind(kind: QuickSearchResultKind): void {
    if (this.selectedKinds.has(kind)) {
      if (this.selectedKinds.size === 1) {
        return;
      }
      this.selectedKinds.delete(kind);
    } else {
      this.selectedKinds.add(kind);
    }
  }

  isKindSelected(kind: QuickSearchResultKind): boolean {
    return this.selectedKinds.has(kind);
  }

  getVisibleResults(kind: QuickSearchResultKind): QuickSearchResultItem[] {
    if (!this.selectedKinds.has(kind)) {
      return [];
    }

    switch (kind) {
      case 'person':
        return this.results.persons;
      case 'booklet':
        return this.results.booklets;
      case 'unit':
        return this.results.units;
      case 'response':
        return this.results.responses;
      default:
        return [];
    }
  }

  getTotal(kind: QuickSearchResultKind): number {
    return this.results.totals[kind] || 0;
  }

  getVisibleCount(): number {
    return this.typeOptions
      .map(option => this.getVisibleResults(option.kind).length)
      .reduce((sum, count) => sum + count, 0);
  }

  openInTable(item: QuickSearchResultItem): void {
    this.dialogRef.close({
      action: 'table',
      item,
      filters: this.createTableFilters(item)
    });
  }

  openInBrowser(item: QuickSearchResultItem): void {
    this.dialogRef.close({
      action: 'browser',
      item
    });
  }

  replay(item: QuickSearchResultItem): void {
    const responseId = item.responseId;
    if (!responseId || !this.appService.selectedWorkspaceId) {
      this.snackBar.open(
        'Für diesen Treffer ist kein Replay verfügbar.',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    this.appService
      .createOwnToken(this.appService.selectedWorkspaceId, 1)
      .subscribe({
        next: token => {
          if (!token) {
            this.snackBar.open(
              'Fehler beim Erzeugen des Authentifizierungs-Tokens',
              'Fehler',
              { duration: 3000 }
            );
            return;
          }

          this.statisticsService
            .getReplayUrl(this.appService.selectedWorkspaceId, responseId, token)
            .subscribe({
              next: result => {
                if (result?.replayUrl) {
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
          this.snackBar.open(
            'Fehler beim Erzeugen des Authentifizierungs-Tokens',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  close(): void {
    this.dialogRef.close();
  }

  private runSearch(query: string): void {
    const trimmedQuery = String(query || '').trim();
    if (trimmedQuery.length < this.MIN_SEARCH_LENGTH) {
      this.results = this.createEmptyResult(trimmedQuery);
      this.hasSearched = false;
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.hasSearched = true;
    this.testResultService
      .quickSearch(this.appService.selectedWorkspaceId, trimmedQuery, 8)
      .subscribe({
        next: results => {
          this.results = results || this.createEmptyResult(trimmedQuery);
          this.isLoading = false;
        },
        error: () => {
          this.results = this.createEmptyResult(trimmedQuery);
          this.isLoading = false;
        }
      });
  }

  private createTableFilters(
    item: QuickSearchResultItem
  ): QuickSearchTableFilters {
    switch (item.kind) {
      case 'person':
        return {
          code: item.personCode || '',
          group: item.personGroup || '',
          login: item.personLogin || ''
        };
      case 'booklet':
        return {
          code: item.personCode || '',
          group: item.personGroup || '',
          login: item.personLogin || '',
          booklet: item.bookletName || ''
        };
      case 'unit':
        return {
          code: item.personCode || '',
          group: item.personGroup || '',
          login: item.personLogin || '',
          booklet: item.bookletName || '',
          unit: item.unitAlias || item.unitName || ''
        };
      case 'response':
        return {
          code: item.personCode || '',
          group: item.personGroup || '',
          login: item.personLogin || '',
          booklet: item.bookletName || '',
          unit: item.unitAlias || item.unitName || '',
          response: item.variableId || '',
          responseValue: item.responseValue || ''
        };
      default:
        return {};
    }
  }

  private createEmptyResult(query: string): QuickSearchResult {
    return {
      query,
      limit: 8,
      persons: [],
      booklets: [],
      units: [],
      responses: [],
      totals: {
        person: 0,
        booklet: 0,
        unit: 0,
        response: 0
      }
    };
  }
}
