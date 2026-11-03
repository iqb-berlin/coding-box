import { TranslateModule } from '@ngx-translate/core';
import {
  computed,
  ChangeDetectorRef, Component, OnDestroy, OnInit, inject, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-results-search',
  templateUrl: './test-results-search.component.html',
  styleUrls: ['./test-results-search.component.scss'],
  standalone: true,
  imports: [TranslateModule,
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
  private readonly uiTranslate = injectUiTranslator();

  private dialogRef = inject<MatDialogRef<TestResultsSearchComponent, QuickSearchDialogResult>>(MatDialogRef);
  protected data = inject<{
    title: string;
  }>(MAT_DIALOG_DATA);

  private testResultService = inject(TestResultService);
  private appService = inject(AppService);
  private statisticsService = inject(CodingStatisticsService);
  private snackBar = inject(MatSnackBar);

  private readonly destroyRef = inject(DestroyRef);

  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  protected searchText = '';
  protected isLoading = false;
  protected hasSearched = false;
  selectedKinds = new Set<QuickSearchResultKind>([
    'person',
    'booklet',
    'unit',
    'response'
  ]);

  private readonly localizedTypeOptions = computed<QuickSearchTypeOption[]>(() => ([
    { kind: 'person', label: this.uiTranslate('process-overview.details.personCount'), icon: 'person' },
    { kind: 'booklet', label: this.uiTranslate('ui-text.files-validation.booklets'), icon: 'menu_book' },
    { kind: 'unit', label: this.uiTranslate('coding.jobs.table.units'), icon: 'extension' },
    { kind: 'response', label: this.uiTranslate('variable-analysis.total-cases'), icon: 'question_answer' }
  ]));

  protected get typeOptions(): QuickSearchTypeOption[] { return this.localizedTypeOptions(); }

  protected readonly MIN_SEARCH_LENGTH = 2;
  readonly SEARCH_DEBOUNCE_TIME = 350;

  results: QuickSearchResult = this.createEmptyResult('');
  private searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;

  ngOnInit(): void {
    this.searchSubscription = this.searchSubject
      .pipe(debounceTime(this.SEARCH_DEBOUNCE_TIME), distinctUntilChanged())
      .subscribe(query => this.runSearch(query));
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
  }

  protected onSearchChange(): void {
    this.searchSubject.next(this.searchText);
  }

  protected toggleKind(kind: QuickSearchResultKind): void {
    if (this.selectedKinds.has(kind)) {
      if (this.selectedKinds.size === 1) {
        return;
      }
      this.selectedKinds.delete(kind);
    } else {
      this.selectedKinds.add(kind);
    }
  }

  protected isKindSelected(kind: QuickSearchResultKind): boolean {
    return this.selectedKinds.has(kind);
  }

  protected getVisibleResults(kind: QuickSearchResultKind): QuickSearchResultItem[] {
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

  protected getTotal(kind: QuickSearchResultKind): number {
    return this.results.totals[kind] || 0;
  }

  protected getVisibleCount(): number {
    return this.typeOptions
      .map(option => this.getVisibleResults(option.kind).length)
      .reduce((sum, count) => sum + count, 0);
  }

  protected openInTable(item: QuickSearchResultItem): void {
    this.dialogRef.close({
      action: 'table',
      item,
      filters: this.createTableFilters(item)
    });
  }

  protected openInBrowser(item: QuickSearchResultItem): void {
    this.dialogRef.close({
      action: 'browser',
      item
    });
  }

  protected replay(item: QuickSearchResultItem): void {
    const responseId = item.responseId;
    if (!responseId || !this.appService.selectedWorkspaceId) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-results-search.replay-unavailable'),
        'Info',
        { duration: 3000 }
      );
      return;
    }

    this.statisticsService
      .getReplayUrl(this.appService.selectedWorkspaceId, responseId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (result?.replayUrl) {
            window.open(result.replayUrl, '_blank');
          } else {
            this.snackBar.open(
              this.uiTranslate('test-results-table.replay-url-error'),
              this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'),
              { duration: 3000 }
            );
          }
        },
        error: () => {
          this.snackBar.open(
            this.uiTranslate('test-results-table.replay-error'),
            this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'),
            { duration: 3000 }
          );
        }
      });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  private runSearch(query: string): void {
    const trimmedQuery = String(query || '').trim();
    if (trimmedQuery.length < this.MIN_SEARCH_LENGTH) {
      this.results = this.createEmptyResult(trimmedQuery);
      this.hasSearched = false;
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.isLoading = true;
    this.hasSearched = true;
    this.changeDetectorRef.markForCheck();
    this.testResultService
      .quickSearch(this.appService.selectedWorkspaceId, trimmedQuery, 8).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: results => {
          this.results = results || this.createEmptyResult(trimmedQuery);
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.results = this.createEmptyResult(trimmedQuery);
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
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
